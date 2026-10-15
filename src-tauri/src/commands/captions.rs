//! Otomatik altyazı: konuşma bilgisayarda yazıya dökülür (whisper.cpp, MIT lisanslı;
//! internete ses gönderilmez). Motor ve dil modeli ilk kullanımda indirilir, sonra
//! hep bilgisayardan çalışır. Zaman çizelgesinde kullanılan kaynak bölümlerinin sesi
//! FFmpeg ile 16 kHz tek kanala çevrilir, motor her kelimenin başını ve sonunu verir.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Mutex as StdMutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::io::BufReader;
use tokio::process::Command;
use tokio::sync::Mutex;

use crate::error::AppError;
use crate::{ffmpeg, jobs, paths, tool_download};

/// Sabit derleme: "latest" sürümünde Windows dosyası olmuyor; denenmiş derleme kullanılır.
const WHISPER_ZIP_URL: &str =
    "https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip";
const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

/// Dil modelleri: hızlı (base, ~150 MB) ve daha doğru (small, ~490 MB).
fn model_file(model: &str) -> &'static str {
    match model {
        "small" => "ggml-small.bin",
        _ => "ggml-base.bin",
    }
}

fn download_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// Çalışan motorun süreç kimliği (İptal için).
fn running() -> &'static StdMutex<Option<u32>> {
    static PID: OnceLock<StdMutex<Option<u32>>> = OnceLock::new();
    PID.get_or_init(|| StdMutex::new(None))
}

fn whisper_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = paths::bin_dir(app)?.join("whisper");
    std::fs::create_dir_all(&dir)
        .map_err(|e| AppError::new("Klasör oluşturulamadı.", Some(e.to_string())))?;
    Ok(dir)
}

/// Motor (whisper-cli.exe ve DLL'leri) yoksa indirilir.
async fn ensure_whisper(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = whisper_dir(app)?;
    let exe = dir.join("whisper-cli.exe");
    if exe.exists() {
        return Ok(exe);
    }
    let _guard = download_lock().lock().await;
    if exe.exists() {
        return Ok(exe);
    }
    let bytes = tool_download::fetch("whisper", WHISPER_ZIP_URL)
        .await
        .map_err(|detail| {
            AppError::coded(
                "toolDownloadFailed",
                "Altyazı motoru indirilemedi. İnternet bağlantını kontrol et.",
                Some(detail),
            )
        })?;
    let dest = dir.clone();
    tokio::task::spawn_blocking(move || extract_whisper(&bytes, &dest))
        .await
        .map_err(|e| AppError::new("Altyazı motoru açılamadı.", Some(e.to_string())))??;
    if !exe.exists() {
        return Err(AppError::new(
            "Altyazı motoru paketinde whisper-cli.exe bulunamadı.",
            None,
        ));
    }
    Ok(exe)
}

/// Zip'teki whisper-cli.exe ve .dll dosyaları klasör yapısı olmadan çıkarılır (DLL'ler exe'nin yanında olmalı).
fn extract_whisper(zip_bytes: &[u8], dest: &Path) -> Result<(), AppError> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(zip_bytes))
        .map_err(|e| AppError::new("Altyazı motoru paketi açılamadı.", Some(e.to_string())))?;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| AppError::new("Altyazı motoru paketi okunamadı.", Some(e.to_string())))?;
        let name = entry.name().replace('\\', "/");
        let Some(file) = name.rsplit('/').next().map(str::to_string) else {
            continue;
        };
        let lower = file.to_ascii_lowercase();
        // Yalnızca motor ve kütüphaneleri; paketteki deneme ve örnek programlar alınmaz.
        if !(lower == "whisper-cli.exe" || lower.ends_with(".dll")) || file.contains("..") {
            continue;
        }
        let tmp = dest.join(format!("{file}.tmp"));
        let mut out = std::fs::File::create(&tmp)
            .map_err(|e| AppError::new("Altyazı motoru diske yazılamadı.", Some(e.to_string())))?;
        std::io::copy(&mut entry, &mut out)
            .map_err(|e| AppError::new("Altyazı motoru diske yazılamadı.", Some(e.to_string())))?;
        drop(out);
        std::fs::rename(&tmp, dest.join(&file))
            .map_err(|e| AppError::new("Altyazı motoru diske yazılamadı.", Some(e.to_string())))?;
    }
    Ok(())
}

/// Dil modeli yoksa indirilir.
async fn ensure_model(app: &AppHandle, model: &str) -> Result<PathBuf, AppError> {
    let file = model_file(model);
    let path = whisper_dir(app)?.join(file);
    if path.exists() {
        return Ok(path);
    }
    let _guard = download_lock().lock().await;
    if path.exists() {
        return Ok(path);
    }
    let bytes = tool_download::fetch("whisperModel", &format!("{MODEL_URL}/{file}"))
        .await
        .map_err(|detail| {
            AppError::coded(
                "toolDownloadFailed",
                "Altyazı dil modeli indirilemedi. İnternet bağlantını kontrol et.",
                Some(detail),
            )
        })?;
    let tmp = path.with_extension("bin.tmp");
    tokio::fs::write(&tmp, bytes)
        .await
        .map_err(|e| AppError::new("Dil modeli diske yazılamadı.", Some(e.to_string())))?;
    tokio::fs::rename(&tmp, &path)
        .await
        .map_err(|e| AppError::new("Dil modeli diske yazılamadı.", Some(e.to_string())))?;
    Ok(path)
}

