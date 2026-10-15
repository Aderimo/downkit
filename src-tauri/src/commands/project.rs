//! Proje dosyaları (.downkit) ve otomatik kayıt.
//!
//! Kayıt hep atomiktir: içerik önce yanındaki geçici dosyaya yazılır, diske
//! işlenir, geri okunup doğrulanır, sonra asıl dosyanın yerine geçer. Yazma
//! ortasında program kapanırsa asıl dosya bozulmaz (en kötü ihtimalle eski
//! hâliyle kalır). Kaydetmeden önce eski sürüm yedek klasörüne kopyalanır;
//! proje başına son birkaç yedek tutulur.
//!
//! Otomatik kayıt (kurtarma dosyası) uygulama veri klasöründe tek dosyadır.
//! Düzenleyici temiz kapanınca silinir; açılışta duruyorsa son çalışma
//! kurtarılabilir.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::Manager;

use crate::error::AppError;

pub const EXT: &str = "downkit";
/// ClipKit döneminin proje uzantısı: açılmaya devam eder (kaydedince .downkit olur).
const OLD_EXT: &str = "clipkit";
const MAX_BYTES: u64 = 20 * 1024 * 1024;
const BACKUPS_KEPT: usize = 5;
const AUTOSAVE_NAME: &str = "current.downkit";

fn check_ext(path: &Path) -> Result<(), AppError> {
    let ok = path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case(EXT) || e.eq_ignore_ascii_case(OLD_EXT));
    if ok {
        Ok(())
    } else {
        Err(AppError::new(
            "Yalnızca .downkit proje dosyaları açılabilir.",
            None,
        ))
    }
}

/// İçerik bir DownKit projesi mi: JSON nesnesi ve sayı olan `schemaVersion`.
fn validate(contents: &str) -> Result<(), AppError> {
    if contents.len() as u64 > MAX_BYTES {
        return Err(AppError::new("Proje dosyası çok büyük.", None));
    }
    let value: serde_json::Value = serde_json::from_str(contents)
        .map_err(|e| AppError::new("Proje dosyası bozuk.", Some(e.to_string())))?;
    if value
        .get("schemaVersion")
        .and_then(|v| v.as_u64())
        .is_none()
    {
        return Err(AppError::new("Bu bir DownKit proje dosyası değil.", None));
    }
    Ok(())
}

fn tmp_path(path: &Path) -> PathBuf {
    let mut name = path
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    name.push(".tmp");
    path.with_file_name(name)
}

/// Geçici dosyaya yaz → diske işle → geri oku ve karşılaştır → yerine koy.
pub fn write_atomic(path: &Path, contents: &str) -> std::io::Result<()> {
    use std::io::Write;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = tmp_path(path);
    {
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(contents.as_bytes())?;
        file.sync_all()?;
    }
    let back = std::fs::read(&tmp)?;
    if back != contents.as_bytes() {
        let _ = std::fs::remove_file(&tmp);
        return Err(std::io::Error::other("geri okunan içerik farklı"));
    }
    // Windows'ta rename var olan dosyanın yerine geçer (MOVEFILE_REPLACE_EXISTING).
    std::fs::rename(&tmp, path)
}

/// Yol başına sabit, kısa klasör adı (FNV-1a): aynı projenin yedekleri bir arada.
fn path_key(path: &Path) -> String {
    let text = path.to_string_lossy().to_lowercase();
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in text.bytes() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// Var olan proje dosyasını yedek klasörüne kopyalar; en yeni `keep` yedek kalır.
pub fn backup_existing(path: &Path, backups: &Path, keep: usize) -> std::io::Result<()> {
    if !path.is_file() {
        return Ok(());
    }
    let dir = backups.join(path_key(path));
    std::fs::create_dir_all(&dir)?;
    std::fs::copy(path, dir.join(format!("{}.{EXT}", now_millis())))?;
    let mut entries: Vec<PathBuf> = std::fs::read_dir(&dir)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|e| e == EXT))
        .collect();
    // Dosya adları zaman damgası: ada göre sıralama = zamana göre sıralama.
    entries.sort();
    let excess = entries.len().saturating_sub(keep);
    for old in entries.into_iter().take(excess) {
        let _ = std::fs::remove_file(old);
    }
    Ok(())
}

fn data_dir(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, AppError> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::new("Uygulama veri klasörü bulunamadı.", Some(e.to_string())))?;
    let dir = base.join(name);
    std::fs::create_dir_all(&dir)
        .map_err(|e| AppError::new("Uygulama veri klasörü oluşturulamadı.", Some(e.to_string())))?;
    Ok(dir)
}

fn read_checked(path: &Path) -> Result<String, AppError> {
    let meta = std::fs::metadata(path)
        .map_err(|e| AppError::new("Proje dosyası bulunamadı.", Some(e.to_string())))?;
    if meta.len() > MAX_BYTES {
        return Err(AppError::new("Proje dosyası çok büyük.", None));
    }
    let bytes = std::fs::read(path)
        .map_err(|e| AppError::new("Proje dosyası okunamadı.", Some(e.to_string())))?;
    let text = String::from_utf8(bytes)
        .map_err(|e| AppError::new("Proje dosyası bozuk.", Some(e.to_string())))?;
    let text = text.trim_start_matches('\u{feff}').to_string();
    validate(&text)?;
    Ok(text)
}

#[tauri::command]
pub async fn project_save(
    app: tauri::AppHandle,
    path: String,
    contents: String,
) -> Result<(), AppError> {
    let path = PathBuf::from(path);
    check_ext(&path)?;
    validate(&contents)?;
    let backups = data_dir(&app, "project-backups")?;
    tokio::task::spawn_blocking(move || {
        // Yedek alınamaması kaydı engellemez; asıl dosya atomik yazılır.
        let _ = backup_existing(&path, &backups, BACKUPS_KEPT);
        write_atomic(&path, &contents)
    })
    .await
    .map_err(|e| AppError::new("Proje kaydedilemedi.", Some(e.to_string())))?
    .map_err(|e| AppError::new("Proje kaydedilemedi.", Some(e.to_string())))
}

