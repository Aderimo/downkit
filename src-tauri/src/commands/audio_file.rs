//! Arayüzün ürettiği ses dosyaları: ses efektleri (uygulamanın kendisi sentezler,
//! WAV, önbellekte) ve seslendirme kayıtları (mikrofondan WebM/Opus, Videolar\DownKit\
//! Seslendirme). Ad yalnızca küçük harf, rakam ve tire; içerik başlığı denetlenir.

use base64::Engine;
use tauri::{AppHandle, Manager};

use crate::error::AppError;
use crate::paths;

const SFX_MAX: usize = 5 * 1024 * 1024;
const VOICE_MAX: usize = 200 * 1024 * 1024;
const WAV: &[u8; 4] = b"RIFF";
const WEBM: [u8; 4] = [0x1a, 0x45, 0xdf, 0xa3];

fn valid_name(name: &str) -> bool {
    (1..=64).contains(&name.len())
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Türüne göre içerik denetimi: ses efekti WAV, seslendirme WebM.
fn check(kind: &str, bytes: &[u8]) -> Result<&'static str, AppError> {
    let bad = || AppError::new("Ses dosyası okunamadı.", None);
    match kind {
        "sfx" if bytes.len() <= SFX_MAX && bytes.starts_with(WAV) => Ok("wav"),
        "voice" if bytes.len() <= VOICE_MAX && bytes.starts_with(&WEBM) => Ok("webm"),
        _ => Err(bad()),
    }
}

/// Sesi yazar ve dosya yolunu döner. `kind`: "sfx" (önbellek) ya da "voice"
/// (Videolar\DownKit\Seslendirme, projeyle birlikte kalsın diye kalıcı).
#[tauri::command]
pub async fn audio_file_write(
    app: AppHandle,
    kind: String,
    name: String,
    data: String,
) -> Result<String, AppError> {
    if !valid_name(&name) {
        return Err(AppError::new("Ses dosyası adı geçersiz.", Some(name)));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.trim())
        .map_err(|_| AppError::new("Ses dosyası okunamadı.", None))?;
    let ext = check(&kind, &bytes)?;
    let dir = if kind == "sfx" {
        paths::cache_dir(&app, "sfx")?
    } else {
        let videos = app
            .path()
            .video_dir()
            .map_err(|e| AppError::new("Videolar klasörü bulunamadı.", Some(e.to_string())))?;
        let dir = paths::media_dir(&videos).join("Seslendirme");
        std::fs::create_dir_all(&dir)
            .map_err(|e| AppError::new("Klasör oluşturulamadı.", Some(e.to_string())))?;
        dir
    };
    let file = dir.join(format!("{name}.{ext}"));
    tokio::fs::write(&file, bytes)
        .await
        .map_err(|e| AppError::new("Ses dosyası kaydedilemedi.", Some(e.to_string())))?;
    Ok(file.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ad_ve_icerik_denetlenir() {
        assert!(valid_name("whoosh-1"));
        assert!(!valid_name("../x"));
        assert!(!valid_name("Ses"));
        assert!(!valid_name(""));
        assert_eq!(check("sfx", b"RIFF....WAVE").unwrap(), "wav");
        assert!(check("sfx", b"OggS").is_err());
        assert_eq!(
            check("voice", &[0x1a, 0x45, 0xdf, 0xa3, 0]).unwrap(),
            "webm"
        );
        assert!(check("voice", b"RIFF").is_err());
        assert!(check("other", b"RIFF").is_err());
    }
}
