//! Klip Düzenleyici'nin izleme tarafı: bilgisayardaki dosyayı önizlemeye açma,
//! zaman çizelgesi için kare şeridi ve dalga formu, tarayıcının oynatamadığı
//! dosyalar için hafif önizleme kopyası.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use base64::Engine;
use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, BufReader};
use tokio::process::Command;

use crate::error::AppError;
use crate::ffmpeg::edit as args;
use crate::preview::{self, PreviewSource};
use crate::types::LocalMediaInfo;
use crate::{ffmpeg, jobs, paths};

const THUMB_TIMEOUT: Duration = Duration::from_secs(25);
const THUMB_CONCURRENCY: usize = 3;
const MAX_THUMBS: usize = 160;
const WAVEFORM_TIMEOUT: Duration = Duration::from_secs(180);
/// Linkte ses akışı internetten okunur; 1 saatlik video yavaş bağlantıda sürebilir.
const REMOTE_WAVEFORM_TIMEOUT: Duration = Duration::from_secs(420);
const MAX_WAVEFORM_BUCKETS: usize = 24_000;
const PREVIEW_CACHE_DAYS: u64 = 3;
/// Uzak akışta arama yavaş olabilir; kare alma bu süreyi aşmasın.
const FRAME_TIMEOUT: Duration = Duration::from_secs(90);

/// Kare şeridi isteklerinin nesli, kaynak (token) başına: bir kaynağın yeni
/// isteği yalnızca kendi eski isteğini iptal eder. Çoklu kaynakta başka
/// kaynağın kareleri üretilmeye devam eder.
fn thumb_generations() -> &'static Mutex<HashMap<String, u64>> {
    static GENERATIONS: OnceLock<Mutex<HashMap<String, u64>>> = OnceLock::new();
    GENERATIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Kaynağın neslini bir ileri taşır ve yeni değeri döner.
fn next_thumb_generation(token: &str) -> u64 {
    let mut map = thumb_generations().lock().unwrap();
    let next = map.get(token).copied().unwrap_or(0) + 1;
    map.insert(token.to_string(), next);
    next
}

