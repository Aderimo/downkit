//! Klip Düzenleyici'nin dışa aktarımı.
//!
//! - Bilgisayardaki dosya: tek klip kesilir (hızlı kopyalama ya da tam kare),
//!   birden çok klip tek dosyada birleştirilir; istenirse yalnızca ses çıkar.
//! - Link: yalnızca seçilen sahneler indirilir (1 saatlik videonun tamamı değil),
//!   sonra yeniden kodlamadan uç uca eklenir. Klipleri ayrı dosya olarak isteyen
//!   kullanıcı için önyüz her klibe bir bölüm indirmesi başlatır; bu komut
//!   birleştirilmiş çıktı içindir.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::io::BufReader;
use tokio::process::Command;
use uuid::Uuid;

use crate::commands::download::{self, DownloadRequest, StderrSummary, FILE_PREFIX};
use crate::error::AppError;
use crate::events::{JobCanceledPayload, JobCompletePayload, JobErrorPayload};
use crate::ffmpeg::edit::{
    self as edit_args, Clip, Frame, GifOptions, Streams, TextOverlay, VideoPost, AUDIO_FORMATS,
};
use crate::ffmpeg::trim::seconds_arg;
use crate::jobs::{self, FfmpegJob};
use crate::{ffmpeg, paths, ytdlp};

const MAX_CLIPS: usize = 50;
const MIN_CLIP_SECONDS: f64 = 0.1;
const DEFAULT_AUDIO_KBPS: u32 = 192;
/// GIF için linkten en fazla bu yükseklikte indirilir; GIF zaten küçük olur.
const GIF_SOURCE_HEIGHT: u32 = 720;
const MAX_NAME_CHARS: usize = 150;
const ERROR_MESSAGE: &str = "Dışa aktarma tamamlanamadı. Tekrar deneyin.";

/// Çoklu kaynakta tek girdi: ya bilgisayardaki dosya ya da link.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditInput {
    #[serde(default)]
    pub input_path: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditRequest {
    /// Kaynak bilgisayardaysa dosya yolu…
    #[serde(default)]
    pub input_path: Option<String>,
    /// …internetteyse link.
    #[serde(default)]
    pub url: Option<String>,
    /// Birden çok kaynak: kliplerin `source` alanı bu diziye işaret eder.
    /// Boşsa yukarıdaki tek kaynak alanları kullanılır.
    #[serde(default)]
    pub inputs: Vec<EditInput>,
    /// Çıktıdaki sırayla (zaman sırası olmak zorunda değil).
    pub clips: Vec<Clip>,
    pub destination_dir: String,
    /// Uzantısız çıktı adı.
    pub output_name: String,
    #[serde(default)]
    pub audio_only: bool,
    /// Ses: mp3 | m4a | wav | flac. Link kaynağında görüntü: mp4 | mkv | webm.
    #[serde(default)]
    pub output_format: Option<String>,
    #[serde(default)]
    pub max_height: Option<u32>,
    #[serde(default)]
    pub audio_bitrate_kbps: Option<u32>,
    /// Yerel tek klipte tam karede kes (yeniden kodlar); false ise kopyalayarak hızlı keser.
    #[serde(default)]
    pub precise: bool,
    #[serde(default)]
    pub rate_limit_kbps: Option<u32>,
    /// Duraklat/sürdür boyunca aynı kalan anahtar (arayüzdeki iş kimliği): linkten
    /// indirilen bölümler bu klasörde kalır, sürdürünce biten bölümler yeniden inmez.
    #[serde(default)]
    pub work_key: Option<String>,
    /// Verilirse çıktı sessiz, hareketli bir GIF olur.
    #[serde(default)]
    pub gif: Option<GifOptions>,
    /// Verilirse görüntü bu kareye kırpılır/sığdırılır (ör. dikey 9:16).
    #[serde(default)]
    pub frame: Option<Frame>,
    /// Görüntüye yazılacak yazılar (çıktı zamanıyla).
    #[serde(default)]
    pub texts: Vec<TextOverlay>,
}

/// Windows yazı tipi: kalın/normal Segoe UI, yoksa Arial.
fn font_file(bold: bool) -> Option<PathBuf> {
    let fonts = PathBuf::from(std::env::var("WINDIR").unwrap_or_else(|_| r"C:\Windows".into()))
        .join("Fonts");
    let names: &[&str] = if bold {
        &["segoeuib.ttf", "arialbd.ttf", "segoeui.ttf", "arial.ttf"]
    } else {
        &["segoeui.ttf", "arial.ttf"]
    };
    names.iter().map(|n| fonts.join(n)).find(|p| p.exists())
}

/// Yazıları dosyaya yazıp drawtext filtrelerini kurar (dosya adı içeriğin özeti:
/// aynı yazı yeniden yazılmaz).
async fn text_filters(app: &AppHandle, texts: &[TextOverlay]) -> Result<Vec<String>, AppError> {
    use std::hash::{Hash, Hasher};
    if texts.is_empty() {
        return Ok(Vec::new());
    }
    let dir = paths::cache_dir(app, "edit-text")?;
    let mut filters = Vec::new();
    for overlay in texts {
        let Some(font) = font_file(overlay.bold) else {
            continue;
        };
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        overlay.text.hash(&mut hasher);
        let file = dir.join(format!("{:016x}.txt", hasher.finish()));
        if !file.exists() {
            tokio::fs::write(&file, overlay.text.as_bytes())
                .await
                .map_err(|e| AppError::new(ERROR_MESSAGE, Some(e.to_string())))?;
        }
        if let Some(filter) =
            edit_args::drawtext_filter(overlay, &file.to_string_lossy(), &font.to_string_lossy())
        {
            filters.push(filter);
        }
    }
    Ok(filters)
}

