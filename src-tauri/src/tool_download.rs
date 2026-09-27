//! yt-dlp, FFmpeg ve Deno'nun ilk indirmesi: parça parça indirilir ve ilerleme
//! `tool-download` olayıyla arayüze bildirilir (ilk açılışta ~245 MB; ilerleme
//! görünmezse program donmuş sanılıyordu).

use std::sync::OnceLock;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

static APP: OnceLock<AppHandle> = OnceLock::new();
const EMIT_INTERVAL: Duration = Duration::from_millis(250);

/// Uygulama açılırken bir kez çağrılır; testlerde çağrılmaz (olay yayınlanmaz).
pub fn init(app: &AppHandle) {
    let _ = APP.set(app.clone());
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolProgress {
    /// "yt-dlp" | "ffmpeg" | "deno"
    tool: &'static str,
    downloaded: u64,
    total: Option<u64>,
    /// "downloading" | "done" | "failed"
    state: &'static str,
}

fn emit(progress: ToolProgress) {
    if let Some(app) = APP.get() {
        let _ = app.emit("tool-download", progress);
    }
}

/// `url`'yi indirir; indirdikçe ilerleme yayınlar. Hata metni ayrıntı içindir.
pub async fn fetch(tool: &'static str, url: &str) -> Result<Vec<u8>, String> {
    let result = fetch_inner(tool, url).await;
    if result.is_err() {
        emit(ToolProgress {
            tool,
            downloaded: 0,
            total: None,
            state: "failed",
        });
    }
    result
}

async fn fetch_inner(tool: &'static str, url: &str) -> Result<Vec<u8>, String> {
    let response = reqwest::get(url).await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {} — {url}", response.status()));
    }
    let total = response.content_length();
    let mut bytes = Vec::with_capacity(total.unwrap_or(0).min(512 * 1024 * 1024) as usize);
    let mut stream = response.bytes_stream();
    let mut last = Instant::now() - EMIT_INTERVAL;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        bytes.extend_from_slice(&chunk);
        if last.elapsed() >= EMIT_INTERVAL {
            last = Instant::now();
            emit(ToolProgress {
                tool,
                downloaded: bytes.len() as u64,
                total,
                state: "downloading",
            });
        }
    }
    emit(ToolProgress {
        tool,
        downloaded: bytes.len() as u64,
        total,
        state: "done",
    });
    Ok(bytes)
}
