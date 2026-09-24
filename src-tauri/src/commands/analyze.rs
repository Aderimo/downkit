use crate::error::AppError;
use crate::platform;
use crate::ytdlp;
use crate::ytdlp::metadata::AnalyzeResult;

async fn run(
    app: &tauri::AppHandle,
    url: &str,
    force_playlist: bool,
) -> Result<AnalyzeResult, AppError> {
    let platform = platform::detect_platform(url).ok_or_else(|| {
        AppError::coded(
            "unsupportedPlatform",
            "Bu bağlantı desteklenen bir platforma ait görünmüyor.",
            None,
        )
    })?;

    let ytdlp_path = ytdlp::binary::ensure_ytdlp(app).await?;
    let js_args = ytdlp::jsruntime::ytdlp_args(app, platform).await;
    ytdlp::metadata::analyze(&ytdlp_path, url, platform, &js_args, force_playlist).await
}

/// Tek video ya da (link yalnızca bir listeye işaret ediyorsa) oynatma listesi döner.
#[tauri::command]
pub async fn analyze_url(app: tauri::AppHandle, url: String) -> Result<AnalyzeResult, AppError> {
    run(&app, &url, false).await
}

/// "watch?v=…&list=…" gibi linklerde kullanıcı "Listenin tamamını aç" derse.
#[tauri::command]
pub async fn analyze_playlist(
    app: tauri::AppHandle,
    url: String,
) -> Result<AnalyzeResult, AppError> {
    run(&app, &url, true).await
}
