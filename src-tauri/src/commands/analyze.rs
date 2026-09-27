use crate::error::AppError;
use crate::types::{MediaMetadata, PreviewStream};
use crate::ytdlp;
use crate::ytdlp::metadata::AnalyzeResult;
use crate::{platform, preview};

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
    let mut result =
        ytdlp::metadata::analyze(&ytdlp_path, url, platform, &js_args, force_playlist).await?;
    if let AnalyzeResult::Video(metadata) = &mut result {
        attach_preview(metadata).await;
    }
    Ok(result)
}

/// Seçilen akışı yerel aktarıcıya kaydeder. Aktarıcı açılamazsa analiz yine
/// başarılıdır; yalnızca önizleme olmaz.
async fn attach_preview(metadata: &mut MediaMetadata) {
    let Some(pick) = metadata.preview_source.take() else {
        return;
    };
    let mut targets = vec![pick.url.as_str()];
    if let Some(audio) = &pick.audio_url {
        targets.push(audio);
    }
    let Ok((token, urls)) = preview::register_remote(
        pick.headers.clone(),
        pick.thumb_url.clone(),
        pick.wave_url.clone(),
        &targets,
    )
    .await
    else {
        return;
    };
    metadata.preview = Some(PreviewStream {
        kind: pick.kind,
        url: urls[0].clone(),
        audio_url: urls.get(1).cloned(),
        token,
        has_video: pick.has_video,
    });
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
