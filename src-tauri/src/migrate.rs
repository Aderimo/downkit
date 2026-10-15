//! Eski kurulumlardan DownKit'e geçiş (ilk açılışta, bir kez).
//!
//! Program iki kez kimlik değiştirdi: DownKit 0.3 (`com.downkit.app`) → ClipKit
//! (`com.aderimo.clipkit`) → DownKit 0.4 (`com.aderimo.downkit`). Her kimliğin
//! kendi veri klasörü var. Yeni klasörde ayar dosyası yoksa eskilerden şunlar
//! alınır (kopyalanır, taşınmaz: eski program hâlâ kuruluysa bozulmasın):
//! - ayarlar (`prefs.json`): `clipkit.*` / `downkit.*` anahtarları `downkit.*` olur.
//!   Önce ClipKit'inki; ClipKit'te olmayanlar (indirme geçmişi, aramalar…) 0.3'ten.
//! - indirilmiş araçlar (`bin\`: FFmpeg, yt-dlp, deno, altyazı motoru ve modelleri):
//!   aynı diskte sabit bağlantıyla (anında, yer kaplamaz), olmazsa kopyalanarak.
//! - otomatik kaydedilen proje ve donanım denetiminin sonucu.

use std::collections::BTreeMap;
use std::path::Path;

use tauri::{AppHandle, Manager};

/// Eski kimlikler ve anahtar önekleri; ilk sıradaki önceliklidir.
const SOURCES: [(&str, &str); 2] = [
    ("com.aderimo.clipkit", "clipkit."),
    ("com.downkit.app", "downkit."),
];
const NEW_PREFIX: &str = "downkit.";
/// Veri klasöründen alınan küçük dosyalar.
const SMALL_FILES: &[&str] = &["recorder-probe.json"];
/// Eski otomatik kayıt adı → yenisi.
const AUTOSAVE: (&str, &str) = ("current.clipkit", "current.downkit");
/// İç içe klasörlerde en fazla bu kadar derine inilir.
const MAX_DEPTH: usize = 6;

/// Eski önekli anahtarları yeni öneke çevirir; başka anahtarlar atılır.
fn rename_keys(old: BTreeMap<String, String>, prefix: &str) -> BTreeMap<String, String> {
    old.into_iter()
        .filter_map(|(key, value)| {
            key.strip_prefix(prefix)
                .map(|rest| (format!("{NEW_PREFIX}{rest}"), value))
        })
        .collect()
}

fn read_prefs(dir: &Path) -> Option<BTreeMap<String, String>> {
    let text = std::fs::read_to_string(dir.join("prefs.json")).ok()?;
    serde_json::from_str(&text).ok()
}

/// Ayarları birleştirir: kaynaklar sırayla, önce gelenin değeri kalır.
fn merge_prefs(sources: &[(BTreeMap<String, String>, &str)]) -> BTreeMap<String, String> {
    let mut merged = BTreeMap::new();
    for (map, prefix) in sources {
        for (key, value) in rename_keys(map.clone(), prefix) {
            merged.entry(key).or_insert(value);
        }
    }
    merged
}

/// Sabit bağlantı (aynı disk: anında, yer kaplamaz), olmazsa yarım kalmayan kopya.
fn link_or_copy(from: &Path, to: &Path) {
    if to.exists() {
        return;
    }
    if std::fs::hard_link(from, to).is_ok() {
        return;
    }
    let mut tmp = to.as_os_str().to_owned();
    tmp.push(".part");
    let tmp = std::path::PathBuf::from(tmp);
    if std::fs::copy(from, &tmp).is_ok() {
        let _ = std::fs::rename(&tmp, to);
    } else {
        let _ = std::fs::remove_file(&tmp);
    }
}

/// Klasörü (alt klasörleriyle) taşır; var olan dosyalara dokunmaz.
fn copy_tree(from: &Path, to: &Path, depth: usize) {
    if depth > MAX_DEPTH {
        return;
    }
    let Ok(entries) = std::fs::read_dir(from) else {
        return;
    };
    let _ = std::fs::create_dir_all(to);
    for entry in entries.flatten() {
        let path = entry.path();
        let target = to.join(entry.file_name());
        match entry.file_type() {
            Ok(t) if t.is_dir() => copy_tree(&path, &target, depth + 1),
            Ok(t) if t.is_file() => {
                // Yarım kalmış indirmeler taşınmaz.
                if path.extension().is_some_and(|e| e == "part") {
                    continue;
                }
                link_or_copy(&path, &target);
            }
            _ => {}
        }
    }
}

fn migrate_data(old: &Path, new: &Path) {
    copy_tree(&old.join("bin"), &new.join("bin"), 0);
    for name in SMALL_FILES {
        let from = old.join(name);
        if from.is_file() {
            let _ = std::fs::create_dir_all(new);
            link_or_copy(&from, &new.join(name));
        }
    }
    let autosave = old.join("autosave").join(AUTOSAVE.0);
    if autosave.is_file() {
        let dir = new.join("autosave");
        let _ = std::fs::create_dir_all(&dir);
        if let Ok(text) = std::fs::read_to_string(&autosave) {
            let target = dir.join(AUTOSAVE.1);
            if !target.exists() {
                let _ = std::fs::write(target, text);
            }
        }
    }
}

