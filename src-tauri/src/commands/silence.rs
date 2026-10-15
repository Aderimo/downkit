//! Düzenleyici: kaynaktaki sessiz bölümleri bulur ("Sessizlikleri sil").

use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

use crate::error::AppError;
use crate::ffmpeg::silence;
use crate::{ffmpeg, jobs};

const TIMEOUT: Duration = Duration::from_secs(15 * 60);
const ERROR_MESSAGE: &str = "Sessizlikler bulunamadı.";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SilenceResult {
    /// Kaynak saniyesi: [başlangıç, bitiş].
    pub silences: Vec<(f64, f64)>,
    /// Ayrı mikrofon izine bakıldı (oyun sesi hesaba katılmadı).
    pub voice_track: bool,
}

#[derive(Debug, Default, Deserialize)]
struct Probe {
    #[serde(default)]
    streams: Vec<ProbeStream>,
    format: Option<ProbeFormat>,
}

#[derive(Debug, Default, Deserialize)]
struct ProbeStream {
    #[serde(default)]
    tags: ProbeTags,
}

#[derive(Debug, Default, Deserialize)]
struct ProbeTags {
    title: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct ProbeFormat {
    duration: Option<String>,
}

/// Ses izlerinin adları ve dosyanın süresi.
async fn probe_audio(
    dir: &std::path::Path,
    input: &str,
) -> Result<(Vec<Option<String>>, Option<f64>), AppError> {
    let mut command = Command::new(dir.join("ffprobe.exe"));
    command
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_streams",
            "-show_format",
            "-select_streams",
            "a",
            input,
        ])
        .kill_on_drop(true);
    jobs::hide_console(&mut command);
    let output = command
        .output()
        .await
        .map_err(|e| AppError::new(ERROR_MESSAGE, Some(e.to_string())))?;
    let probe: Probe = serde_json::from_slice(&output.stdout).unwrap_or_default();
    let duration = probe
        .format
        .and_then(|f| f.duration)
        .and_then(|d| d.parse::<f64>().ok());
    Ok((
        probe.streams.into_iter().map(|s| s.tags.title).collect(),
        duration,
    ))
}

#[tauri::command]
pub async fn editor_silences(
    app: AppHandle,
    path: String,
    noise_db: f64,
    min_seconds: f64,
    voice: bool,
) -> Result<SilenceResult, AppError> {
    if !std::path::Path::new(&path).is_file() {
        return Err(AppError::new("Dosya bulunamadı.", Some(path)));
    }
    let dir = ffmpeg::binary::ensure_ffmpeg(&app).await?;
    let (titles, duration) = probe_audio(&dir, &path).await?;
    if titles.is_empty() {
        return Err(AppError::new("Bu videoda ses yok.", None));
    }
    let voice_index = if voice {
        silence::voice_track(&titles)
    } else {
        None
    };

    let mut command = Command::new(dir.join("ffmpeg.exe"));
    command
        .args(silence::silence_args(
            &path,
            voice_index.unwrap_or(0),
            noise_db,
            min_seconds,
        ))
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    jobs::hide_console(&mut command);
    let mut child = command
        .spawn()
        .map_err(|e| AppError::new(ERROR_MESSAGE, Some(e.to_string())))?;
    if let Some(pid) = child.id() {
        crate::process_guard::attach(pid);
    }
    let mut stderr = child.stderr.take().expect("stderr piped");
    let mut log = String::new();
    let read = stderr.read_to_string(&mut log);
    if tokio::time::timeout(TIMEOUT, read).await.is_err() {
        let _ = child.kill().await;
        return Err(AppError::new("Ses incelemesi çok uzun sürdü.", None));
    }
    let status = child
        .wait()
        .await
        .map_err(|e| AppError::new(ERROR_MESSAGE, Some(e.to_string())))?;
    if !status.success() {
        let tail: String = log.lines().rev().take(4).collect::<Vec<_>>().join(" | ");
        return Err(AppError::new(ERROR_MESSAGE, Some(tail)));
    }
    Ok(SilenceResult {
        silences: silence::parse_silences(&log, duration),
        voice_track: voice_index.is_some(),
    })
}
