//! Görüntüdeki yazıyı okuma: Windows 10/11'in kendi OCR motoru
//! (`Windows.Media.Ocr`). Çevrimdışıdır, ek indirme istemez; tanıyabildiği diller
//! Windows'ta yüklü dil paketlerine bağlıdır (Türkçe Windows'ta Türkçe ve
//! İngilizce hazır gelir). Görüntü bilgisayardan çıkmaz.

use std::path::Path;

use image::imageops::FilterType;
use serde::Serialize;
use windows::core::HSTRING;
use windows::Globalization::Language;
use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::OcrEngine;
use windows::Security::Cryptography::CryptographicBuffer;
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

use crate::error::AppError;

/// Küçük yazı motorda kaçar: kısa kenar bundan azsa görüntü büyütülür.
const MIN_SHORT_SIDE: u32 = 600;
/// Büyütme en fazla bu kat (çok küçük seçimde bulanıklaşmasın).
const MAX_UPSCALE: f32 = 3.0;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrLine {
    pub text: String,
    /// Satırın görüntüdeki yeri (özgün piksel).
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrOutput {
    /// Kullanılan tanıma dili ("tr", "en-US").
    pub language: String,
    pub lines: Vec<OcrLine>,
}

/// Motorun işleyeceği ölçek: küçük görüntü büyütülür, sınırı aşan küçültülür.
fn working_scale(width: u32, height: u32, max_dimension: u32) -> f32 {
    let short = width.min(height).max(1) as f32;
    let long = width.max(height).max(1) as f32;
    let up = (MIN_SHORT_SIDE as f32 / short).clamp(1.0, MAX_UPSCALE);
    up.min(max_dimension as f32 / long)
}

fn engine_for(language: Option<&str>) -> windows::core::Result<OcrEngine> {
    if let Some(tag) = language {
        let lang = Language::CreateLanguage(&HSTRING::from(tag))?;
        if OcrEngine::IsLanguageSupported(&lang)? {
            return OcrEngine::TryCreateFromLanguage(&lang);
        }
    }
    OcrEngine::TryCreateFromUserProfileLanguages()
}

fn recognize(path: &Path, language: Option<&str>) -> Result<OcrOutput, String> {
    let image = image::open(path).map_err(|e| e.to_string())?.to_rgba8();
    let max = OcrEngine::MaxImageDimension().map_err(|e| e.to_string())?;
    let scale = working_scale(image.width(), image.height(), max);
    let image = if (scale - 1.0).abs() > 0.01 {
        let w = ((image.width() as f32 * scale).round() as u32).max(1);
        let h = ((image.height() as f32 * scale).round() as u32).max(1);
        image::imageops::resize(&image, w, h, FilterType::CatmullRom)
    } else {
        image
    };
    let (w, h) = image.dimensions();
    let bgra: Vec<u8> = image
        .pixels()
        .flat_map(|p| [p[2], p[1], p[0], p[3]])
        .collect();

    // WinRT bu iş parçacığında başlatılır (zaten başlatılmışsa hata önemsizdir).
    let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
    let run = || -> windows::core::Result<OcrOutput> {
        let buffer = CryptographicBuffer::CreateFromByteArray(&bgra)?;
        let bitmap = SoftwareBitmap::CreateCopyFromBuffer(
            &buffer,
            BitmapPixelFormat::Bgra8,
            w as i32,
            h as i32,
        )?;
        let engine = engine_for(language)?;
        let result = engine.RecognizeAsync(&bitmap)?.join()?;
        let mut lines = Vec::new();
        for line in result.Lines()? {
            let text = line.Text()?.to_string();
            let (mut left, mut top, mut right, mut bottom) = (f32::MAX, f32::MAX, 0f32, 0f32);
            for word in line.Words()? {
                let r = word.BoundingRect()?;
                left = left.min(r.X);
                top = top.min(r.Y);
                right = right.max(r.X + r.Width);
                bottom = bottom.max(r.Y + r.Height);
            }
            if text.trim().is_empty() || right <= left {
                continue;
            }
            lines.push(OcrLine {
                text,
                x: left / scale,
                y: top / scale,
                width: (right - left) / scale,
                height: (bottom - top) / scale,
            });
        }
        Ok(OcrOutput {
            language: engine.RecognizerLanguage()?.LanguageTag()?.to_string(),
            lines,
        })
    };
    run().map_err(|e| e.message())
}

/// Görüntüdeki yazıyı satır satır okur. `language`: "en" / "tr" (yüklü değilse
/// Windows'un kullanıcı dilleri denenir).
#[tauri::command]
pub async fn ocr_image(path: String, language: Option<String>) -> Result<OcrOutput, AppError> {
    let file = std::path::PathBuf::from(&path);
    tokio::task::spawn_blocking(move || recognize(&file, language.as_deref()))
        .await
        .map_err(|e| AppError::new("Yazı okunamadı.", Some(e.to_string())))?
        .map_err(|detail| {
            AppError::coded(
                "ocrFailed",
                "Görüntüdeki yazı okunamadı. Windows'ta bu dilin paketi yüklü olmayabilir.",
                Some(detail),
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kucuk_gorunt_buyutulur_buyuk_kucultulur() {
        // 200 px yüksekliğinde şerit: 3 kata kadar büyütülür.
        assert!((working_scale(800, 200, 10_000) - 3.0).abs() < 1e-6);
        // Yeterince büyükse dokunulmaz.
        assert!((working_scale(1920, 1080, 10_000) - 1.0).abs() < 1e-6);
        // Motor sınırını aşan küçültülür.
        assert!(working_scale(20_000, 1000, 10_000) <= 0.5);
    }
}