/// İş klasörü adı: yalnızca harf, rakam ve tire (yol dışına çıkılamasın).
fn work_dir_name(key: Option<&str>, job_id: &str) -> String {
    key.filter(|k| {
        (1..=64).contains(&k.len()) && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    })
    .unwrap_or(job_id)
    .to_string()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EditProgressPayload {
    job_id: String,
    percent: Option<f64>,
    /// "downloading" | "merging"
    stage: &'static str,
    downloaded_bytes: Option<u64>,
    speed_bps: Option<f64>,
}

/// Klipleri kendi kaynağının süresine sığdırır, çok kısa olanları atar.
/// `durations[i]`: i. kaynağın süresi; bilinmiyorsa (link) None.
fn normalize_clips(clips: &[Clip], durations: &[Option<f64>]) -> Result<Vec<Clip>, AppError> {
    if clips.len() > MAX_CLIPS {
        return Err(AppError::coded(
            "tooManyClips",
            "Tek seferde en fazla 50 klip dışa aktarılabilir.",
            None,
        ));
    }
    let fallback = durations.first().copied().flatten();
    let normalized: Vec<Clip> = clips
        .iter()
        .filter(|c| c.start.is_finite() && c.end.is_finite())
        .map(|c| {
            let limit = match durations.get(c.source) {
                // Kaynağın süresi biliniyor: ona sığdır.
                Some(&Some(d)) if d > 0.0 => d,
                // Süresi bilinmeyen kaynak (link): kısıt yok.
                Some(_) => f64::MAX,
                // Aralık dışı kaynak işareti: ilk kaynağa düş.
                None => fallback.filter(|d| *d > 0.0).unwrap_or(f64::MAX),
            };
            Clip {
                start: c.start.clamp(0.0, limit),
                end: c.end.clamp(0.0, limit),
                speed: c.speed(),
                ..*c
            }
        })
        .filter(|c| c.duration() >= MIN_CLIP_SECONDS)
        .collect();
    if normalized.is_empty() {
        return Err(AppError::coded(
            "invalidRange",
            "Bitiş zamanı başlangıçtan sonra olmalı.",
            None,
        ));
    }
    Ok(normalized)
}

/// Kullanıcının yazdığı adı Windows dosya adına uygun hale getirir.
pub(crate) fn sanitize_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_control() || r#"<>:"/\|?*"#.contains(c) {
                ' '
            } else {
                c
            }
        })
        .collect();
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed: String = collapsed
        .trim_matches(|c: char| c == '.' || c == ' ')
        .chars()
        .take(MAX_NAME_CHARS)
        .collect();
    let trimmed = trimmed.trim_end_matches(['.', ' ']).to_string();
    // Windows'un ayrılmış aygıt adları dosya adı olamaz.
    let reserved = ["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "LPT1", "LPT2"];
    if trimmed.is_empty() || reserved.contains(&trimmed.to_ascii_uppercase().as_str()) {
        "klip".to_string()
    } else {
        trimmed
    }
}

/// Yalnızca ses çıktısında kullanılacak biçim: istenen, yoksa kaynağınki, yoksa m4a.
fn audio_format<'a>(requested: Option<&'a str>, container: &'a str) -> &'a str {
    requested
        .filter(|f| AUDIO_FORMATS.contains(f))
        .or_else(|| AUDIO_FORMATS.contains(&container).then_some(container))
        .unwrap_or("m4a")
}

#[tauri::command]
pub async fn start_edit(app: AppHandle, request: EditRequest) -> Result<String, AppError> {
    // Etkin girdi listesi: çoklu kaynak `inputs`'tan, yoksa eski tek kaynak alanlarından.
    let inputs: Vec<EditInput> = if !request.inputs.is_empty() {
        request.inputs.clone()
    } else {
        match (&request.input_path, &request.url) {
            (Some(path), _) => vec![EditInput {
                input_path: Some(path.clone()),
                url: None,
            }],
            (None, Some(url)) => vec![EditInput {
                input_path: None,
                url: Some(url.clone()),
            }],
            _ => Vec::new(),
        }
    };
    match inputs.as_slice() {
        [] => Err(AppError::new("Kaynak seçilmedi.", None)),
        [one] => match (&one.input_path, &one.url) {
            (Some(path), _) => start_local(&app, &request, path).await,
            (None, Some(url)) => start_remote(&app, &request, url).await,
            _ => Err(AppError::new("Kaynak seçilmedi.", None)),
        },
        many => start_multi(&app, &request, many).await,
    }
}

/// `discard`: İptal'de true (indirilen bölümler silinir), Duraklat'ta false.
#[tauri::command]
pub async fn cancel_edit(
    app: AppHandle,
    job_id: String,
    discard: Option<bool>,
) -> Result<(), AppError> {
    jobs::cancel(&app, &job_id, discard.unwrap_or(true)).await;
    Ok(())
}

/// Duraklatılmış bir dışa aktarım iptal edilince yarım kalan bölümleri siler.
#[tauri::command]
pub async fn discard_edit_work(app: AppHandle, work_key: String) -> Result<(), AppError> {
    let name = work_dir_name(Some(&work_key), "");
    if !name.is_empty() {
        let _ = tokio::fs::remove_dir_all(paths::cache_dir(&app, "edit")?.join(name)).await;
    }
    Ok(())
}

async fn start_local(
    app: &AppHandle,
    request: &EditRequest,
    path: &str,
) -> Result<String, AppError> {
    let ffmpeg_dir = ffmpeg::binary::ensure_ffmpeg(app).await?;
    let info = ffmpeg::convert::probe_file(&ffmpeg_dir, path).await?;
    let clips = normalize_clips(&request.clips, &[info.duration_seconds])?;
    let streams = Streams {
        video: info.video_codec.is_some(),
        audio: info.audio_codec.is_some(),
    };
    if let Some(gif) = request.gif {
        if !streams.video {
            return Err(AppError::coded(
                "noVideo",
                "Bu dosyada görüntü yok; GIF yapılamaz.",
                None,
            ));
        }
        return start_local_gif(app, request, path, &ffmpeg_dir, &clips, gif).await;
    }
    let audio_only = request.audio_only || !streams.video;
    if audio_only && !streams.audio {
        return Err(AppError::coded("noAudio", "Bu dosyada ses yok.", None));
    }
    let kbps = request.audio_bitrate_kbps.unwrap_or(DEFAULT_AUDIO_KBPS);
    let format = audio_format(request.output_format.as_deref(), &info.container);
    // Hızı değişen klip her zaman yeniden kodlanır (kopyalayarak hızlandırılamaz).
    // Hız, ses düzeyi ya da geçiş olan klip her zaman yeniden kodlanır.
    let post = VideoPost {
        frame: request.frame,
        texts: text_filters(app, &request.texts).await?,
    };
    let single = clips.len() == 1 && !clips[0].has_effects() && post.is_empty();

    let extension = if audio_only {
        format.to_string()
    } else if single && !request.precise && !info.container.is_empty() {
        info.container.clone()
    } else {
        "mp4".to_string()
    };
    let output_path = jobs::unique_output_path(
        Path::new(&request.destination_dir),
        &sanitize_name(&request.output_name),
        &extension,
    );
    let output = output_path.to_string_lossy().into_owned();

    let args = match (audio_only, single) {
        (true, true) => edit_args::extract_audio_args(path, &output, clips[0], format, kbps),
        (true, false) => edit_args::merge_args(
            path,
            &output,
            &clips,
            streams,
            Some((format, kbps)),
            &VideoPost::default(),
        ),
        (false, true) => {
            ffmpeg::trim::build_args(path, &output, clips[0].start, clips[0].end, request.precise)
        }
        (false, false) => edit_args::merge_args(path, &output, &clips, streams, None, &post),
    };

    jobs::spawn_ffmpeg(
        app,
        &ffmpeg_dir.join("ffmpeg.exe"),
        args,
        FfmpegJob {
            event_prefix: "edit",
            error_code: "editFailed",
            error_message: ERROR_MESSAGE,
            duration_seconds: Some(clips.iter().map(Clip::output_duration).sum()),
            output_path: output,
            input_size_bytes: None,
        },
    )
    .await
}

