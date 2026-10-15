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

/// Dosyayı panoya "dosya" olarak koyar (Gezgin'deki Kopyala gibi): Discord'a,
/// WhatsApp'a ya da bir klasöre Ctrl+V ile yapıştırılır. Yalnızca medya dosyaları.
#[tauri::command]
pub fn copy_file_to_clipboard(path: String) -> Result<(), AppError> {
    let path_ref = std::path::Path::new(&path);
    if !is_openable(path_ref) || !path_ref.is_file() {
        return Err(AppError::new("Bu dosya kopyalanamıyor.", Some(path)));
    }
    clipboard_files(&[path.as_str()])
        .map_err(|e| AppError::new("Dosya panoya kopyalanamadı.", Some(e.to_string())))
}

/// CF_HDROP biçiminde dosya listesi: DROPFILES başlığı + çift sıfırla biten geniş yollar.
fn clipboard_files(paths: &[&str]) -> windows::core::Result<()> {
    use windows::Win32::Foundation::{HANDLE, HWND};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GHND};
    use windows::Win32::System::Ole::CF_HDROP;
    use windows::Win32::UI::Shell::DROPFILES;

    let mut wide: Vec<u16> = Vec::new();
    for p in paths {
        wide.extend(p.encode_utf16());
        wide.push(0);
    }
    wide.push(0);
    let header = std::mem::size_of::<DROPFILES>();
    let bytes = header + wide.len() * 2;
    unsafe {
        let memory = GlobalAlloc(GHND, bytes)?;
        let ptr = GlobalLock(memory) as *mut u8;
        if ptr.is_null() {
            return Err(windows::core::Error::from_thread());
        }
        let drop = ptr as *mut DROPFILES;
        (*drop).pFiles = header as u32;
        (*drop).fWide = true.into();
        std::ptr::copy_nonoverlapping(wide.as_ptr() as *const u8, ptr.add(header), wide.len() * 2);
        let _ = GlobalUnlock(memory);
        OpenClipboard(Some(HWND::default()))?;
        // Pano belleği artık sistemin: başarılı SetClipboardData'dan sonra serbest bırakılmaz.
        let result = EmptyClipboard()
            .and_then(|_| SetClipboardData(CF_HDROP.0 as u32, Some(HANDLE(memory.0))).map(|_| ()));
        let _ = CloseClipboard();
        result
    }
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

/// Düzenleyicide üste bindirilen resmin önizlemesi: dosyayı veri adresi olarak
/// döner (yalnızca PNG/JPEG/WebP, en çok 12 MB).
#[tauri::command]
pub async fn image_preview(path: String) -> Result<String, AppError> {
    use base64::Engine;
    let file = std::path::Path::new(&path);
    let mime = match file
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        _ => return Err(AppError::new("Bu resim biçimi desteklenmiyor.", Some(path))),
    };
    let bytes = tokio::fs::read(file)
        .await
        .map_err(|e| AppError::new("Resim okunamadı.", Some(e.to_string())))?;
    if bytes.len() > 12 * 1024 * 1024 {
        return Err(AppError::new("Resim çok büyük (en fazla 12 MB).", None));
    }
    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

#[cfg(test)]
mod tests_pano {
    // Elle çalıştırılır (panoyu değiştirir): cargo test --lib panoya -- --ignored
    #[test]
    #[ignore]
    fn panoya_dosya_kopyalanir() {
        let file = std::env::temp_dir().join("downkit-pano-deneme.mp4");
        std::fs::write(&file, b"x").unwrap();
        super::clipboard_files(&[file.to_str().unwrap()]).unwrap();
    }
}
