use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tokio::sync::Mutex;

use crate::error::AppError;
use crate::{paths, tool_download};

fn download_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

const FFMPEG_ZIP_URL: &str =
    "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip";

/// `bin_dir`'in içine ffmpeg.exe + ffprobe.exe konur; yoksa BtbN'in resmi
/// GitHub release'inden indirilip zip'ten çıkarılır. Klasörün kendisi döner
/// (yt-dlp'nin `--ffmpeg-location` argümanı bir klasör bekliyor).
pub async fn ensure_ffmpeg(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    let dir = paths::bin_dir(app)?;
    let ffmpeg_exe = dir.join("ffmpeg.exe");
    let ffprobe_exe = dir.join("ffprobe.exe");

    if ffmpeg_exe.exists() && ffprobe_exe.exists() {
        return Ok(dir);
    }
    // Birden çok iş aynı anda isterse FFmpeg yalnızca bir kez iner; diğerleri bekler.
    let _guard = download_lock().lock().await;
    if ffmpeg_exe.exists() && ffprobe_exe.exists() {
        return Ok(dir);
    }

    let bytes = tool_download::fetch("ffmpeg", FFMPEG_ZIP_URL)
        .await
        .map_err(|detail| {
            AppError::coded(
                "toolDownloadFailed",
                "FFmpeg indirilemedi. İnternet bağlantınızı kontrol edin.",
                Some(detail),
            )
        })?;

    let dest = dir.clone();
    tokio::task::spawn_blocking(move || extract_ffmpeg_binaries(&bytes, &dest))
        .await
        .map_err(|e| AppError::new("FFmpeg paketi açılamadı.", Some(e.to_string())))??;

    Ok(dir)
}

fn extract_ffmpeg_binaries(zip_bytes: &[u8], dest_dir: &Path) -> Result<(), AppError> {
    let cursor = std::io::Cursor::new(zip_bytes);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|e| AppError::new("FFmpeg paketi açılamadı.", Some(e.to_string())))?;

    let mut found = 0;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| AppError::new("FFmpeg paketi okunamadı.", Some(e.to_string())))?;
        let name = entry.name().to_lowercase().replace('\\', "/");

        let target_name = if name.ends_with("/bin/ffmpeg.exe") {
            Some("ffmpeg.exe")
        } else if name.ends_with("/bin/ffprobe.exe") {
            Some("ffprobe.exe")
        } else {
            None
        };

        if let Some(target_name) = target_name {
            // Önce geçici dosyaya: çıkarma yarıda kalırsa bozuk bir ffmpeg.exe
            // "var" sanılıp her işte hata vermesin.
            let tmp = dest_dir.join(format!("{target_name}.tmp"));
            let mut out = std::fs::File::create(&tmp)
                .map_err(|e| AppError::new("FFmpeg diske yazılamadı.", Some(e.to_string())))?;
            std::io::copy(&mut entry, &mut out)
                .map_err(|e| AppError::new("FFmpeg diske yazılamadı.", Some(e.to_string())))?;
            drop(out);
            std::fs::rename(&tmp, dest_dir.join(target_name))
                .map_err(|e| AppError::new("FFmpeg diske yazılamadı.", Some(e.to_string())))?;
            found += 1;
        }
    }

    if found < 2 {
        return Err(AppError::new(
            "FFmpeg paketinin içinden gerekli dosyalar bulunamadı.",
            None,
        ));
    }

    Ok(())
}