async fn start_local_gif(
    app: &AppHandle,
    request: &EditRequest,
    path: &str,
    ffmpeg_dir: &Path,
    clips: &[Clip],
    gif: GifOptions,
) -> Result<String, AppError> {
    let output_path = jobs::unique_output_path(
        Path::new(&request.destination_dir),
        &sanitize_name(&request.output_name),
        "gif",
    );
    let output = output_path.to_string_lossy().into_owned();
    let post = VideoPost {
        frame: request.frame,
        texts: text_filters(app, &request.texts).await?,
    };
    let inputs: Vec<edit_args::MergeInput> = clips
        .iter()
        .map(|c| edit_args::MergeInput {
            path,
            range: Some((c.start, c.duration())),
            clip: *c,
        })
        .collect();
    jobs::spawn_ffmpeg(
        app,
        &ffmpeg_dir.join("ffmpeg.exe"),
        edit_args::gif_args(&inputs, &output, gif, &post),
        FfmpegJob {
            event_prefix: "edit",
            error_code: "editFailed",
            error_message: ERROR_MESSAGE,
            duration_seconds: Some(clips.iter().map(Clip::output_duration).sum()),
            output_path: output,
            input_size_bytes: None,
        },
    )
    .await
}

struct RemoteEdit {
    work_dir: PathBuf,
    destination_dir: PathBuf,
    output_name: String,
    ffmpeg_dir: PathBuf,
    /// İndirilen bölümlerin sırasıyla hızları.
    /// İndirilen bölümlerin sırasıyla klipleri (hız, ses, geçiş).
    clips: Vec<Clip>,
    audio_only: bool,
    audio_bitrate_kbps: u32,
    gif: Option<GifOptions>,
    /// Çerçeve ve yazılar (yalnızca görüntü çıktısında).
    post: VideoPost,
}

impl RemoteEdit {
    fn ffmpeg_exe(&self) -> PathBuf {
        self.ffmpeg_dir.join("ffmpeg.exe")
    }

    fn needs_reencode(&self) -> bool {
        !self.post.is_empty() || self.clips.iter().any(Clip::has_effects)
    }
}

async fn start_remote(
    app: &AppHandle,
    request: &EditRequest,
    url: &str,
) -> Result<String, AppError> {
    let clips = normalize_clips(&request.clips, &[None])?;
    let ytdlp_path = ytdlp::binary::ensure_ytdlp(app).await?;
    let ffmpeg_dir = ffmpeg::binary::ensure_ffmpeg(app).await?;
    let platform = crate::platform::detect_platform(url).unwrap_or("");
    let js_args = ytdlp::jsruntime::ytdlp_args(app, platform).await;

    let job_id = Uuid::new_v4().to_string();
    let work_dir =
        paths::cache_dir(app, "edit")?.join(work_dir_name(request.work_key.as_deref(), &job_id));
    tokio::fs::create_dir_all(&work_dir)
        .await
        .map_err(|e| AppError::new(ERROR_MESSAGE, Some(e.to_string())))?;

    let gif = request.gif.is_some();
    let audio_only = request.audio_only && !gif;
    let format = if gif {
        "mp4".to_string()
    } else {
        request
            .output_format
            .clone()
            .unwrap_or_else(|| if audio_only { "mp3" } else { "mp4" }.to_string())
    };
    let max_height = if gif {
        Some(
            request
                .max_height
                .map_or(GIF_SOURCE_HEIGHT, |h| h.min(GIF_SOURCE_HEIGHT)),
        )
    } else {
        request.max_height
    };
    let mut args = download::build_format_args(&DownloadRequest {
        url: url.to_string(),
        destination_dir: String::new(),
        filename_template: String::new(),
        audio_only,
        max_height,
        format_id: None,
        output_format: Some(format),
        audio_bitrate_kbps: request.audio_bitrate_kbps,
        subtitles: false,
        subtitle_langs: Vec::new(),
        auto_subtitles: false,
        rate_limit_kbps: request.rate_limit_kbps,
        section_start: None,
        section_end: None,
        // Bölümler sonradan birleştirilir; kapak resmi birleştirmede fazladan akış olurdu.
        embed_metadata: false,
        sponsor_block: false,
    });
    args.extend(section_args(&clips));
    args.extend(js_args);
    args.extend([
        "--newline".into(),
        "--encoding".into(),
        "utf-8".into(),
        "--print".into(),
        format!("after_move:{FILE_PREFIX}%(filepath)j"),
        "--ffmpeg-location".into(),
        ffmpeg_dir.to_string_lossy().into_owned(),
        "-o".into(),
        // Aynı başlangıçlı iki klip birbirinin üzerine yazmasın diye bitiş de adda.
        work_dir
            .join("%(section_start)s-%(section_end)s.%(ext)s")
            .to_string_lossy()
            .into_owned(),
        "--no-playlist".into(),
        url.to_string(),
    ]);

    let mut command = Command::new(&ytdlp_path);
    command
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    jobs::hide_console(&mut command);
    let mut child = command.spawn().map_err(|e| {
        AppError::coded(
            "toolStartFailed",
            "İndirme başlatılamadı.",
            Some(e.to_string()),
        )
    })?;
    if let Some(pid) = child.id() {
        jobs::register(app, &job_id, pid);
    }

    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");
    let job = RemoteEdit {
        work_dir,
        destination_dir: PathBuf::from(&request.destination_dir),
        output_name: sanitize_name(&request.output_name),
        ffmpeg_dir: ffmpeg_dir.clone(),
        clips: clips.clone(),
        audio_only,
        audio_bitrate_kbps: request.audio_bitrate_kbps.unwrap_or(DEFAULT_AUDIO_KBPS),
        gif: request.gif,
        post: if audio_only {
            VideoPost::default()
        } else {
            VideoPost {
                frame: request.frame,
                texts: text_filters(app, &request.texts).await?,
            }
        },
    };
    let (app_for_task, job_id_for_task) = (app.clone(), job_id.clone());
    tauri::async_runtime::spawn(async move {
        run_remote_edit(app_for_task, job_id_for_task, child, stdout, stderr, job).await;
    });
    Ok(job_id)
}

