//! Ekran görüntüleri klasörü: Ekran Görüntüsü sayfasındaki son görüntülerin
//! listesi, küçük resimleri ve silme (Geri Dönüşüm Kutusu'na).

use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::recorder::library::plain_path;

/// Listede görünen uzantılar (WebP'yi Rust çözmez; küçük resmi tarayıcı çizer).
pub const EXTENSIONS: [&str; 4] = ["png", "jpg", "jpeg", "webp"];
/// Küçük resmin uzun kenarı (piksel).
const THUMB_SIDE: u32 = 480;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShotFile {
    pub path: String,
    pub name: String,
    pub bytes: u64,
    /// Son değişiklik, Unix zamanı (ms).
    pub modified: u64,
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default()
}

pub fn is_image(path: &Path) -> bool {
    EXTENSIONS.contains(&extension(path).as_str())
}

fn modified_ms(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Klasördeki görüntüler (alt klasörlere inilmez), en yeni önce; en fazla `limit`.
pub fn list(dir: &Path, limit: usize) -> Vec<ShotFile> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<ShotFile> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let meta = entry.metadata().ok()?;
            if !meta.is_file() || !is_image(&path) {
                return None;
            }
            Some(ShotFile {
                name: path.file_stem()?.to_string_lossy().into_owned(),
                path: path.to_string_lossy().into_owned(),
                bytes: meta.len(),
                modified: modified_ms(&meta),
            })
        })
        .collect();
    files.sort_by(|a, b| {
        b.modified
            .cmp(&a.modified)
            .then_with(|| a.name.cmp(&b.name))
    });
    files.truncate(limit);
    files
}

/// Yalnızca ekran görüntüsü klasöründeki (doğrudan içindeki) görüntüler silinir.
pub fn check_inside(path: &Path, dir: &Path) -> Result<PathBuf, String> {
    let file = path
        .canonicalize()
        .map_err(|_| "Görüntü bulunamadı.".to_string())?;
    let folder = dir
        .canonicalize()
        .map_err(|_| "Ekran görüntüsü klasörü bulunamadı.".to_string())?;
    if file.parent() != Some(folder.as_path()) || !is_image(&file) || !file.is_file() {
        return Err("Bu dosya ekran görüntüsü klasöründe değil.".into());
    }
    Ok(plain_path(file))
}

/// Küçük resim önbellekteki dosya adı: yol + boyut + değişiklik zamanı (görüntü
/// düzenlenip üstüne kaydedilirse yenisi üretilir).
fn thumb_name(path: &Path, meta: &std::fs::Metadata) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut hasher);
    meta.len().hash(&mut hasher);
    modified_ms(meta).hash(&mut hasher);
    format!("{:016x}.jpg", hasher.finish())
}

/// PNG/JPEG için önbellekte küçük JPEG üretir (yoksa). WebP ya da çözülemeyen
/// dosyada `None`: arayüz özgün dosyayı gösterir.
pub fn thumbnail(cache: &Path, path: &Path) -> Option<PathBuf> {
    if extension(path) == "webp" {
        return None;
    }
    let meta = std::fs::metadata(path).ok()?;
    let target = cache.join(thumb_name(path, &meta));
    if target.is_file() {
        return Some(target);
    }
    let image = image::open(path).ok()?;
    let small = image.thumbnail(THUMB_SIDE, THUMB_SIDE).to_rgb8();
    small
        .save_with_format(&target, image::ImageFormat::Jpeg)
        .ok()?;
    Some(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("dk-ekran-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn yalnizca_goruntuler_en_yeni_once_listelenir() {
        let dir = temp_dir();
        std::fs::write(dir.join("eski.png"), b"x").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(dir.join("yeni.WEBP"), b"xy").unwrap();
        std::fs::write(dir.join("not.txt"), b"x").unwrap();
        std::fs::create_dir_all(dir.join("alt.png")).unwrap();

        let files = list(&dir, 10);
        let names: Vec<&str> = files.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, vec!["yeni", "eski"]);
        assert_eq!(files[0].bytes, 2);
        assert_eq!(list(&dir, 1).len(), 1);
        assert!(list(&dir.join("yok"), 10).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn silme_yalnizca_klasordeki_goruntuye_izin_verir() {
        let dir = temp_dir();
        std::fs::create_dir_all(dir.join("alt")).unwrap();
        std::fs::write(dir.join("a.png"), b"x").unwrap();
        std::fs::write(dir.join("a.exe"), b"x").unwrap();
        std::fs::write(dir.join("alt").join("b.png"), b"x").unwrap();

        let ok = check_inside(&dir.join("a.png"), &dir).unwrap();
        assert!(!ok.to_string_lossy().starts_with(r"\\?\"));
        assert!(check_inside(&dir.join("a.exe"), &dir).is_err());
        assert!(check_inside(&dir.join("alt").join("b.png"), &dir).is_err());
        assert!(check_inside(&dir.join("yok.png"), &dir).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn kucuk_resim_uretilir_ve_onbellekten_doner() {
        let dir = temp_dir();
        let cache = dir.join("onbellek");
        std::fs::create_dir_all(&cache).unwrap();
        let source = dir.join("buyuk.png");
        image::RgbaImage::from_pixel(1200, 600, image::Rgba([10, 20, 30, 255]))
            .save(&source)
            .unwrap();

        let thumb = thumbnail(&cache, &source).unwrap();
        let (w, h) = image::image_dimensions(&thumb).unwrap();
        assert_eq!((w, h), (480, 240));
        assert_eq!(thumbnail(&cache, &source), Some(thumb));
        // WebP ve bozuk dosya için küçük resim yok.
        std::fs::write(dir.join("c.webp"), b"x").unwrap();
        assert!(thumbnail(&cache, &dir.join("c.webp")).is_none());
        std::fs::write(dir.join("bozuk.png"), b"x").unwrap();
        assert!(thumbnail(&cache, &dir.join("bozuk.png")).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