/// Bulunan kelime; zamanlar kaynak dosyanın saniyesi.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Word {
    pub text: String,
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Deserialize)]
struct WhisperJson {
    transcription: Vec<Segment>,
}

#[derive(Debug, Deserialize)]
struct Segment {
    offsets: Offsets,
    text: String,
}

#[derive(Debug, Deserialize)]
struct Offsets {
    from: f64,
    to: f64,
}

/// Motorun JSON çıktısından kelimeler; `offset` bölümün kaynaktaki başlangıcı.
/// Boş parçalar ve "[Müzik]" gibi açıklamalar atlanır.
pub fn parse_words(json: &str, offset: f64) -> Result<Vec<Word>, String> {
    let data: WhisperJson = serde_json::from_str(json).map_err(|e| e.to_string())?;
    Ok(data
        .transcription
        .into_iter()
        .filter_map(|s| {
            let text = s.text.trim().to_string();
            let noise = (text.starts_with('[') && text.ends_with(']'))
                || (text.starts_with('(') && text.ends_with(')'));
            (!text.is_empty() && !noise).then(|| Word {
                text,
                start: offset + s.offsets.from / 1000.0,
                end: offset + (s.offsets.to / 1000.0).max(s.offsets.from / 1000.0 + 0.05),
            })
        })
        .collect())
}

/// "whisper_print_progress_callback: progress =  45%" → 45.
fn progress_of(line: &str) -> Option<f64> {
    let (_, rest) = line.split_once("progress =")?;
    rest.trim().trim_end_matches('%').trim().parse().ok()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptionsProgress {
    /// "audio" | "transcribe"
    stage: &'static str,
    /// Bütün bölümler için 0–100.
    percent: f64,
}

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Range {
    pub start: f64,
    pub end: f64,
}

/// Kaynaktaki bölümleri yazıya döker. `language`: "auto", "tr", "en"…
#[tauri::command]
pub async fn captions_transcribe(
    app: AppHandle,
    path: String,
    ranges: Vec<Range>,
    language: String,
    model: String,
) -> Result<Vec<Word>, AppError> {
    let source = Path::new(&path);
    if !crate::commands::files::is_openable(source) || !source.is_file() {
        return Err(AppError::new("Bu dosya yazıya dökülemiyor.", Some(path)));
    }
    let lang: String = language
        .chars()
        .filter(|c| c.is_ascii_alphabetic())
        .take(8)
        .collect();
    let lang = if lang.is_empty() {
        "auto".to_string()
    } else {
        lang
    };
    let ranges: Vec<Range> = ranges
        .into_iter()
        .filter(|r| r.start.is_finite() && r.end.is_finite() && r.end - r.start >= 0.3)
        .take(200)
        .collect();
    if ranges.is_empty() {
        return Ok(Vec::new());
    }
    let ffmpeg_dir = ffmpeg::binary::ensure_ffmpeg(&app).await?;
    let exe = ensure_whisper(&app).await?;
    let model_path = ensure_model(&app, &model).await?;
    let work = paths::cache_dir(&app, "captions")?;
    let threads = std::thread::available_parallelism()
        .map(|n| n.get().clamp(2, 8))
        .unwrap_or(4);
    let total: f64 = ranges.iter().map(|r| r.end - r.start).sum();
    let mut done = 0.0;
    let mut words = Vec::new();

    for (i, range) in ranges.iter().enumerate() {
        let length = range.end - range.start;
        let before = done;
        let emit = |stage: &'static str, part: f64| {
            let _ = app.emit(
                "captions-progress",
                CaptionsProgress {
                    stage,
                    percent: ((before + length * part) / total * 100.0).clamp(0.0, 100.0),
                },
            );
        };
        emit("audio", 0.0);
        let wav = work.join(format!("part{i}.wav"));
        let mut extract = Command::new(ffmpeg_dir.join("ffmpeg.exe"));
        extract
            .args(["-y", "-v", "error", "-ss"])
            .arg(format!("{:.3}", range.start.max(0.0)))
            .arg("-t")
            .arg(format!("{length:.3}"))
            .arg("-i")
            .arg(&path)
            .args(["-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le"])
            .arg(&wav)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        jobs::hide_console(&mut extract);
        let out = extract
            .output()
            .await
            .map_err(|e| AppError::new("Ses çıkarılamadı.", Some(e.to_string())))?;
        if !out.status.success() {
            return Err(AppError::coded(
                "captionsNoAudio",
                "Bu bölümün sesi okunamadı (videoda ses olmayabilir).",
                Some(String::from_utf8_lossy(&out.stderr).into_owned()),
            ));
        }

        let base = work.join(format!("part{i}"));
        let mut command = Command::new(&exe);
        command
            .current_dir(exe.parent().unwrap_or(&work))
            .arg("-m")
            .arg(&model_path)
            .arg("-f")
            .arg(&wav)
            .args(["-l", &lang, "-t", &threads.to_string()])
            // Kelime kelime zaman: her parça tek kelime, kelime ortasından bölünmez.
            .args(["-ml", "1", "-sow", "-oj", "-pp", "-np"])
            .arg("-of")
            .arg(&base)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        jobs::hide_console(&mut command);
        let mut child = command
            .spawn()
            .map_err(|e| AppError::new("Altyazı motoru başlatılamadı.", Some(e.to_string())))?;
        if let Some(pid) = child.id() {
            crate::process_guard::attach(pid);
            *running().lock().unwrap() = Some(pid);
        }
        let mut tail = String::new();
        if let Some(stderr) = child.stderr.take() {
            let mut reader = BufReader::new(stderr);
            let mut buf = Vec::new();
            while let Some(line) = jobs::read_line_lossy(&mut reader, &mut buf).await {
                if let Some(p) = progress_of(&line) {
                    emit("transcribe", p / 100.0);
                } else {
                    tail.push_str(&line);
                    tail.push('\n');
                    if tail.len() > 4000 {
                        tail.drain(..tail.len() - 4000);
                    }
                }
            }
        }
        let status = child
            .wait()
            .await
            .map_err(|e| AppError::new("Altyazı motoru çalışmadı.", Some(e.to_string())))?;
        let canceled = running().lock().unwrap().take().is_none();
        let _ = tokio::fs::remove_file(&wav).await;
        if canceled {
            return Err(AppError::coded(
                "captionsCanceled",
                "Altyazı iptal edildi.",
                None,
            ));
        }
        if !status.success() {
            return Err(AppError::coded(
                "captionsFailed",
                "Konuşma yazıya dökülemedi.",
                Some(tail),
            ));
        }
        let json_path = base.with_extension("json");
        let json = tokio::fs::read_to_string(&json_path)
            .await
            .map_err(|e| AppError::new("Altyazı sonucu okunamadı.", Some(e.to_string())))?;
        let _ = tokio::fs::remove_file(&json_path).await;
        words.extend(
            parse_words(&json, range.start)
                .map_err(|e| AppError::new("Altyazı sonucu okunamadı.", Some(e)))?,
        );
        done += length;
        emit("transcribe", 0.0);
    }
    Ok(words)
}

