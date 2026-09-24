use serde::Deserialize;
use tauri::AppHandle;

use crate::error::AppError;
use crate::ffmpeg;
use crate::jobs::{self, FfmpegJob};
use crate::types::LocalMediaInfo;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertRequest {
    pub input_path: String,
    pub destination_dir: String,
    pub target_container: String,
}

#[tauri::command]
pub async fn probe_local_file(app: AppHandle, path: String) -> Result<LocalMediaInfo, AppError> {
    let ffmpeg_dir = ffmpeg::binary::ensure_ffmpeg(&app).await?;
    ffmpeg::convert::probe_file(&ffmpeg_dir, &path).await
}

#[tauri::command]
pub async fn start_convert(app: AppHandle, request: ConvertRequest) -> Result<String, AppError> {
    let ffmpeg_dir = ffmpeg::binary::ensure_ffmpeg(&app).await?;
    let info = ffmpeg::convert::probe_file(&ffmpeg_dir, &request.input_path).await?;

    let stem = std::path::Path::new(&request.input_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    let output_path = jobs::unique_output_path(
        std::path::Path::new(&request.destination_dir),
        stem,
        &request.target_container,
    );

    let mut args: Vec<String> = vec!["-y".into(), "-i".into(), request.input_path.clone()];
    let target = request.target_container.as_str();
    args.extend(
        if ffmpeg::convert::can_copy_streams(
            target,
            info.video_codec.as_deref(),
            info.audio_codec.as_deref(),
        ) {
            ffmpeg::convert::build_copy_args(target)
        } else {
            ffmpeg::convert::build_codec_args(target)
        },
    );
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
            event_prefix: "convert",
            error_code: "convertFailed",
            error_message: "Dönüştürme tamamlanamadı. Tekrar deneyin.",
            duration_seconds: info.duration_seconds,
            output_path: output_path.to_string_lossy().into_owned(),
            input_size_bytes: None,
        },
    )
    .await
}

#[tauri::command]
pub async fn cancel_convert(app: AppHandle, job_id: String) -> Result<(), AppError> {
    jobs::cancel(&app, &job_id, true).await;
    Ok(())
}
