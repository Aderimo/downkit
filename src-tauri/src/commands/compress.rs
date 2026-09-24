use serde::Deserialize;
use tauri::AppHandle;

use crate::error::AppError;
use crate::ffmpeg;
use crate::jobs::{self, FfmpegJob};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressRequest {
    pub input_path: String,
    pub destination_dir: String,
    pub mode: String, // "targetSize" | "preset"
    pub target_size_mb: Option<f64>,
    pub preset: Option<String>,
}

#[tauri::command]
pub async fn start_compress(app: AppHandle, request: CompressRequest) -> Result<String, AppError> {
    let ffmpeg_dir = ffmpeg::binary::ensure_ffmpeg(&app).await?;
    let info = ffmpeg::convert::probe_file(&ffmpeg_dir, &request.input_path).await?;

    let codec_args = if request.mode == "targetSize" {
        let target_bytes = (request.target_size_mb.unwrap_or(0.0) * 1024.0 * 1024.0) as u64;
        ffmpeg::compress::build_args_for_target_size(target_bytes, &info)
    } else {
        ffmpeg::compress::build_args_for_preset(
            request.preset.as_deref().unwrap_or("balanced"),
            &info,
        )
    };

    let stem = std::path::Path::new(&request.input_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    // Kodek hep H.264 + AAC; kaynak WebM olsa bile bunları taşıyabilen kapsayıcı MP4.
    let output_path = jobs::unique_output_path(
        std::path::Path::new(&request.destination_dir),
        &format!("{stem} (sıkıştırılmış)"),
        "mp4",
    );

    let mut args: Vec<String> = vec!["-y".into(), "-i".into(), request.input_path.clone()];
    args.extend(codec_args);
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
            event_prefix: "compress",
            error_code: "compressFailed",
            error_message: "Sıkıştırma tamamlanamadı. Tekrar deneyin.",
            duration_seconds: info.duration_seconds,
            output_path: output_path.to_string_lossy().into_owned(),
            input_size_bytes: Some(info.file_size_bytes),
        },
    )
    .await
}

#[tauri::command]
pub async fn cancel_compress(app: AppHandle, job_id: String) -> Result<(), AppError> {
    jobs::cancel(&app, &job_id, true).await;
    Ok(())
}
