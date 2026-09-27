//! Ekran görüntüsü: seçili kaynağın (ekran ya da pencere) tam çözünürlüklü
//! anlık görüntüsünü PNG olarak kaydeder. Yakalama `thumbs` ile aynı GDI
//! yolunu kullanır ama küçültme yapılmaz; simge durumundaki pencere çizilemez.

use image::codecs::png::PngEncoder;
use image::{ExtendedColorType, ImageEncoder};
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
    GetMonitorInfoW, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    HBITMAP, HDC, HGDIOBJ, HMONITOR, MONITORINFO, SRCCOPY,
};
use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
use windows::Win32::UI::WindowsAndMessaging::{GetWindowRect, IsIconic, PW_RENDERFULLCONTENT};

use super::args::CaptureTarget;
use crate::commands::edit::sanitize_name;
use crate::error::AppError;
use crate::jobs;

/// Tam boy yakalama: kaynak dikdörtgen `draw` ile bellek bitmap'ine çizilir ve
/// 32 bit BGRA pikseller (yukarıdan aşağı) döner.
fn grab(width: i32, height: i32, draw: impl FnOnce(HDC) -> bool) -> Option<Vec<u8>> {
    if width <= 0 || height <= 0 {
        return None;
    }
    unsafe {
        let screen = GetDC(None);
        let dc = CreateCompatibleDC(Some(screen));
        let bmp = CreateCompatibleBitmap(screen, width, height);
        let old = SelectObject(dc, HGDIOBJ(bmp.0));

        let mut pixels = vec![0u8; (width as usize) * (height as usize) * 4];
        let ok = draw(dc) && read_pixels(dc, bmp, width, height, &mut pixels);

        SelectObject(dc, old);
        let _ = DeleteObject(HGDIOBJ(bmp.0));
        let _ = DeleteDC(dc);
        ReleaseDC(None, screen);
        ok.then_some(pixels)
    }
}

/// 32 bit BGRA, yukarıdan aşağı satırlar.
unsafe fn read_pixels(dc: HDC, bmp: HBITMAP, width: i32, height: i32, out: &mut [u8]) -> bool {
    let mut info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let lines = unsafe {
        GetDIBits(
            dc,
            bmp,
            0,
            height as u32,
            Some(out.as_mut_ptr().cast()),
            &mut info,
            DIB_RGB_COLORS,
        )
    };
    lines == height
}

fn grab_window(hwnd: u64) -> Option<(Vec<u8>, i32, i32)> {
    let hwnd = HWND(hwnd as usize as *mut _);
    unsafe {
        if IsIconic(hwnd).as_bool() {
            return None;
        }
        let mut rect = RECT::default();
        GetWindowRect(hwnd, &mut rect).ok()?;
        let (w, h) = (rect.right - rect.left, rect.bottom - rect.top);
        let pixels = grab(w, h, |dc| {
            PrintWindow(hwnd, dc, PRINT_WINDOW_FLAGS(PW_RENDERFULLCONTENT)).as_bool()
        })?;
        Some((pixels, w, h))
    }
}

pub(crate) fn grab_monitor(hmonitor: u64) -> Option<(Vec<u8>, i32, i32)> {
    let monitor = HMONITOR(hmonitor as usize as *mut _);
    unsafe {
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return None;
        }
        let r = info.rcMonitor;
        let (w, h) = (r.right - r.left, r.bottom - r.top);
        let pixels = grab(w, h, |dc| {
            let screen = GetDC(None);
            let ok = BitBlt(dc, 0, 0, w, h, Some(screen), r.left, r.top, SRCCOPY).is_ok();
            ReleaseDC(None, screen);
            ok
        })?;
        Some((pixels, w, h))
    }
}

fn capture(target: CaptureTarget) -> Option<(Vec<u8>, i32, i32)> {
    match target {
        CaptureTarget::Window { hwnd, .. } => grab_window(hwnd),
        CaptureTarget::Monitor { hmonitor, .. } => grab_monitor(hmonitor),
    }
}

/// BGRA → RGBA (alfa dolu).
pub fn to_rgba(bgra: &[u8]) -> Vec<u8> {
    bgra.as_chunks::<4>()
        .0
        .iter()
        .flat_map(|p| [p[2], p[1], p[0], 255])
        .collect()
}

/// Kaynağın anlık görüntüsünü PNG olarak kayıt klasörüne (uygulamaya göre
/// klasörleme açıksa ilgili alt klasöre) yazar; dosya yolunu döndürür.
#[tauri::command]
pub async fn recorder_screenshot(
    target: CaptureTarget,
    output_dir: String,
    name: String,
    by_app: Option<bool>,
    folder_fallback: Option<String>,
) -> Result<String, AppError> {
    let shot_target = target.clone();
    let (bgra, width, height) = tokio::task::spawn_blocking(move || capture(shot_target))
        .await
        .map_err(|e| AppError::new("Ekran görüntüsü alınamadı.", Some(e.to_string())))?
        .ok_or_else(|| {
            AppError::coded(
                "screenshotFailed",
                "Ekran görüntüsü alınamadı. Pencere simge durumunda ya da kapalı olabilir.",
                None,
            )
        })?;

    let dir = super::app_dir(
        std::path::PathBuf::from(&output_dir),
        &target,
        by_app.unwrap_or(false),
        folder_fallback,
    )
    .await;
    tokio::fs::create_dir_all(&dir).await.map_err(|e| {
        AppError::new(
            "Ekran görüntüsü klasörü oluşturulamadı.",
            Some(e.to_string()),
        )
    })?;
    let output = jobs::unique_output_path(&dir, &sanitize_name(&name), "png");

    let rgba = to_rgba(&bgra);
    let mut png = Vec::new();
    PngEncoder::new(&mut png)
        .write_image(&rgba, width as u32, height as u32, ExtendedColorType::Rgba8)
        .map_err(|e| AppError::new("Ekran görüntüsü kodlanamadı.", Some(e.to_string())))?;
    tokio::fs::write(&output, &png)
        .await
        .map_err(|e| AppError::new("Ekran görüntüsü kaydedilemedi.", Some(e.to_string())))?;
    Ok(output.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bgra_rgba_cevrilir() {
        // Mavi (B=255) piksel RGBA'da kırmızı-kanala değil mavi-kanala geçmeli.
        assert_eq!(to_rgba(&[255, 10, 20, 0]), vec![20, 10, 255, 255]);
        assert_eq!(to_rgba(&[]), Vec::<u8>::new());
    }
}