/// Birden çok kaynağı (dosya ve link karışık) tek çıktıda birleştirir.
/// Linklerin yalnızca kliplenen bölümleri indirilir. Kaynaklar farklı boyut,
/// kare hızı ya da ses biçiminde olabileceğinden çıktı her zaman yeniden
/// kodlanır (`merge_inputs_args`'ın normalize zinciriyle).
async fn start_multi(
    app: &AppHandle,
    request: &EditRequest,
    inputs: &[EditInput],
) -> Result<String, AppError> {
    if request.gif.is_some() {
        return Err(AppError::coded(
            "multiGif",
            "Birden çok kaynak birleştirilirken GIF yapılamaz; GIF için tek kaynak kullanın.",
            None,
        ));
    }
    let ffmpeg_dir = ffmpeg::binary::ensure_ffmpeg(app).await?;
    // Yerel kaynakların süresi bilinir: her klip kendi kaynağına göre sığdırılır.
    let mut durations: Vec<Option<f64>> = Vec::with_capacity(inputs.len());
    for input in inputs {
        match (&input.input_path, &input.url) {
            (Some(path), _) => {
                let info = ffmpeg::convert::probe_file(&ffmpeg_dir, path).await?;
                durations.push(info.duration_seconds);
            }
            (None, Some(url)) if !url.trim().is_empty() => durations.push(None),
            _ => return Err(AppError::new("Kaynak seçilmedi.", None)),
        }
    }
    let clips = normalize_clips(&request.clips, &durations)?;
    let ytdlp_path = ytdlp::binary::ensure_ytdlp(app).await?;

    let job_id = Uuid::new_v4().to_string();
    let work_dir =
        paths::cache_dir(app, "edit")?.join(work_dir_name(request.work_key.as_deref(), &job_id));
    tokio::fs::create_dir_all(&work_dir)
        .await
        .map_err(|e| AppError::new(ERROR_MESSAGE, Some(e.to_string())))?;

    let audio_only = request.audio_only;
    let job = MultiEdit {
        work_dir,
        destination_dir: PathBuf::from(&request.destination_dir),
        output_name: sanitize_name(&request.output_name),
        ffmpeg_dir,
        ytdlp_path,
        clips,
        sources: inputs
            .iter()
            .map(|i| MultiSource {
                local_path: i.input_path.clone(),
                url: i.url.clone(),
                files: Vec::new(),
            })
            .collect(),
        audio_only,
        output_format: request.output_format.clone(),
        max_height: request.max_height,
        audio_bitrate_kbps: request.audio_bitrate_kbps.unwrap_or(DEFAULT_AUDIO_KBPS),
        rate_limit_kbps: request.rate_limit_kbps,
        post: if audio_only {
            VideoPost::default()
        } else {
            VideoPost {
                frame: request.frame,
                texts: text_filters(app, &request.texts).await?,
            }
        },
    };
    let (app_for_task, job_id_for_task) = (app.clone(), job_id.clone());
    tauri::async_runtime::spawn(async move {
        run_multi_edit(app_for_task, job_id_for_task, job).await;
    });
    Ok(job_id)
}

/// Çoklu kaynak işinin tek girdisi: yerel dosya ya da link (+ inen bölümler).
struct MultiSource {
    local_path: Option<String>,
    url: Option<String>,
    /// Linkten indirilen bölümler; o kaynağın siyah olmayan klipleriyle sırayla eşleşir.
    files: Vec<String>,
}

struct MultiEdit {
    work_dir: PathBuf,
    destination_dir: PathBuf,
    output_name: String,
    ffmpeg_dir: PathBuf,
    ytdlp_path: PathBuf,
    clips: Vec<Clip>,
    sources: Vec<MultiSource>,
    audio_only: bool,
    output_format: Option<String>,
    max_height: Option<u32>,
    audio_bitrate_kbps: u32,
    rate_limit_kbps: Option<u32>,
    post: VideoPost,
}

