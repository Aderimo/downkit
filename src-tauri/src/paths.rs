use std::path::{Path, PathBuf};
use tauri::Manager;

use crate::error::AppError;

/// İlk çalıştırmada indirilen araçların (FFmpeg) saklandığı klasör.
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

/// Videolar/Resimler altındaki program klasörü. Yeni kurulumda `DownKit`;
/// ClipKit'ten gelen kullanıcıda yalnızca `ClipKit` klasörü varsa o kullanılır,
/// böylece önceki kayıtlar kitaplıkta görünmeye devam eder.
pub fn media_dir(base: &Path) -> PathBuf {
    let new = base.join("DownKit");
    let old = base.join("ClipKit");
    if !new.exists() && old.is_dir() {
        old
    } else {
        new
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eski_klasor_yalnizca_tek_basinaysa_kullanilir() {
        let root = std::env::temp_dir().join(format!("downkit-paths-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        assert_eq!(media_dir(&root), root.join("DownKit"));
        std::fs::create_dir_all(root.join("ClipKit")).unwrap();
        assert_eq!(media_dir(&root), root.join("ClipKit"));
        std::fs::create_dir_all(root.join("DownKit")).unwrap();
        assert_eq!(media_dir(&root), root.join("DownKit"));
        let _ = std::fs::remove_dir_all(root);
    }
}
