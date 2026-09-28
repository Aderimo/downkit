//! Kayıtlar sayfası: kayıt klasöründeki videolar, küçük resimleri, silme
//! (Geri Dönüşüm Kutusu'na), yeniden adlandırma ve yarım kalmış MKV'nin onarımı.
//! Kayıtlar oyuna / uygulamaya göre bir alt klasörde olabilir ("Kayıtlar\\League of
//! Legends"). Silme/adlandırma yalnızca o klasördeki ve bir alt seviyedeki
//! video dosyalarına izin verir.

use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use base64::Engine;
use futures_util::StreamExt;
use serde::Serialize;

use super::{args, pipeline};

pub const VIDEO_EXTENSIONS: [&str; 4] = ["mp4", "mkv", "mov", "webm"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingFile {
    pub path: String,
    pub name: String,
    pub extension: String,
    pub size_bytes: u64,
    pub modified_ms: u64,
    /// Oluşturulma zamanı (yoksa değiştirilme): kütüphane buna göre sıralar.
    pub created_ms: u64,
    /// Alt klasör (oyun / uygulama adı); kayıt klasörünün kendisindeyse yok.
    pub folder: Option<String>,
    pub duration_seconds: Option<f64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// Program kapanırken yarım kalmış MKV: MP4'e aktarılabilir.
    pub needs_repair: bool,
}

/// Süre/çözünürlük önbelleği: (yol, boyut, değişme zamanı) aynıysa yeniden okunmaz.
pub type MetaCache = HashMap<(String, u64, u64), (Option<f64>, Option<u32>, Option<u32>)>;

fn extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
}

pub fn is_video(path: &Path) -> bool {
    extension(path).is_some_and(|e| VIDEO_EXTENSIONS.contains(&e.as_str()))
}

/// `path` gerçekten `dir` klasöründe ya da onun bir alt klasöründe (daha derinde
/// değil) bir video mu?
pub fn check_inside(path: &Path, dir: &Path) -> Result<PathBuf, String> {
    let file = path
        .canonicalize()
        .map_err(|_| "Kayıt bulunamadı.".to_string())?;
    let folder = dir
        .canonicalize()
        .map_err(|_| "Kayıt klasörü bulunamadı.".to_string())?;
    let parent = file.parent();
    let inside =
        parent == Some(folder.as_path()) || parent.and_then(Path::parent) == Some(folder.as_path());
    if !inside || !is_video(&file) || !file.is_file() {
        return Err("Bu dosya kayıt klasöründe değil.".into());
    }
    Ok(plain_path(file))
}