/// Hata sessizce geçilir: geçiş yalnızca kolaylıktır, program her durumda açılır.
pub fn from_previous(app: &AppHandle) {
    let (Ok(config), Ok(data)) = (app.path().app_config_dir(), app.path().app_data_dir()) else {
        return;
    };
    run(&config, &data);
}

fn run(config: &Path, data: &Path) {
    if config.join("prefs.json").exists() {
        return;
    }
    let (Some(config_root), Some(data_root)) = (config.parent(), data.parent()) else {
        return;
    };
    let found: Vec<_> = SOURCES
        .iter()
        .filter_map(|(id, prefix)| read_prefs(&config_root.join(id)).map(|m| (m, *prefix)))
        .collect();
    for (id, _) in SOURCES {
        migrate_data(&data_root.join(id), data);
    }
    let merged = merge_prefs(&found);
    if merged.is_empty() {
        return;
    }
    if let Ok(json) = serde_json::to_string(&merged) {
        let _ = std::fs::create_dir_all(config);
        let _ = std::fs::write(config.join("prefs.json"), json);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> std::path::PathBuf {
        let root =
            std::env::temp_dir().join(format!("downkit-migrate-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn once_clipkit_sonra_eski_downkit_anahtarlari_alinir() {
        let clipkit = BTreeMap::from([
            ("clipkit.settings".to_string(), "yeni".to_string()),
            ("clipkit.recorder".to_string(), "{\"fps\":60}".to_string()),
            ("baska.anahtar".to_string(), "x".to_string()),
        ]);
        let downkit = BTreeMap::from([
            ("downkit.settings".to_string(), "eski".to_string()),
            ("downkit.history".to_string(), "[1]".to_string()),
        ]);
        let merged = merge_prefs(&[(clipkit, "clipkit."), (downkit, "downkit.")]);
        assert_eq!(merged.len(), 3);
        assert_eq!(merged["downkit.settings"], "yeni");
        assert_eq!(merged["downkit.recorder"], "{\"fps\":60}");
        assert_eq!(merged["downkit.history"], "[1]");
    }

    #[test]
    fn ayarlar_araclar_ve_otomatik_kayit_tasinir_bir_kez() {
        let root = temp_root("tam");
        let (config, data) = (root.join("Roaming"), root.join("Roaming"));
        let old = config.join("com.aderimo.clipkit");
        let v03 = config.join("com.downkit.app");
        let new = config.join("com.aderimo.downkit");
        std::fs::create_dir_all(old.join("bin").join("whisper")).unwrap();
        std::fs::create_dir_all(old.join("autosave")).unwrap();
        std::fs::create_dir_all(v03.join("bin")).unwrap();
        std::fs::write(old.join("prefs.json"), r#"{"clipkit.settings":"{}"}"#).unwrap();
        std::fs::write(v03.join("prefs.json"), r#"{"downkit.history":"[]"}"#).unwrap();
        std::fs::write(old.join("bin").join("ffmpeg.exe"), b"ffmpeg").unwrap();
        std::fs::write(
            old.join("bin").join("whisper").join("ggml-base.bin"),
            b"model",
        )
        .unwrap();
        std::fs::write(old.join("bin").join("yarim.exe.part"), b"x").unwrap();
        std::fs::write(v03.join("bin").join("yt-dlp.exe"), b"ytdlp").unwrap();
        std::fs::write(
            old.join("autosave").join("current.clipkit"),
            b"{\"schemaVersion\":1}",
        )
        .unwrap();
        std::fs::write(old.join("recorder-probe.json"), b"{}").unwrap();

        run(&new, &data.join("com.aderimo.downkit"));
        let prefs = std::fs::read_to_string(new.join("prefs.json")).unwrap();
        assert!(prefs.contains("downkit.settings") && prefs.contains("downkit.history"));
        assert!(!prefs.contains("clipkit."));
        assert_eq!(
            std::fs::read(new.join("bin").join("ffmpeg.exe")).unwrap(),
            b"ffmpeg"
        );
        assert!(new
            .join("bin")
            .join("whisper")
            .join("ggml-base.bin")
            .is_file());
        assert!(new.join("bin").join("yt-dlp.exe").is_file());
        assert!(!new.join("bin").join("yarim.exe.part").exists());
        assert!(new.join("autosave").join("current.downkit").is_file());
        assert!(new.join("recorder-probe.json").is_file());
        // Eski dosyalar yerinde kalır.
        assert!(old.join("bin").join("ffmpeg.exe").is_file());

        // İkinci açılışta (ayar dosyası var) hiçbir şeye dokunulmaz.
        std::fs::write(new.join("prefs.json"), r#"{"downkit.settings":"degisti"}"#).unwrap();
        run(&new, &data.join("com.aderimo.downkit"));
        let kept = std::fs::read_to_string(new.join("prefs.json")).unwrap();
        assert!(kept.contains("degisti"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn eski_kurulum_yoksa_bir_sey_yazilmaz() {
        let root = temp_root("bos");
        let new = root.join("com.aderimo.downkit");
        run(&new, &new);
        assert!(!new.join("prefs.json").exists());
        let _ = std::fs::remove_dir_all(root);
    }
}
