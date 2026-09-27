use std::path::PathBuf;
use tauri::Manager;

use crate::error::AppError;

/// yt-dlp/ffmpeg gibi ilk çalıştırmada indirilen araçların saklandığı klasör.
pub fn bin_dir(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::new("Uygulama veri klasörü bulunamadı.", Some(e.to_string())))?;
    let dir = base.join("bin");
    std::fs::create_dir_all(&dir)
        .map_err(|e| AppError::new("Uygulama veri klasörü oluşturulamadı.", Some(e.to_string())))?;
    Ok(dir)
}

/// Geçici işler için önbellek alt klasörü (ör. önizleme kopyaları, bölüm parçaları).
pub fn cache_dir(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, AppError> {
    let base = app
        .path()
        .app_cache_dir()
        .map_err(|e| AppError::new("Önbellek klasörü bulunamadı.", Some(e.to_string())))?;
    let dir = base.join(name);
    std::fs::create_dir_all(&dir)
        .map_err(|e| AppError::new("Önbellek klasörü oluşturulamadı.", Some(e.to_string())))?;
    Ok(dir)
}
