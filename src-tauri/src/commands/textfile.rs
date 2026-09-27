//! Düzenleyicinin küçük metin dosyaları: altyazı (.srt) içe aktarma ve hazır
//! ayarları (.json) paylaşma. Yol kullanıcının dosya penceresinde seçtiği dosyadır;
//! yine de yalnızca bu uzantılara ve küçük dosyalara izin verilir.

use std::path::Path;

use crate::error::AppError;

const ALLOWED: [&str; 2] = ["srt", "json"];
const MAX_BYTES: u64 = 2 * 1024 * 1024;

fn check(path: &Path) -> Result<(), AppError> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if ALLOWED.contains(&ext.as_str()) {
        Ok(())
    } else {
        Err(AppError::new(
            "Yalnızca .srt ve .json dosyaları açılabilir.",
            None,
        ))
    }
}

#[tauri::command]
pub async fn text_file_read(path: String) -> Result<String, AppError> {
    let path = Path::new(&path);
    check(path)?;
    let meta = tokio::fs::metadata(path)
        .await
        .map_err(|e| AppError::new("Dosya bulunamadı.", Some(e.to_string())))?;
    if meta.len() > MAX_BYTES {
        return Err(AppError::new("Dosya çok büyük (en fazla 2 MB).", None));
    }
    let bytes = tokio::fs::read(path)
        .await
        .map_err(|e| AppError::new("Dosya okunamadı.", Some(e.to_string())))?;
    // Eski altyazılar Windows-1254 olabilir; UTF-8 değilse bozuk harfler yerine
    // yedek karakter gelir, dosya yine açılır. Baştaki BOM atılır.
    let text = String::from_utf8_lossy(&bytes);
    Ok(text.trim_start_matches('\u{feff}').to_string())
}

#[tauri::command]
pub async fn text_file_write(path: String, contents: String) -> Result<(), AppError> {
    let path = Path::new(&path);
    check(path)?;
    if contents.len() as u64 > MAX_BYTES {
        return Err(AppError::new("Dosya çok büyük (en fazla 2 MB).", None));
    }
    tokio::fs::write(path, contents)
        .await
        .map_err(|e| AppError::new("Dosya kaydedilemedi.", Some(e.to_string())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn yalnizca_altyazi_ve_hazir_ayar_dosyalari() {
        assert!(check(Path::new("a.srt")).is_ok());
        assert!(check(Path::new("b.JSON")).is_ok());
        assert!(check(Path::new("c.exe")).is_err());
        assert!(check(Path::new("d")).is_err());
    }
}
