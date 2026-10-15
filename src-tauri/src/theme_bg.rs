//! Özel arka plan resmi (Ayarlar → Tema → Özel).
//!
//! Arayüz resmi kendisi işler (küçültme, bulanıklık, parlaklık…) ve JPEG olarak
//! buraya yollar; burada yalnızca uygulama klasörüne yazılır ve okunur. İki dosya
//! tutulur: `source` (küçültülmüş asıl resim, ayar değişince yeniden işlenir) ve
//! `image` (işlenmiş, ekranda görünen). Böylece filtreler canlı çalışıp GPU'yu
//! sürekli meşgul etmez.

use std::path::PathBuf;

use base64::Engine;
use tauri::{AppHandle, Manager};

use crate::error::AppError;

const PREFIX: &str = "data:image/jpeg;base64,";
/// 2560 px'lik bir JPEG bunun çok altında kalır; sınır bozuk veriye karşı.
const MAX_BYTES: usize = 12 * 1024 * 1024;

fn kind_file(kind: &str) -> Option<&'static str> {
    match kind {
        "source" => Some("background-source.jpg"),
        "image" => Some("background.jpg"),
        _ => None,
    }
}

fn dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::new("Uygulama veri klasörü bulunamadı.", Some(e.to_string())))?;
    Ok(base.join("theme"))
}

fn path(app: &AppHandle, kind: &str) -> Result<PathBuf, AppError> {
    let name = kind_file(kind).ok_or_else(|| AppError::new("Geçersiz resim türü.", None))?;
    Ok(dir(app)?.join(name))
}

/// `data:image/jpeg;base64,…` biçimindeki veriyi çözer.
fn decode(data_url: &str) -> Result<Vec<u8>, AppError> {
    let body = data_url
        .strip_prefix(PREFIX)
        .ok_or_else(|| AppError::new("Resim JPEG olarak gelmedi.", None))?;
    if body.len() > MAX_BYTES / 3 * 4 + 4 {
        return Err(AppError::new("Resim çok büyük.", None));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(body)
        .map_err(|e| AppError::new("Resim okunamadı.", Some(e.to_string())))?;
    // JPEG başlığı (FF D8 FF) değilse yazılmaz.
    if bytes.len() < 3 || bytes[..3] != [0xFF, 0xD8, 0xFF] {
        return Err(AppError::new("Resim JPEG değil.", None));
    }
    Ok(bytes)
}

#[tauri::command]
pub async fn theme_bg_save(app: AppHandle, kind: String, data_url: String) -> Result<(), AppError> {
    let file = path(&app, &kind)?;
    let bytes = decode(&data_url)?;
    if let Some(parent) = file.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| AppError::new("Klasör oluşturulamadı.", Some(e.to_string())))?;
    }
    // Yarım dosya kalmasın: önce geçici ada yazılır.
    let tmp = file.with_extension("jpg.part");
    tokio::fs::write(&tmp, bytes)
        .await
        .map_err(|e| AppError::new("Resim kaydedilemedi.", Some(e.to_string())))?;
    tokio::fs::rename(&tmp, &file)
        .await
        .map_err(|e| AppError::new("Resim kaydedilemedi.", Some(e.to_string())))
}

/// Kayıtlı resim yoksa None.
#[tauri::command]
pub async fn theme_bg_load(app: AppHandle, kind: String) -> Result<Option<String>, AppError> {
    let file = path(&app, &kind)?;
    match tokio::fs::read(&file).await {
        Ok(bytes) if bytes.len() <= MAX_BYTES => Ok(Some(format!(
            "{PREFIX}{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ))),
        _ => Ok(None),
    }
}

#[tauri::command]
pub async fn theme_bg_clear(app: AppHandle) -> Result<(), AppError> {
    for kind in ["source", "image"] {
        let _ = tokio::fs::remove_file(path(&app, kind)?).await;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn yalnizca_jpeg_kabul_edilir() {
        let jpeg = base64::engine::general_purpose::STANDARD.encode([0xFF, 0xD8, 0xFF, 0xE0, 1, 2]);
        assert_eq!(decode(&format!("{PREFIX}{jpeg}")).unwrap().len(), 6);
        let png = base64::engine::general_purpose::STANDARD.encode([0x89, b'P', b'N', b'G']);
        assert!(decode(&format!("{PREFIX}{png}")).is_err());
        assert!(decode("data:image/png;base64,AAAA").is_err());
    }

    #[test]
    fn bilinmeyen_tur_reddedilir() {
        assert!(kind_file("source").is_some());
        assert!(kind_file("../prefs").is_none());
    }
}