/// Bir link kaynağının kliplenen bölümlerini indirir; dosya yollarını döner.
/// `first`: işin ilk süreciyse `register`, değilse `replace_pid` ile kaydolur.
async fn download_source_sections(
    app: &AppHandle,
    job_id: &str,
    job: &MultiEdit,
    index: usize,
    url: &str,
    clips: &[Clip],
    first: bool,
) -> Result<Vec<String>, MergeFailure> {
    let platform = crate::platform::detect_platform(url).unwrap_or("");
    let js_args = ytdlp::jsruntime::ytdlp_args(app, platform).await;
    let mut args = download::build_format_args(&DownloadRequest {
        url: url.to_string(),
        destination_dir: String::new(),
        filename_template: String::new(),
        audio_only: job.audio_only,
        max_height: job.max_height,
        format_id: None,
        output_format: Some(if job.audio_only {
            audio_format(job.output_format.as_deref(), "m4a").to_string()
        } else {
            job.output_format.clone().unwrap_or_else(|| "mp4".into())
        }),
        audio_bitrate_kbps: Some(job.audio_bitrate_kbps),
        subtitles: false,
        subtitle_langs: Vec::new(),
        auto_subtitles: false,
        rate_limit_kbps: job.rate_limit_kbps,
        section_start: None,
        section_end: None,
        embed_metadata: false,
        sponsor_block: false,
    });
    args.extend(section_args(clips));
    args.extend(js_args);
    args.extend([
        "--newline".into(),
        "--encoding".into(),
        "utf-8".into(),
        "--print".into(),
        format!("after_move:{FILE_PREFIX}%(filepath)j"),
        "--ffmpeg-location".into(),
        job.ffmpeg_dir.to_string_lossy().into_owned(),
        "-o".into(),
        // Kaynak öneki: farklı kaynakların aynı aralıkları çakışmasın.
        job.work_dir
            .join(format!("s{index}-%(section_start)s-%(section_end)s.%(ext)s"))
            .to_string_lossy()
            .into_owned(),
        "--no-playlist".into(),
        url.to_string(),
    ]);

    let mut command = Command::new(&job.ytdlp_path);
    command
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    jobs::hide_console(&mut command);
    let mut child = command
        .spawn()
        .map_err(|e| MergeFailure::Merge(e.to_string()))?;
    if let Some(pid) = child.id() {
        let enrolled = if first {
            jobs::register(app, job_id, pid);
            true
        } else {
            jobs::replace_pid(app, job_id, pid)
        };
        if !enrolled {
            let _ = child.kill().await;
            return Err(MergeFailure::Canceled);
        }
    }

    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");
    let mut stdout = BufReader::new(stdout);
    let mut stderr = BufReader::new(stderr);
    let (mut out_buf, mut err_buf) = (Vec::new(), Vec::new());
    let mut stderr_done = false;
    let mut summary = StderrSummary::default();
    let mut files: Vec<String> = Vec::new();
    // Bölüm indirmede yt-dlp ara ilerleme vermiyor; iş klasörünün büyüyen
    // boyutu izlenir, yüzdeyi arayüz tahmini boyuta oranlar.
    let mut ticker = tokio::time::interval(Duration::from_millis(750));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut last_poll: Option<(u64, Instant)> = None;

    loop {
        tokio::select! {
            _ = ticker.tick() => {
                let bytes = dir_bytes(&job.work_dir).await;
                let now = Instant::now();
                let speed = last_poll.and_then(|(prev, at)| {
                    let dt = now.duration_since(at).as_secs_f64();
                    (bytes > prev && dt > 0.0).then(|| (bytes - prev) as f64 / dt)
                });
                if bytes > last_poll.map_or(0, |(prev, _)| prev) {
                    let _ = app.emit("edit-progress", EditProgressPayload {
                        job_id: job_id.to_string(),
                        percent: None,
                        stage: "downloading",
                        downloaded_bytes: Some(bytes),
                        speed_bps: speed,
                    });
                }
                last_poll = Some((bytes, now));
            }
            line = jobs::read_line_lossy(&mut stdout, &mut out_buf) => {
                let Some(line) = line else { break };
                if let Some(rest) = line.trim().strip_prefix(FILE_PREFIX) {
                    if let Ok(path) = serde_json::from_str::<String>(rest) {
                        files.push(path);
                    }
                }
            }
            line = jobs::read_line_lossy(&mut stderr, &mut err_buf), if !stderr_done => {
                match line {
                    Some(line) => summary.push(&line),
                    None => stderr_done = true,
                }
            }
        }
    }
    while !stderr_done {
        match jobs::read_line_lossy(&mut stderr, &mut err_buf).await {
            Some(line) => summary.push(&line),
            None => stderr_done = true,
        }
    }
    let succeeded = matches!(child.wait().await, Ok(s) if s.success());
    if succeeded && !files.is_empty() {
        Ok(files)
    } else {
        Err(MergeFailure::Download)
    }
}

async fn run_multi_edit(app: AppHandle, job_id: String, mut job: MultiEdit) {
    let result = run_multi_inner(&app, &job_id, &mut job).await;
    let finished = jobs::finish(&app, &job_id);
    // Duraklatmada indirilen bölümler kalır (sürdürünce yeniden inmez).
    let paused = finished.canceled && !finished.discard_partial;
    if !paused {
        let _ = tokio::fs::remove_dir_all(&job.work_dir).await;
    }
    if finished.canceled || matches!(result, Err(MergeFailure::Canceled)) {
        if let Ok(path) = &result {
            let _ = tokio::fs::remove_file(path).await;
        }
        emit_canceled(&app, job_id);
        return;
    }
    match result {
        Ok(path) => {
            let size = tokio::fs::metadata(&path)
                .await
                .map(|m| m.len())
                .unwrap_or(0);
            let _ = app.emit(
                "edit-complete",
                JobCompletePayload {
                    job_id,
                    file_path: path.to_string_lossy().into_owned(),
                    file_size_bytes: size,
                    notice: None,
                },
            );
        }
        Err(MergeFailure::Download) => {
            emit_error(
                &app,
                job_id,
                "downloadFailed",
                "İndirme tamamlanamadı. Tekrar deneyin.",
                String::new(),
            );
        }
        Err(MergeFailure::Friendly { code, message }) => {
            emit_error(&app, job_id, code, message, String::new());
        }
        Err(MergeFailure::Merge(detail)) => {
            emit_error(&app, job_id, "editFailed", ERROR_MESSAGE, detail);
        }
        Err(MergeFailure::Canceled) => emit_canceled(&app, job_id),
    }
}