/// Süren altyazı işini durdurur.
#[tauri::command]
pub async fn captions_cancel() {
    let pid = running().lock().unwrap().take();
    if let Some(pid) = pid {
        let mut command = Command::new("taskkill");
        command.args(["/F", "/T", "/PID", &pid.to_string()]);
        jobs::hide_console(&mut command);
        let _ = command.output().await;
    }
}

/// Motor ve modelin indirilip indirilmediği (ilk kullanımda boyut uyarısı için).
#[tauri::command]
pub fn captions_ready(app: AppHandle, model: String) -> Result<bool, AppError> {
    let dir = whisper_dir(&app)?;
    Ok(dir.join("whisper-cli.exe").exists() && dir.join(model_file(&model)).exists())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kelimeler_ve_zamanlari_okunur() {
        let json = r#"{"transcription":[
            {"timestamps":{"from":"00:00:00,000","to":"00:00:00,400"},"offsets":{"from":0,"to":400},"text":" Merhaba"},
            {"timestamps":{},"offsets":{"from":400,"to":400},"text":" arkadaşlar"},
            {"timestamps":{},"offsets":{"from":900,"to":1200},"text":" "},
            {"timestamps":{},"offsets":{"from":1300,"to":2000},"text":" [Müzik]"}
        ]}"#;
        let words = parse_words(json, 10.0).unwrap();
        assert_eq!(words.len(), 2);
        assert_eq!(
            words[0],
            Word {
                text: "Merhaba".into(),
                start: 10.0,
                end: 10.4
            }
        );
        // Süresi sıfır gelen kelime en az 50 ms sürer.
        assert!((words[1].end - 10.45).abs() < 1e-9);
    }

    // Elle: DOWNKIT_WHISPER_ZIP=<zip yolu> cargo test --lib gercek_paket -- --ignored
    #[test]
    #[ignore]
    fn gercek_paket_acilir() {
        let zip = std::env::var("DOWNKIT_WHISPER_ZIP").unwrap();
        let dest = std::env::temp_dir().join("downkit-whisper-deneme");
        std::fs::create_dir_all(&dest).unwrap();
        extract_whisper(&std::fs::read(zip).unwrap(), &dest).unwrap();
        assert!(dest.join("whisper-cli.exe").exists());
        assert!(dest.join("whisper.dll").exists());
        assert!(!dest.join("bench.exe").exists());
    }

    #[test]
    fn ilerleme_satiri_okunur() {
        assert_eq!(
            progress_of("whisper_print_progress_callback: progress =  45%"),
            Some(45.0)
        );
        assert_eq!(progress_of("main: processing"), None);
    }
}