/// `canonicalize` Windows'ta `\\?\C:\…` biçimi verir; arayüze ve diğer
/// komutlara olağan `C:\…` yolu gider (ağ yolları olduğu gibi kalır).
pub(crate) fn plain_path(path: PathBuf) -> PathBuf {
    const VERBATIM: &str = r"\\?\";
    match path.to_str().and_then(|s| s.strip_prefix(VERBATIM)) {
        Some(rest) if !rest.starts_with(r"UNC\") => PathBuf::from(rest),
        _ => path,
    }
}

struct Found {
    path: PathBuf,
    size: u64,
    modified: u64,
    created: u64,
    folder: Option<String>,
}

pub async fn list(
    ffmpeg_dir: &Path,
    dir: &Path,
    exclude: Option<&Path>,
    cache: &mut MetaCache,
) -> Vec<RecordingFile> {
    // Kayıt klasörü ve bir alt seviyesi (oyun / uygulama klasörleri).
    let mut folders: Vec<(PathBuf, Option<String>)> = vec![(dir.to_path_buf(), None)];
    let mut files: Vec<Found> = Vec::new();
    let mut index = 0;
    while index < folders.len() {
        let (folder, folder_name) = folders[index].clone();
        index += 1;
        let Ok(mut entries) = tokio::fs::read_dir(&folder).await else {
            continue;
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            let Ok(meta) = entry.metadata().await else {
                continue;
            };
            if meta.is_dir() {
                if folder_name.is_none() {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    if !name.starts_with('.') {
                        folders.push((path, Some(name)));
                    }
                }
                continue;
            }
            if !meta.is_file() || !is_video(&path) || exclude.is_some_and(|e| e == path) {
                continue;
            }
            let millis = |t: std::io::Result<std::time::SystemTime>| {
                t.ok()
                    .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
            };
            let modified = millis(meta.modified()).unwrap_or(0);
            let created = millis(meta.created()).unwrap_or(modified);
            files.push(Found {
                path,
                size: meta.len(),
                modified,
                created,
                folder: folder_name.clone(),
            });
        }
    }

    // Önbellekte olmayanlar dörder dörder okunur.
    let missing: Vec<(String, u64, u64)> = files
        .iter()
        .map(|f| (f.path.to_string_lossy().into_owned(), f.size, f.modified))
        .filter(|key| !cache.contains_key(key))
        .collect();
    let probed: Vec<_> = futures_util::stream::iter(missing)
        .map(|key| async move {
            let info = crate::ffmpeg::convert::probe_file(ffmpeg_dir, &key.0)
                .await
                .ok();
            let meta = info
                .map(|i| (i.duration_seconds, i.width, i.height))
                .unwrap_or((None, None, None));
            (key, meta)
        })
        .buffer_unordered(4)
        .collect()
        .await;
    cache.extend(probed);

    let mut result: Vec<RecordingFile> = files
        .into_iter()
        .map(|f| {
            let key = (f.path.to_string_lossy().into_owned(), f.size, f.modified);
            let path = f.path;
            let (duration, width, height) = cache.get(&key).copied().unwrap_or_default();
            let ext = extension(&path).unwrap_or_default();
            RecordingFile {
                name: path
                    .file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                needs_repair: ext == "mkv",
                extension: ext,
                path: key.0,
                size_bytes: f.size,
                modified_ms: f.modified,
                created_ms: f.created,
                folder: f.folder,
                duration_seconds: duration,
                width,
                height,
            }
        })
        .collect();
    // Eskiden yeniye: en yeni kayıt en altta (kütüphane de böyle gösterir).
    result.sort_by_key(|f| f.created_ms);
    result
}

/// Küçük resim (JPEG, data URL). Önbellekte yoksa FFmpeg ile üretilir.
pub async fn thumbnail(ffmpeg_dir: &Path, cache_dir: &Path, path: &Path) -> Option<String> {
    let meta = tokio::fs::metadata(path).await.ok()?;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut hasher);
    meta.len().hash(&mut hasher);
    meta.modified().ok().hash(&mut hasher);
    let file = cache_dir.join(format!("{:016x}.jpg", hasher.finish()));
    if !file.exists() {
        let info = crate::ffmpeg::convert::probe_file(ffmpeg_dir, &path.to_string_lossy())
            .await
            .ok()?;
        info.video_codec.as_ref()?;
        // İlk kare çoğu zaman siyah ya da geçiş: biraz ileriden alınır.
        let at = info.duration_seconds.map_or(0.0, |d| (d * 0.1).min(2.0));
        let args = args::thumbnail_args(&path.to_string_lossy(), at, &file.to_string_lossy());
        pipeline::run_ffmpeg(&ffmpeg_dir.join("ffmpeg.exe"), args)
            .await
            .ok()?;
    }
    let bytes = tokio::fs::read(&file).await.ok()?;
    Some(format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

/// Geri Dönüşüm Kutusu'na taşır (kalıcı silmez; oradan geri alınabilir).
///
/// trash crate'i COM'u STA olarak başlatır ve başarısızlıkta `panic!` atar.
/// Tokio'nun paylaşılan engelleme havuzundaki bir iş parçacığı daha önce
/// WinRT/OCR ile MTA olarak başlatıldıysa (ör. ekran görüntüsü yakalama)
/// CoInitializeEx RPC_E_CHANGED_MODE döndürür → panik → uygulama çökerdi.
/// Silme bu yüzden her seferinde COM durumu temiz, yeni bir iş parçacığında
/// çalışır; olası bir panik join üzerinden yakalanıp hataya çevrilir.
pub fn move_to_trash(path: &Path) -> Result<(), String> {
    let path = path.to_path_buf();
    std::thread::spawn(move || trash::delete(path))
        .join()
        .map_err(|_| "Silme işlemi beklenmedik biçimde kesildi.".to_string())?
        .map_err(|e| format!("Silinemedi: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn yalnizca_klasordeki_videolar_kabul_edilir() {
        let dir = std::env::temp_dir().join(format!("dk-kayit-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("alt")).unwrap();
        std::fs::write(dir.join("a.mp4"), b"x").unwrap();
        std::fs::write(dir.join("not.txt"), b"x").unwrap();
        std::fs::write(dir.join("alt").join("b.mp4"), b"x").unwrap();

        assert!(check_inside(&dir.join("a.mp4"), &dir).is_ok());
        assert!(check_inside(&dir.join("not.txt"), &dir).is_err());
        // Oyun / uygulama klasörü (bir alt seviye) kabul, daha derini değil.
        assert!(check_inside(&dir.join("alt").join("b.mp4"), &dir).is_ok());
        std::fs::create_dir_all(dir.join("alt").join("derin")).unwrap();
        std::fs::write(dir.join("alt").join("derin").join("c.mp4"), b"x").unwrap();
        assert!(check_inside(&dir.join("alt").join("derin").join("c.mp4"), &dir).is_err());
        assert!(check_inside(&dir.join("alt").join("..").join("a.mp4"), &dir).is_ok());
        assert!(check_inside(&dir.join("yok.mp4"), &dir).is_err());
        // Dönen yol olağan biçimde (`\\?\` öneki yok).
        let found = check_inside(&dir.join("a.mp4"), &dir).unwrap();
        assert!(!found.to_string_lossy().starts_with(r"\\?\"));
        assert!(found.ends_with("a.mp4"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cope_tasima_dosyayi_kaldirir_ve_cokmez() {
        // COM durumu daha önce MTA olarak başlatılmış bir iş parçacığında bile
        // (WinRT/OCR sonrası havuz iş parçacıkları gibi) panik olmamalı.
        let dir = std::env::temp_dir().join(format!("dk-cop-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("goruntu.png");
        std::fs::write(&file, b"x").unwrap();

        // MTA başlatması taklit edilir: bu iş parçacığında COM'u MTA yap.
        unsafe {
            let _ = windows::Win32::System::Com::CoInitializeEx(
                None,
                windows::Win32::System::Com::COINIT_MULTITHREADED,
            );
        }
        move_to_trash(&file).unwrap();
        assert!(!file.exists());
        unsafe {
            windows::Win32::System::Com::CoUninitialize();
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