async fn run_multi_inner(
    app: &AppHandle,
    job_id: &str,
    job: &mut MultiEdit,
) -> Result<PathBuf, MergeFailure> {
    // Kliplerin kullandığı kaynaklar; klibi olmayan link indirilmez.
    let mut used = vec![false; job.sources.len()];
    for clip in &job.clips {
        if !clip.black {
            if let Some(slot) = used.get_mut(clip.source) {
                *slot = true;
            }
        }
    }

    // 1) Link kaynakları sırayla indirilir (yalnızca kliplenen bölümler).
    let mut first_spawn = true;
    for index in 0..job.sources.len() {
        if !used[index] || job.sources[index].url.is_none() {
            continue;
        }
        let clips_of: Vec<Clip> = job
            .clips
            .iter()
            .filter(|c| !c.black && c.source == index)
            .copied()
            .collect();
        if clips_of.is_empty() {
            continue;
        }
        let url = job.sources[index].url.clone().unwrap_or_default();
        let files =
            download_source_sections(app, job_id, job, index, &url, &clips_of, first_spawn).await?;
        job.sources[index].files = files;
        first_spawn = false;
    }

    // 2) Her kaynağın akışları ölçülür: görüntü/ses birleştirilebilir mi?
    let mut audio_states: Vec<bool> = Vec::new();
    let mut target: Option<(u32, u32)> = None;
    for index in 0..job.sources.len() {
        if !used[index] {
            continue;
        }
        let probe_path = job.sources[index]
            .local_path
            .clone()
            .or_else(|| job.sources[index].files.first().cloned());
        let Some(path) = probe_path else {
            continue;
        };
        let info = ffmpeg::convert::probe_file(&job.ffmpeg_dir, &path)
            .await
            .map_err(|e| MergeFailure::Merge(e.message))?;
        if !job.audio_only && info.video_codec.is_none() {
            return Err(MergeFailure::Friendly {
                code: "multiNoVideo",
                message: "Kaynaklardan birinde görüntü yok; birlikte dışa aktarılamaz.",
            });
        }
        audio_states.push(info.audio_codec.is_some());
        if target.is_none() {
            if let (Some(w), Some(h)) = (info.width, info.height) {
                target = Some((w, h));
            }
        }
    }
    let audio = if audio_states.iter().all(|a| *a) {
        !audio_states.is_empty()
    } else if audio_states.iter().all(|a| !*a) {
        if job.audio_only {
            return Err(MergeFailure::Friendly {
                code: "multiNoAudio",
                message: "Kaynaklarda ses yok; ses dosyası üretilemez.",
            });
        }
        false
    } else {
        return Err(MergeFailure::Friendly {
            code: "multiNoAudio",
            message: "Kaynaklardan birinde ses yok; birlikte dışa aktarılamaz.",
        });
    };
    let video = !job.audio_only;

    // 3) Birleştirme girişleri: yerel klip dosyadan kesilir, link klibi sıradaki
    //    indirilen bölüm, siyah boşluk o kaynağın (yoksa herhangi bir kaynağın)
    //    küçük bir diliminden üretilir.
    let black_fallback = job
        .sources
        .iter()
        .enumerate()
        .filter(|(i, _)| used[*i])
        .find_map(|(_, s)| s.local_path.as_deref().or_else(|| s.files.first().map(String::as_str)));
    let mut next_file = vec![0usize; job.sources.len()];
    let mut merge_inputs: Vec<edit_args::MergeInput> = Vec::new();
    for clip in &job.clips {
        let s = clip.source.min(job.sources.len().saturating_sub(1));
        let own_file = job.sources[s]
            .local_path
            .as_deref()
            .or_else(|| job.sources[s].files.first().map(String::as_str));
        if clip.black {
            let Some(path) = own_file.or(black_fallback) else {
                continue;
            };
            merge_inputs.push(edit_args::MergeInput {
                path,
                range: Some((0.0, edit_args::BLACK_SOURCE_SECONDS)),
                clip: *clip,
            });
        } else if let Some(path) = job.sources[s].local_path.as_deref() {
            merge_inputs.push(edit_args::MergeInput {
                path,
                range: Some((clip.start, clip.duration())),
                clip: *clip,
            });
        } else {
            let i = next_file[s];
            next_file[s] += 1;
            let Some(path) = job.sources[s].files.get(i).map(String::as_str) else {
                return Err(MergeFailure::Merge(format!(
                    "kaynak {s} için indirilen bölüm eksik"
                )));
            };
            merge_inputs.push(edit_args::MergeInput {
                path,
                range: None,
                clip: *clip,
            });
        }
    }

    // 4) Çıktı: ses işi istenen/yedek ses biçimi, görüntü işi mp4|mkv|webm.
    let extension = if !video {
        audio_format(job.output_format.as_deref(), "m4a").to_string()
    } else {
        match job.output_format.as_deref() {
            Some("mkv") => "mkv".to_string(),
            Some("webm") => "webm".to_string(),
            _ => "mp4".to_string(),
        }
    };
    tokio::fs::create_dir_all(&job.destination_dir)
        .await
        .map_err(|e| MergeFailure::Merge(e.to_string()))?;
    let output = jobs::unique_output_path(&job.destination_dir, &job.output_name, &extension);

    let _ = app.emit(
        "edit-progress",
        EditProgressPayload {
            job_id: job_id.to_string(),
            percent: None,
            stage: "merging",
            downloaded_bytes: None,
            speed_bps: None,
        },
    );
    let output_text = output.to_string_lossy().into_owned();
    let audio_format_arg = (!video).then_some((extension.as_str(), job.audio_bitrate_kbps));
    let post = if video {
        job.post.clone()
    } else {
        VideoPost::default()
    };
    let args = edit_args::merge_inputs_args(
        &merge_inputs,
        &output_text,
        Streams { video, audio },
        if video { target } else { None },
        audio,
        audio_format_arg,
        &post,
    );
    let mut command = Command::new(job.ffmpeg_dir.join("ffmpeg.exe"));
    command
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    jobs::hide_console(&mut command);
    let mut child = command
        .spawn()
        .map_err(|e| MergeFailure::Merge(e.to_string()))?;
    if let Some(pid) = child.id() {
        let enrolled = if first_spawn {
            jobs::register(app, job_id, pid);
            true
        } else {
            jobs::replace_pid(app, job_id, pid)
        };
        if !enrolled {
            let _ = child.kill().await;
            return Err(MergeFailure::Canceled);
        }
    }
    match child.wait_with_output().await {
        Ok(out) if out.status.success() => Ok(output),
        Ok(out) => {
            let _ = tokio::fs::remove_file(&output).await;
            let stderr = String::from_utf8_lossy(&out.stderr);
            let tail: String = stderr
                .chars()
                .rev()
                .take(4000)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
            Err(MergeFailure::Merge(tail))
        }
        Err(e) => {
            let _ = tokio::fs::remove_file(&output).await;
            Err(MergeFailure::Merge(e.to_string()))
        }
    }
}

/// yt-dlp verilen sırayla indirir; her klip ayrı bir `--download-sections`.
fn section_args(clips: &[Clip]) -> Vec<String> {
    // Siyah boşluklar indirilmez; birleştirirken üretilir.
    let mut args: Vec<String> = clips
        .iter()
        .filter(|c| !c.black)
        .flat_map(|c| {
            [
                "--download-sections".to_string(),
                format!("*{}-{}", seconds_arg(c.start), seconds_arg(c.end)),
            ]
        })
        .collect();
    args.push("--force-keyframes-at-cuts".into());
    args
}

async fn dir_bytes(dir: &Path) -> u64 {
    let Ok(mut entries) = tokio::fs::read_dir(dir).await else {
        return 0;
    };
    let mut total = 0;
    while let Ok(Some(entry)) = entries.next_entry().await {
        total += entry.metadata().await.map(|m| m.len()).unwrap_or(0);
    }
    total
}

fn emit_error(app: &AppHandle, job_id: String, code: &'static str, message: &str, detail: String) {
    let _ = app.emit(
        "edit-error",
        JobErrorPayload {
            job_id,
            message: message.to_string(),
            raw_detail: Some(detail),
            code: Some(code),
        },
    );
}

