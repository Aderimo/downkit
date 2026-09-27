//! Arayüz ayarlarının kalıcı kopyası: `%APPDATA%\com.downkit.app\prefs.json`.
//!
//! Ayarlar arayüzde localStorage'da tutulur, ama WebView2'nin localStorage
//! veritabanı bazı makinelerde oturumda yazılanları bir sonraki açılışta
//! kaybedebiliyor (yazılar veritabanının artık okumadığı bir günlük dosyasına
//! gidiyor). Bu yüzden `downkit.*` anahtarları ayrıca bu dosyaya yazılır ve
//! açılışta localStorage bu dosyadan doldurulur.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::Manager;

use crate::error::AppError;

/// Aynı anda iki yazma geçici dosyayı ezmesin.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

fn prefs_path(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::new("Ayar klasörü bulunamadı.", Some(e.to_string())))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| AppError::new("Ayar klasörü oluşturulamadı.", Some(e.to_string())))?;
    Ok(dir.join("prefs.json"))
}

/// Dosya yoksa ya da bozuksa boş döner (arayüz o zaman localStorage'dakini yazar).
fn parse(text: &str) -> BTreeMap<String, String> {
    serde_json::from_str(text).unwrap_or_default()
}

fn only_ours(data: BTreeMap<String, String>) -> BTreeMap<String, String> {
    data.into_iter()
        .filter(|(key, _)| key.starts_with("downkit."))
        .collect()
}

#[tauri::command]
pub fn prefs_load(app: tauri::AppHandle) -> Result<BTreeMap<String, String>, AppError> {
    let path = prefs_path(&app)?;
    Ok(std::fs::read_to_string(path)
        .map(|text| only_ours(parse(&text)))
        .unwrap_or_default())
}

/// Tek bir ayar anahtarının değeri; tepsi menüsünün dili gibi arayüzden
/// bağımsız yerlerde lazım olur. Dosya yoksa ya da bozuksa `None`.
pub(crate) fn read_value(app: &tauri::AppHandle, key: &str) -> Option<String> {
    let path = prefs_path(app).ok()?;
    let text = std::fs::read_to_string(path).ok()?;
    parse(&text).get(key).cloned()
}

/// Önce geçici dosyaya yazılır, sonra asıl dosyanın yerine taşınır: yazma
/// yarıda kesilse bile eski ayarlar bozulmaz.
#[tauri::command]
pub fn prefs_save(app: tauri::AppHandle, data: BTreeMap<String, String>) -> Result<(), AppError> {
    let path = prefs_path(&app)?;
    let text = serde_json::to_string(&only_ours(data))
        .map_err(|e| AppError::new("Ayarlar kaydedilemedi.", Some(e.to_string())))?;
    let _guard = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text)
        .and_then(|()| std::fs::rename(&tmp, &path))
        .map_err(|e| AppError::new("Ayarlar kaydedilemedi.", Some(e.to_string())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bozuk_dosya_bos_ayar_sayilir() {
        assert!(parse("{bozuk").is_empty());
        assert!(parse("[1,2]").is_empty());
    }

    #[test]
    fn yalnizca_downkit_anahtarlari_saklanir() {
        let mut data = BTreeMap::new();
        data.insert("downkit.settings".to_string(), "{}".to_string());
        data.insert("baska".to_string(), "x".to_string());
        let kept = only_ours(data);
        assert_eq!(kept.len(), 1);
        assert!(kept.contains_key("downkit.settings"));
    }
}
