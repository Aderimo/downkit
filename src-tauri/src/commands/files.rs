use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::error::AppError;

// Önyüz yalnızca bizim ürettiğimiz medya dosyalarını açabilsin; geniş bir
// "her yolu aç" izni vermek, herhangi bir .exe'yi çalıştırmaya kapı açardı.
const OPENABLE_EXTENSIONS: [&str; 18] = [
    "mp4", "mkv", "webm", "mov", "avi", "mp3", "m4a", "wav", "aac", "flac", "opus", "ogg", "srt",
    "gif", "png", "jpg", "jpeg", "webp",
];

pub fn is_openable(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| OPENABLE_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

#[tauri::command]
pub async fn open_media_file(app: AppHandle, path: String) -> Result<(), AppError> {
    let path_ref = std::path::Path::new(&path);
    if !is_openable(path_ref) || !path_ref.is_file() {
        return Err(AppError::new("Bu dosya açılamıyor.", Some(path)));
    }
    app.opener()
        .open_path(&path, None::<&str>)
        .map_err(|e| AppError::new("Dosya açılamadı.", Some(e.to_string())))
}

/// Kayıt klasörünü Gezgin'de açar. Yalnızca klasör kabul edilir: bir klasörü
/// açmak hiçbir şey çalıştırmaz. Henüz hiç kayıt yapılmadıysa (varsayılan
/// klasör yoksa) önce oluşturulur.
#[tauri::command]
pub async fn open_folder(app: AppHandle, path: String) -> Result<(), AppError> {
    let dir = std::path::Path::new(&path);
    if !dir.is_dir() {
        let created = dir.is_absolute() && !dir.exists() && std::fs::create_dir_all(dir).is_ok();
        if !created {
            return Err(AppError::new("Klasör bulunamadı.", Some(path)));
        }
    }
    app.opener()
        .open_path(&path, None::<&str>)
        .map_err(|e| AppError::new("Klasör açılamadı.", Some(e.to_string())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn yalnizca_medya_uzantilari_acilabilir() {
        assert!(is_openable(std::path::Path::new("C:/a/video.MP4")));
        assert!(is_openable(std::path::Path::new("C:/a/şarkı.mp3")));
        assert!(is_openable(std::path::Path::new("C:/a/klip.gif")));
        assert!(!is_openable(std::path::Path::new("C:/a/kurulum.exe")));
        assert!(!is_openable(std::path::Path::new("C:/a/betik.bat")));
        assert!(!is_openable(std::path::Path::new("C:/a/uzantisiz")));
    }
}