fn emit_canceled(app: &AppHandle, job_id: String) {
    let _ = app.emit(
        "edit-canceled",
        JobCanceledPayload {
            job_id,
            partial_target: None,
        },
    );
}

async fn run_remote_edit(
    app: AppHandle,
    job_id: String,
    mut child: tokio::process::Child,
    stdout: tokio::process::ChildStdout,
    stderr: tokio::process::ChildStderr,
    job: RemoteEdit,
) {
    let mut stdout = BufReader::new(stdout);
    let mut stderr = BufReader::new(stderr);
    let (mut out_buf, mut err_buf) = (Vec::new(), Vec::new());
    let mut stderr_done = false;
    let mut summary = StderrSummary::default();
    let mut files: Vec<String> = Vec::new();
    // Bölüm indirmede yt-dlp ara ilerleme vermiyor; iş klasörünün büyüyen
    // boyutu izlenir, yüzdeyi arayüz tahmini boyuta oranlar.
    let mut ticker = tokio::time::interval(Duration::from_millis(750));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut last_poll: Option<(u64, Instant)> = None;

    loop {
        tokio::select! {
            _ = ticker.tick() => {
                let bytes = dir_bytes(&job.work_dir).await;
                let now = Instant::now();
                let speed = last_poll.and_then(|(prev, at)| {
                    let dt = now.duration_since(at).as_secs_f64();
                    (bytes > prev && dt > 0.0).then(|| (bytes - prev) as f64 / dt)
                });
                if bytes > last_poll.map_or(0, |(prev, _)| prev) {
                    let _ = app.emit("edit-progress", EditProgressPayload {
                        job_id: job_id.clone(),
                        percent: None,
                        stage: "downloading",
                        downloaded_bytes: Some(bytes),
                        speed_bps: speed,
                    });
                }
                last_poll = Some((bytes, now));
            }
            line = jobs::read_line_lossy(&mut stdout, &mut out_buf) => {
                let Some(line) = line else { break };
                if let Some(rest) = line.trim().strip_prefix(FILE_PREFIX) {
                    if let Ok(path) = serde_json::from_str::<String>(rest) {
                        files.push(path);
                    }
                }
            }
            line = jobs::read_line_lossy(&mut stderr, &mut err_buf), if !stderr_done => {
                match line {
                    Some(line) => summary.push(&line),
                    None => stderr_done = true,
                }
            }
        }
    }
    while !stderr_done {
        match jobs::read_line_lossy(&mut stderr, &mut err_buf).await {
            Some(line) => summary.push(&line),
            None => stderr_done = true,
        }
    }
    let succeeded = matches!(child.wait().await, Ok(s) if s.success());

    let result = if succeeded && !files.is_empty() {
        merge_sections(&app, &job_id, &job, &files).await
    } else {
        Err(MergeFailure::Download)
    };
    let finished = jobs::finish(&app, &job_id);
    // Duraklatmada indirilen bölümler kalır (sürdürünce yeniden inmez); diğer
    // her durumda iş klasörü temizlenir.
    let paused = finished.canceled && !finished.discard_partial;
    if !paused {
        let _ = tokio::fs::remove_dir_all(&job.work_dir).await;
    }

    if finished.canceled || matches!(result, Err(MergeFailure::Canceled)) {
        // Birleştirme iptalden hemen önce bittiyse çıktı da istenmiyor demektir.
        if let Ok(path) = &result {
            let _ = tokio::fs::remove_file(path).await;
        }
        emit_canceled(&app, job_id);
        return;
    }

    match result {
        Err(MergeFailure::Canceled) => emit_canceled(&app, job_id),
        Ok(path) => {
            let size = tokio::fs::metadata(&path)
                .await
                .map(|m| m.len())
                .unwrap_or(0);
            let _ = app.emit(
                "edit-complete",
                JobCompletePayload {
                    job_id,
                    file_path: path.to_string_lossy().into_owned(),
                    file_size_bytes: size,
                    notice: None,
                },
            );
        }
        Err(MergeFailure::Download) => {
            let friendly = ytdlp::errors::friendly(summary.error_text());
            emit_error(
                &app,
                job_id,
                friendly.map(|f| f.code).unwrap_or("downloadFailed"),
                friendly
                    .map(|f| f.message)
                    .unwrap_or("İndirme tamamlanamadı. Tekrar deneyin."),
                summary.tail,
            );
        }
        Err(MergeFailure::Friendly { code, message }) => {
            emit_error(&app, job_id, code, message, String::new());
        }
        Err(MergeFailure::Merge(detail)) => {
            emit_error(&app, job_id, "editFailed", ERROR_MESSAGE, detail);
        }
    }
}

enum MergeFailure {
    Download,
    Canceled,
    /// Kullanıcıya kendi dilinde gösterilecek hata (kod + ileti).
    Friendly {
        code: &'static str,
        message: &'static str,
    },
    Merge(String),
}