/// Bu istek hâlâ kaynağın güncel isteği mi?
fn is_current_thumb_generation(token: &str, generation: u64) -> bool {
    thumb_generations().lock().unwrap().get(token).copied() == Some(generation)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPreview {
    pub url: String,
    pub token: String,
    pub info: LocalMediaInfo,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ThumbPayload {
    request_id: String,
    index: usize,
    /// `data:image/jpeg;base64,…`; kare alınamadıysa None.
    data_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewCopyProgress {
    token: String,
    percent: Option<f64>,
}

fn local_path(token: &str) -> Result<PathBuf, AppError> {
    match preview::lookup(token) {
        Some(PreviewSource::Local { path }) => Ok(path),
        _ => Err(expired()),
    }
}

fn expired() -> AppError {
    AppError::coded(
        "previewExpired",
        "Önizlemenin süresi doldu. Kaynağı yeniden açın.",
        None,
    )
}

/// Bilgisayardaki bir medya dosyasını düzenleyicide izlenebilir hale getirir.
#[tauri::command]
pub async fn open_local_preview(app: AppHandle, path: String) -> Result<LocalPreview, AppError> {
    let file = Path::new(&path);
    if !super::files::is_openable(file) || !file.is_file() {
        return Err(AppError::coded(
            "unsupportedFile",
            "Bu dosya düzenleyicide açılamıyor.",
            Some(path),
        ));
    }
    let ffmpeg_dir = ffmpeg::binary::ensure_ffmpeg(&app).await?;
    let info = ffmpeg::convert::probe_file(&ffmpeg_dir, &path).await?;
    let (token, url) = preview::register_local(file).await?;
    Ok(LocalPreview { url, token, info })
}

/// `times` anlarındaki kareleri üretir; her biri hazır oldukça `editor-thumb`
/// olayıyla gelir (şerit soldan sağa dolmak zorunda değil). Hemen döner.
#[tauri::command]
pub async fn editor_thumbnails(
    app: AppHandle,
    token: String,
    times: Vec<f64>,
    height: u32,
    request_id: String,
) -> Result<(), AppError> {
    let (input, headers) = match preview::lookup(&token).ok_or_else(expired)? {
        PreviewSource::Local { path } => (path.to_string_lossy().into_owned(), Vec::new()),
        PreviewSource::Remote {
            headers, thumb_url, ..
        } => (
            thumb_url.ok_or_else(|| {
                AppError::coded("noThumbnails", "Bu kaynak için kare alınamıyor.", None)
            })?,
            headers,
        ),
    };
    let ffmpeg_exe = ffmpeg::binary::ensure_ffmpeg(&app)
        .await?
        .join("ffmpeg.exe");
    let generation = next_thumb_generation(&token);

    tauri::async_runtime::spawn(async move {
        futures_util::stream::iter(times.into_iter().enumerate().take(MAX_THUMBS))
            .for_each_concurrent(THUMB_CONCURRENCY, |(index, seconds)| {
                let (app, ffmpeg_exe, input, headers, request_id, token) = (
                    app.clone(),
                    ffmpeg_exe.clone(),
                    input.clone(),
                    headers.clone(),
                    request_id.clone(),
                    token.clone(),
                );
                async move {
                    if !is_current_thumb_generation(&token, generation) {
                        return;
                    }
                    let jpeg = grab_frame(&ffmpeg_exe, &input, &headers, seconds, height).await;
                    let data_url = jpeg.map(|bytes| {
                        format!(
                            "data:image/jpeg;base64,{}",
                            base64::engine::general_purpose::STANDARD.encode(bytes)
                        )
                    });
                    let _ = app.emit(
                        "editor-thumb",
                        ThumbPayload {
                            request_id,
                            index,
                            data_url,
                        },
                    );
                }
            })
            .await;
    });
    Ok(())
}

async fn grab_frame(
    ffmpeg_exe: &Path,
    input: &str,
    headers: &[(String, String)],
    seconds: f64,
    height: u32,
) -> Option<Vec<u8>> {
    let mut command = Command::new(ffmpeg_exe);
    command
        .args(args::thumbnail_args(input, headers, seconds, height))
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    jobs::hide_console(&mut command);
    let child = command.spawn().ok()?;
    if let Some(pid) = child.id() {
        crate::process_guard::attach(pid);
    }
    let output = tokio::time::timeout(THUMB_TIMEOUT, child.wait_with_output())
        .await
        .ok()?
        .ok()?;
    (output.status.success() && !output.stdout.is_empty()).then_some(output.stdout)
}

/// Bilgisayardaki dosyanın ses dalga formu: `buckets` adet 0..1 tepe değeri.
#[tauri::command]
pub async fn editor_waveform(
    app: AppHandle,
    token: String,
    duration_seconds: f64,
    buckets: usize,
) -> Result<Vec<f32>, AppError> {
    // Bilgisayardaki dosyada dosyanın kendisi, linkte düşük bit hızlı ses akışı okunur.
    let (input, headers, timeout) = match preview::lookup(&token).ok_or_else(expired)? {
        PreviewSource::Local { path } => (
            path.to_string_lossy().into_owned(),
            Vec::new(),
            WAVEFORM_TIMEOUT,
        ),
        PreviewSource::Remote {
            headers, wave_url, ..
        } => (
            wave_url.ok_or_else(|| {
                AppError::coded("noWaveform", "Bu kaynak için dalga formu yok.", None)
            })?,
            headers,
            REMOTE_WAVEFORM_TIMEOUT,
        ),
    };
    let ffmpeg_exe = ffmpeg::binary::ensure_ffmpeg(&app)
        .await?
        .join("ffmpeg.exe");
    let mut command = Command::new(&ffmpeg_exe);
    command
        .args(args::waveform_args(&input, &headers))
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    jobs::hide_console(&mut command);
    let mut child = command
        .spawn()
        .map_err(|e| AppError::new("Dalga formu çıkarılamadı.", Some(e.to_string())))?;
    if let Some(pid) = child.id() {
        crate::process_guard::attach(pid);
    }

    let mut stdout = child.stdout.take().expect("stdout piped");
    let mut collector =
        args::PeakCollector::new(duration_seconds, buckets.clamp(1, MAX_WAVEFORM_BUCKETS));
    let read = async {
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            match stdout.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => collector.feed(&buf[..n]),
            }
        }
    };
    let timed_out = tokio::time::timeout(timeout, read).await.is_err();
    let _ = child.kill().await;
    if timed_out {
        return Err(AppError::new("Dalga formu çok uzun sürdü.", None));
    }
    // Ondalıkları kısaltmak JSON'u yarıya indirir; görsel fark yok.
    Ok(collector
        .finish()
        .into_iter()
        .map(|v| (v * 1000.0).round() / 1000.0)
        .collect())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewCopy {
    pub url: String,
    pub token: String,
}

/// Tarayıcının oynatamadığı yerel dosya için 480p önizleme kopyası üretir
/// (önbellekte tutulur, aynı dosya ikinci kez açılınca yeniden üretilmez).
#[tauri::command]
pub async fn create_preview_copy(app: AppHandle, token: String) -> Result<PreviewCopy, AppError> {
    let path = local_path(&token)?;
    let ffmpeg_dir = ffmpeg::binary::ensure_ffmpeg(&app).await?;
    let source = path.to_string_lossy().into_owned();
    let info = ffmpeg::convert::probe_file(&ffmpeg_dir, &source).await?;
    let has_video = info.video_codec.is_some();

    let cache = paths::cache_dir(&app, "preview")?;
    remove_old_copies(&cache).await;
    let key = cache_key(&path, info.file_size_bytes).await;
    let output = cache.join(format!("{key}.{}", if has_video { "mp4" } else { "m4a" }));

    if !output.exists() {
        let partial = output.with_extension("part");
        let partial_text = partial.to_string_lossy().into_owned();
        let mut command = Command::new(ffmpeg_dir.join("ffmpeg.exe"));
        // FFmpeg çıktı biçimini uzantıdan anlar; ".part" için açıkça söylenir.
        let mut ffmpeg_args = args::preview_copy_args(&source, &partial_text, has_video);
        ffmpeg_args.insert(ffmpeg_args.len() - 1, "-f".into());
        ffmpeg_args.insert(ffmpeg_args.len() - 1, "mp4".into());
        command
            .args(ffmpeg_args)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        jobs::hide_console(&mut command);
        let mut child = command.spawn().map_err(|e| {
            AppError::coded(
                "previewCopyFailed",
                "Önizleme kopyası oluşturulamadı.",
                Some(e.to_string()),
            )
        })?;
        if let Some(pid) = child.id() {
            crate::process_guard::attach(pid);
        }

        let mut stdout = BufReader::new(child.stdout.take().expect("stdout piped"));
        let mut buf = Vec::new();
        while let Some(line) = jobs::read_line_lossy(&mut stdout, &mut buf).await {
            if let Some(us) = line.strip_prefix("out_time_us=") {
                let percent = match (us.trim().parse::<f64>(), info.duration_seconds) {
                    (Ok(us), Some(d)) if d > 0.0 => Some((us / 1e6 / d * 100.0).clamp(0.0, 100.0)),
                    _ => None,
                };
                let _ = app.emit(
                    "preview-copy-progress",
                    PreviewCopyProgress {
                        token: token.clone(),
                        percent,
                    },
                );
            }
        }
        let ok = matches!(child.wait().await, Ok(s) if s.success());
        if !ok || tokio::fs::rename(&partial, &output).await.is_err() {
            let _ = tokio::fs::remove_file(&partial).await;
            return Err(AppError::coded(
                "previewCopyFailed",
                "Önizleme kopyası oluşturulamadı.",
                None,
            ));
        }
    }

    let (token, url) = preview::register_local(&output).await?;
    Ok(PreviewCopy { url, token })
}

/// Dosya yolu + boyut + değişme zamanı: dosya değişirse kopya yenilenir.
async fn cache_key(path: &Path, size: u64) -> String {
    let modified = tokio::fs::metadata(path)
        .await
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_secs());
    let digest = Sha256::digest(format!("{}|{size}|{modified}", path.display()).as_bytes());
    digest.iter().take(12).map(|b| format!("{b:02x}")).collect()
}

async fn remove_old_copies(dir: &Path) {
    let Ok(mut entries) = tokio::fs::read_dir(dir).await else {
        return;
    };
    let limit = Duration::from_secs(PREVIEW_CACHE_DAYS * 24 * 3600);
    while let Ok(Some(entry)) = entries.next_entry().await {
        let old = entry
            .metadata()
            .await
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.elapsed().ok())
            .is_some_and(|age| age > limit);
        if old {
            let _ = tokio::fs::remove_file(entry.path()).await;
        }
    }
}

