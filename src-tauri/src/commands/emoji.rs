//! Altyazı emojileri: renkli emoji arayüzde (tuvalde) PNG olarak çizilir, burada
//! önbelleğe yazılır; dışa aktarmada resim olarak bindirilir (libass emojiyi tek
//! renk çizdiği için). Dosya adı emojinin kod noktalarıdır, içerik yalnızca PNG.

use base64::Engine;

use crate::error::AppError;
use crate::paths;

const MAX_BYTES: usize = 2 * 1024 * 1024;
const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

/// `1f525` ya da `2764-fe0f` gibi: küçük onaltılık kod noktaları, tireyle.
fn valid_name(name: &str) -> bool {
    let parts: Vec<&str> = name.split('-').collect();
    !name.is_empty()
        && parts.len() <= 10
        && parts.iter().all(|p| {
            (1..=8).contains(&p.len())
                && p.chars()
                    .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
        })
}

fn decode_png(data: &str) -> Result<Vec<u8>, AppError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.trim())
        .map_err(|_| AppError::new("Emoji resmi okunamadı.", None))?;
    if bytes.len() > MAX_BYTES || !bytes.starts_with(&PNG_SIGNATURE) {
        return Err(AppError::new("Emoji resmi okunamadı.", None));
    }
    Ok(bytes)
}

/// Emojinin PNG'sini önbelleğe yazar ve dosya yolunu döner.
#[tauri::command]
pub async fn emoji_image_write(
    app: tauri::AppHandle,
    name: String,
    data: String,
) -> Result<String, AppError> {
    if !valid_name(&name) {
        return Err(AppError::new("Emoji resmi okunamadı.", Some(name)));
    }
    let bytes = decode_png(&data)?;
    let file = paths::cache_dir(&app, "emoji")?.join(format!("{name}.png"));
    tokio::fs::write(&file, bytes)
        .await
        .map_err(|e| AppError::new("Emoji resmi kaydedilemedi.", Some(e.to_string())))?;
    Ok(file.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ad_yalnizca_kod_noktalari() {
        assert!(valid_name("1f525"));
        assert!(valid_name("2764-fe0f"));
        assert!(valid_name("1f468-200d-1f4bb"));
        assert!(!valid_name(""));
        assert!(!valid_name("1F525"));
        assert!(!valid_name("../a"));
        assert!(!valid_name("1f525-"));
        assert!(!valid_name("123456789"));
    }

    #[test]
    fn yalnizca_png_kabul_edilir() {
        let png =
            base64::engine::general_purpose::STANDARD.encode([&PNG_SIGNATURE[..], b"x"].concat());
        assert!(decode_png(&png).is_ok());
        let jpeg = base64::engine::general_purpose::STANDARD.encode([0xff, 0xd8, 0xff, 0xe0]);
        assert!(decode_png(&jpeg).is_err());
        assert!(decode_png("@@@").is_err());
    }
}