#[tauri::command]
pub async fn project_read(path: String) -> Result<String, AppError> {
    let path = PathBuf::from(path);
    check_ext(&path)?;
    tokio::task::spawn_blocking(move || read_checked(&path))
        .await
        .map_err(|e| AppError::new("Proje dosyası okunamadı.", Some(e.to_string())))?
}

#[tauri::command]
pub async fn autosave_write(app: tauri::AppHandle, contents: String) -> Result<(), AppError> {
    validate(&contents)?;
    let path = data_dir(&app, "autosave")?.join(AUTOSAVE_NAME);
    tokio::task::spawn_blocking(move || write_atomic(&path, &contents))
        .await
        .map_err(|e| AppError::new("Otomatik kayıt yapılamadı.", Some(e.to_string())))?
        .map_err(|e| AppError::new("Otomatik kayıt yapılamadı.", Some(e.to_string())))
}

/// Kurtarma dosyası (yoksa ya da bozuksa null).
#[tauri::command]
pub async fn autosave_read(app: tauri::AppHandle) -> Result<Option<String>, AppError> {
    let path = data_dir(&app, "autosave")?.join(AUTOSAVE_NAME);
    Ok(
        tokio::task::spawn_blocking(move || read_checked(&path).ok())
            .await
            .unwrap_or(None),
    )
}

#[tauri::command]
pub async fn autosave_clear(app: tauri::AppHandle) -> Result<(), AppError> {
    let path = data_dir(&app, "autosave")?.join(AUTOSAVE_NAME);
    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(tmp_path(&path));
    Ok(())
}

/// Her yol için dosya var mı (eksik medya denetimi).
#[tauri::command]
pub fn paths_exist(paths: Vec<String>) -> Vec<bool> {
    paths.iter().map(|p| Path::new(p).is_file()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("downkit-project-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn yalnizca_downkit_uzantisi() {
        assert!(check_ext(Path::new("a.downkit")).is_ok());
        assert!(check_ext(Path::new("eski.CLIPKIT")).is_ok());
        assert!(check_ext(Path::new("a.DOWNKIT")).is_ok());
        assert!(check_ext(Path::new("a.json")).is_err());
        assert!(check_ext(Path::new("a")).is_err());
    }

    #[test]
    fn dogrulama_bozuk_ve_yabanci_dosyayi_reddeder() {
        assert!(validate(r#"{"schemaVersion":1,"clips":[]}"#).is_ok());
        assert!(validate("{bozuk").is_err());
        assert!(validate(r#"{"clips":[]}"#).is_err());
        assert!(validate(r#"{"schemaVersion":"1"}"#).is_err());
    }

    #[test]
    fn atomik_yazma_yerine_gecer_ve_gecici_dosya_kalmaz() {
        let dir = temp("atomic");
        let file = dir.join("p.downkit");
        write_atomic(&file, r#"{"schemaVersion":1,"a":1}"#).unwrap();
        write_atomic(&file, r#"{"schemaVersion":1,"a":2}"#).unwrap();
        assert_eq!(
            std::fs::read_to_string(&file).unwrap(),
            r#"{"schemaVersion":1,"a":2}"#
        );
        assert!(!tmp_path(&file).exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn yarim_kalan_gecici_dosya_asil_dosyayi_bozmaz() {
        // Yazma ortasında kapanma: geçici dosya yarım kaldı, asıl dosya sağlam.
        let dir = temp("crash");
        let file = dir.join("p.downkit");
        write_atomic(&file, r#"{"schemaVersion":1,"ok":true}"#).unwrap();
        std::fs::write(tmp_path(&file), r#"{"schemaVersion":1,"ok":tr"#).unwrap();
        assert_eq!(
            read_checked(&file).unwrap(),
            r#"{"schemaVersion":1,"ok":true}"#
        );
        // Sonraki kayıt yarım dosyanın üzerine yazar.
        write_atomic(&file, r#"{"schemaVersion":1,"ok":2}"#).unwrap();
        assert!(read_checked(&file).unwrap().contains("\"ok\":2"));
        assert!(!tmp_path(&file).exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn yedekler_doner_en_yeni_bes_tanesi_kalir() {
        let dir = temp("backup");
        let file = dir.join("p.downkit");
        let backups = dir.join("backups");
        for i in 0..8 {
            write_atomic(&file, &format!(r#"{{"schemaVersion":1,"n":{i}}}"#)).unwrap();
            backup_existing(&file, &backups, 5).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(3));
        }
        let kept: Vec<_> = std::fs::read_dir(backups.join(path_key(&file)))
            .unwrap()
            .filter_map(|e| e.ok())
            .collect();
        assert_eq!(kept.len(), 5);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn olmayan_dosya_yedeklenmez() {
        let dir = temp("nobackup");
        backup_existing(&dir.join("yok.downkit"), &dir.join("b"), 5).unwrap();
        assert!(!dir.join("b").exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn eksik_dosyalar_bulunur() {
        let dir = temp("exist");
        let here = dir.join("var.mp4");
        std::fs::write(&here, b"x").unwrap();
        let result = paths_exist(vec![
            here.to_string_lossy().into_owned(),
            dir.join("yok.mp4").to_string_lossy().into_owned(),
        ]);
        assert_eq!(result, vec![true, false]);
        let _ = std::fs::remove_dir_all(dir);
    }
}
