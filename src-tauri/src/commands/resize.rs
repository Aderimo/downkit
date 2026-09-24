use serde::Deserialize;
use tauri::AppHandle;

use crate::error::AppError;
use crate::ffmpeg;
use crate::jobs::{self, FfmpegJob};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResizeRequest {
    pub input_path: String,
    pub destination_dir: String,
    pub target_width: u32,
    pub target_height: u32,
    pub fit_mode: String, // "crop" | "pad"
}

#[tauri::command]
pub async fn start_resize(app: AppHandle, request: ResizeRequest) -> Result<String, AppError> {
    let ffmpeg_dir = ffmpeg::binary::ensure_ffmpeg(&app).await?;
    let info = ffmpeg::convert::probe_file(&ffmpeg_dir, &request.input_path).await?;

    // Genişlik/yükseklik libx264 için çift sayı olmalı.
    let target_width = request.target_width + (request.target_width % 2);
    let target_height = request.target_height + (request.target_height % 2);

    let stem = std::path::Path::new(&request.input_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let output_path = jobs::unique_output_path(
        std::path::Path::new(&request.destination_dir),
        &format!("{stem} ({target_width}x{target_height})"),
        "mp4",
    );

    let mut args: Vec<String> = vec!["-y".into(), "-i".into(), request.input_path.clone()];
    args.extend(ffmpeg::resize::build_args(
        target_width,
        target_height,
        &request.fit_mode,
    ));
    args.extend([
        "-progress".into(),
        "pipe:1".into(),
        "-nostats".into(),
        output_path.to_string_lossy().into_owned(),
    ]);

    jobs::spawn_ffmpeg(
        &app,
        &ffmpeg_dir.join("ffmpeg.exe"),
        args,
        FfmpegJob {
            event_prefix: "resize",
            error_code: "resizeFailed",
            error_message: "Boyutlandırma tamamlanamadı. Tekrar deneyin.",
            duration_seconds: info.duration_seconds,
            output_path: output_path.to_string_lossy().into_owned(),
            input_size_bytes: None,
        },
    )
    .await
}

#[tauri::command]
pub async fn cancel_resize(app: AppHandle, job_id: String) -> Result<(), AppError> {
    jobs::cancel(&app, &job_id, true).await;
    Ok(())
}