/// İndirilen bölümleri kayıt klasöründe tek dosyada birleştirir. Tek bölümse
/// yalnızca taşınır.
async fn merge_sections(
    app: &AppHandle,
    job_id: &str,
    job: &RemoteEdit,
    files: &[String],
) -> Result<PathBuf, MergeFailure> {
    let extension = if job.gif.is_some() {
        "gif".to_string()
    } else {
        Path::new(&files[0])
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("mp4")
            .to_string()
    };
    // Platform alt klasörü ("YouTube…") henüz olmayabilir.
    tokio::fs::create_dir_all(&job.destination_dir)
        .await
        .map_err(|e| MergeFailure::Merge(e.to_string()))?;
    let output = jobs::unique_output_path(&job.destination_dir, &job.output_name, &extension);

    if files.len() == 1 && !job.needs_reencode() && job.gif.is_none() {
        // Farklı sürücüye taşımada rename başarısız olur; kopyalanır.
        if tokio::fs::rename(&files[0], &output).await.is_err() {
            tokio::fs::copy(&files[0], &output)
                .await
                .map_err(|e| MergeFailure::Merge(e.to_string()))?;
        }
        return Ok(output);
    }

    let _ = app.emit(
        "edit-progress",
        EditProgressPayload {
            job_id: job_id.to_string(),
            percent: None,
            stage: "merging",
            downloaded_bytes: None,
            speed_bps: None,
        },
    );
    let output_text = output.to_string_lossy().into_owned();
    // İndirilen bölümler kliplerle sırayla eşleşir; siyah boşluklar ilk
    // bölümün küçük bir diliminden üretilir.
    let section_inputs = || -> Vec<edit_args::MergeInput> {
        let mut downloaded = files.iter();
        job.clips
            .iter()
            .filter_map(|clip| {
                if clip.black {
                    Some(edit_args::MergeInput {
                        path: &files[0],
                        range: Some((0.0, edit_args::BLACK_SOURCE_SECONDS)),
                        clip: *clip,
                    })
                } else {
                    downloaded.next().map(|path| edit_args::MergeInput {
                        path,
                        range: None,
                        clip: *clip,
                    })
                }
            })
            .collect()
    };
    let args = if let Some(gif) = job.gif {
        edit_args::gif_args(&section_inputs(), &output_text, gif, &job.post)
    } else if job.needs_reencode() {
        // Hız değişen bölümler yeniden kodlanarak (görüntü setpts, ses atempo) birleşir.
        let info = ffmpeg::convert::probe_file(&job.ffmpeg_dir, &files[0])
            .await
            .map_err(|e| MergeFailure::Merge(e.message))?;
        let streams = Streams {
            video: info.video_codec.is_some() && !job.audio_only,
            audio: info.audio_codec.is_some(),
        };
        let audio_format = (!streams.video).then_some((extension.as_str(), job.audio_bitrate_kbps));
        let post = if streams.video {
            job.post.clone()
        } else {
            VideoPost::default()
        };
        edit_args::merge_inputs_args(
            &section_inputs(),
            &output_text,
            streams,
            None,
            false,
            audio_format,
            &post,
        )
    } else {
        let list_path = job.work_dir.join("list.txt");
        tokio::fs::write(&list_path, edit_args::concat_list(files))
            .await
            .map_err(|e| MergeFailure::Merge(e.to_string()))?;
        edit_args::concat_copy_args(&list_path.to_string_lossy(), &output_text)
    };
    let mut command = Command::new(job.ffmpeg_exe());
    command
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    jobs::hide_console(&mut command);
    let mut child = command
        .spawn()
        .map_err(|e| MergeFailure::Merge(e.to_string()))?;
    if let Some(pid) = child.id() {
        if !jobs::replace_pid(app, job_id, pid) {
            let _ = child.kill().await;
            return Err(MergeFailure::Canceled);
        }
    }
    let result = child.wait_with_output().await;
    match result {
        Ok(out) if out.status.success() => Ok(output),
        Ok(out) => {
            let _ = tokio::fs::remove_file(&output).await;
            let stderr = String::from_utf8_lossy(&out.stderr);
            let tail: String = stderr
                .chars()
                .rev()
                .take(4000)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
            Err(MergeFailure::Merge(tail))
        }
        Err(e) => {
            let _ = tokio::fs::remove_file(&output).await;
            Err(MergeFailure::Merge(e.to_string()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clip(start: f64, end: f64) -> Clip {
        Clip::new(start, end)
    }

    #[test]
    fn klipler_sureye_sigdirilir_kisalar_atilir() {
        let clips = [clip(-5.0, 10.0), clip(50.0, 50.05), clip(95.0, 200.0)];
        let out = normalize_clips(&clips, &[Some(100.0)]).unwrap();
        assert_eq!(out, vec![clip(0.0, 10.0), clip(95.0, 100.0)]);
    }

    #[test]
    fn her_klip_kendi_kaynaginin_suresine_sigdirilir() {
        let second = Clip {
            source: 1,
            ..clip(40.0, 200.0)
        };
        let clips = [clip(0.0, 500.0), second];
        // 1. kaynak 100 sn, 2. kaynak 60 sn: her klip kendi kaynağına göre kesilir.
        let out = normalize_clips(&clips, &[Some(100.0), Some(60.0)]).unwrap();
        assert_eq!(out, vec![clip(0.0, 100.0), Clip { source: 1, ..clip(40.0, 60.0) }]);
        // Süresi bilinmeyen (link) kaynak kısıtlanmaz.
        let out = normalize_clips(&clips, &[Some(100.0), None]).unwrap();
        assert_eq!(out, vec![clip(0.0, 100.0), second]);
    }

    #[test]
    fn gecerli_klip_yoksa_hata_verir() {
        let err = normalize_clips(&[clip(10.0, 5.0)], &[None]).unwrap_err();
        assert_eq!(err.code, Some("invalidRange"));
        let many = vec![clip(0.0, 1.0); MAX_CLIPS + 1];
        assert_eq!(
            normalize_clips(&many, &[None]).unwrap_err().code,
            Some("tooManyClips")
        );
    }

    #[test]
    fn dosya_adi_windowsa_uygun_hale_gelir() {
        assert_eq!(sanitize_name("Maç: özet / 2. yarı?"), "Maç özet 2. yarı");
        assert_eq!(sanitize_name("  ...  "), "klip");
        assert_eq!(sanitize_name("con"), "klip");
        assert_eq!(sanitize_name("son."), "son");
        assert_eq!(
            sanitize_name(&"a".repeat(300)).chars().count(),
            MAX_NAME_CHARS
        );
    }

    #[test]
    fn ses_bicimi_istek_kaynak_ve_varsayilan_sirasiyla_secilir() {
        assert_eq!(audio_format(Some("mp3"), "mp4"), "mp3");
        assert_eq!(audio_format(Some("mp4"), "flac"), "flac");
        assert_eq!(audio_format(None, "mkv"), "m4a");
    }

    #[test]
    fn is_klasoru_adi_yol_disina_cikamaz() {
        assert_eq!(work_dir_name(Some("a1b2-c3"), "yedek"), "a1b2-c3");
        assert_eq!(work_dir_name(Some("../../Windows"), "yedek"), "yedek");
        assert_eq!(work_dir_name(Some(""), "yedek"), "yedek");
        assert_eq!(work_dir_name(None, "yedek"), "yedek");
    }

    #[test]
    fn her_klip_ayri_bolum_olarak_istenir() {
        let args = section_args(&[clip(600.0, 615.5), clip(30.0, 40.0)]).join(" ");
        assert_eq!(
            args,
            "--download-sections *600-615.5 --download-sections *30-40 --force-keyframes-at-cuts"
        );
    }

    #[test]
    fn siyah_bosluk_indirilmez() {
        let gap = Clip {
            black: true,
            ..clip(0.0, 90.0)
        };
        let args = section_args(&[clip(600.0, 615.5), gap, clip(30.0, 40.0)]).join(" ");
        assert_eq!(
            args,
            "--download-sections *600-615.5 --download-sections *30-40 --force-keyframes-at-cuts"
        );
    }
}