/// İmleçteki kareyi tam çözünürlükte PNG olarak kaydeder. `input` verilirse
/// (bilgisayardaki dosya ya da önizleme aktarıcısının adresi) o kullanılır;
/// verilmezse belirteçteki kare akışına düşülür (HLS listeleri aktarıcı
/// üzerinden okunamadığı için). Çıktı Resimler\DownKit'e yazılır: Ekran
/// Görüntüsü kitaplığında görünür.
#[tauri::command]
pub async fn editor_save_frame(
    app: AppHandle,
    token: String,
    input: Option<String>,
    seconds: f64,
    name: String,
) -> Result<String, AppError> {
    let (input, headers) = match input.filter(|i| !i.is_empty()) {
        Some(direct) => {
            // Yalnızca bilgisayardaki bir dosya ya da kendi aktarıcımız kabul
            // edilir; rastgele bir internet adresi FFmpeg'e verilmez.
            let proxied = direct.starts_with("http://127.0.0.1:");
            if !proxied && !Path::new(&direct).is_file() {
                return Err(AppError::new("Kare kaydedilemedi.", Some(direct)));
            }
            (direct, Vec::new())
        }
        None => match preview::lookup(&token).ok_or_else(expired)? {
            PreviewSource::Local { path } => (path.to_string_lossy().into_owned(), Vec::new()),
            PreviewSource::Remote {
                headers, thumb_url, ..
            } => (
                thumb_url.ok_or_else(|| {
                    AppError::coded("noThumbnails", "Bu kaynak için kare alınamıyor.", None)
                })?,
                headers,
            ),
        },
    };
    let ffmpeg_exe = ffmpeg::binary::ensure_ffmpeg(&app)
        .await?
        .join("ffmpeg.exe");
    let dir = PathBuf::from(crate::snip::snip_default_dir(app.clone())?);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| AppError::new("Klasör oluşturulamadı.", Some(e.to_string())))?;
    let output = jobs::unique_output_path(&dir, &super::edit::sanitize_name(&name), "png");

    let mut command = Command::new(&ffmpeg_exe);
    command
        .args(args::frame_file_args(
            &input,
            &headers,
            seconds.max(0.0),
            &output.to_string_lossy(),
        ))
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    jobs::hide_console(&mut command);
    let mut child = command
        .spawn()
        .map_err(|e| AppError::new("Kare kaydedilemedi.", Some(e.to_string())))?;
    if let Some(pid) = child.id() {
        crate::process_guard::attach(pid);
    }

    let mut detail = String::new();
    let mut stderr_pipe = child.stderr.take().expect("stderr piped");
    let read = stderr_pipe.read_to_string(&mut detail);
    if tokio::time::timeout(FRAME_TIMEOUT, read).await.is_err() {
        let _ = child.kill().await;
        let _ = tokio::fs::remove_file(&output).await;
        return Err(AppError::new("Kare alma çok uzun sürdü.", None));
    }
    let ok = matches!(child.wait().await, Ok(s) if s.success());
    if !ok {
        let _ = tokio::fs::remove_file(&output).await;
        return Err(AppError::new(
            "Kare kaydedilemedi.",
            Some(detail.trim().chars().take(300).collect()),
        ));
    }
    Ok(output.to_string_lossy().into_owned())
}
