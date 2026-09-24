use serde::Deserialize;
use tauri::AppHandle;

use crate::error::AppError;
use crate::ffmpeg;
use crate::jobs::{self, FfmpegJob};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrimRequest {
    pub input_path: String,
    pub destination_dir: String,
    pub start_seconds: f64,
    pub end_seconds: f64,
    /// Tam karede kes (yeniden kodla); false ise kopyalayarak hızlı kes.
    pub precise: bool,
}

/// Video Düzenleyici: bilgisayardaki bir dosyadan seçilen aralığı yeni bir
/// dosyaya çıkarır. Kaynak dosyaya dokunulmaz.
#[tauri::command]
pub async fn start_trim(app: AppHandle, request: TrimRequest) -> Result<String, AppError> {
    let ffmpeg_dir = ffmpeg::binary::ensure_ffmpeg(&app).await?;
    let info = ffmpeg::convert::probe_file(&ffmpeg_dir, &request.input_path).await?;

    let start = request.start_seconds.max(0.0);
    let end = info
        .duration_seconds
        .map_or(request.end_seconds, |d| request.end_seconds.min(d));
    if end - start < 0.1 {
        return Err(AppError::coded(
            "invalidRange",
            "Bitiş zamanı başlangıçtan sonra olmalı.",
            None,
        ));
    }

    // Yalnızca ses dosyalarında kopyalama zaten neredeyse tam kesiyor; hassas
    // kesim görüntü içindir.
    let precise = request.precise && info.video_codec.is_some();
    let extension = if precise || info.container.is_empty() {
        "mp4".to_string()
    } else {
        info.container.clone()
    };

    let stem = std::path::Path::new(&request.input_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let output_path = jobs::unique_output_path(
        std::path::Path::new(&request.destination_dir),
        &format!("{stem} ({})", ffmpeg::trim::range_label(start, end)),
        &extension,
    );
    let output = output_path.to_string_lossy().into_owned();

    jobs::spawn_ffmpeg(
        &app,
        &ffmpeg_dir.join("ffmpeg.exe"),
        ffmpeg::trim::build_args(&request.input_path, &output, start, end, precise),
        FfmpegJob {
            event_prefix: "trim",
            error_code: "trimFailed",
            error_message: "Kesme tamamlanamadı. Tekrar deneyin.",
            duration_seconds: Some(end - start),
            output_path: output,
            input_size_bytes: None,
        },
    )
    .await
}

#[tauri::command]
pub async fn cancel_trim(app: AppHandle, job_id: String) -> Result<(), AppError> {
    jobs::cancel(&app, &job_id, true).await;
    Ok(())
}
