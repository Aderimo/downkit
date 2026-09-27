//! Kaynak seçici için küçük önizlemeler (Discord'un ekran paylaşımındaki gibi).
//!
//! Pencere `PrintWindow(PW_RENDERFULLCONTENT)` ile (arkada kalsa da içeriği
//! çizilir), ekran `BitBlt` ile alınır; GDI'nin HALFTONE küçültmesiyle istenen
//! genişliğe indirilip JPEG olarak döner. Simge durumundaki pencere çizilemez.

use base64::Engine;
use image::codecs::jpeg::JpegEncoder;
use image::ExtendedColorType;
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
    GetMonitorInfoW, ReleaseDC, SelectObject, SetStretchBltMode, StretchBlt, BITMAPINFO,
    BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HALFTONE, HBITMAP, HDC, HGDIOBJ, HMONITOR,
    MONITORINFO, SRCCOPY,
};
use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
use windows::Win32::UI::WindowsAndMessaging::{GetWindowRect, IsIconic, PW_RENDERFULLCONTENT};

const JPEG_QUALITY: u8 = 72;

/// Kaynak dikdörtgeni `draw` ile bir bellek bitmap'ine çizilir, küçültülür ve
/// JPEG veri adresine çevrilir.
fn capture(
    width: i32,
    height: i32,
    max_width: u32,
    draw: impl FnOnce(HDC) -> bool,
) -> Option<String> {
    if width <= 0 || height <= 0 {
        return None;
    }
    let thumb_w = (max_width as i32).min(width).max(1);
    let thumb_h = ((height as i64 * thumb_w as i64) / width as i64).max(1) as i32;
    unsafe {
        let screen = GetDC(None);
        let full_dc = CreateCompatibleDC(Some(screen));
        let full_bmp = CreateCompatibleBitmap(screen, width, height);
        let old_full = SelectObject(full_dc, HGDIOBJ(full_bmp.0));
        let thumb_dc = CreateCompatibleDC(Some(screen));
        let thumb_bmp = CreateCompatibleBitmap(screen, thumb_w, thumb_h);
        let old_thumb = SelectObject(thumb_dc, HGDIOBJ(thumb_bmp.0));

        let mut pixels = vec![0u8; (thumb_w * thumb_h * 4) as usize];
        let ok = draw(full_dc)
            && {
                SetStretchBltMode(thumb_dc, HALFTONE);
                StretchBlt(
                    thumb_dc,
                    0,
                    0,
                    thumb_w,
                    thumb_h,
                    Some(full_dc),
                    0,
                    0,
                    width,
                    height,
                    SRCCOPY,
                )
                .as_bool()
            }
            && read_pixels(thumb_dc, thumb_bmp, thumb_w, thumb_h, &mut pixels);

        SelectObject(thumb_dc, old_thumb);
        SelectObject(full_dc, old_full);
        let _ = DeleteObject(HGDIOBJ(thumb_bmp.0));
        let _ = DeleteObject(HGDIOBJ(full_bmp.0));
        let _ = DeleteDC(thumb_dc);
        let _ = DeleteDC(full_dc);
        ReleaseDC(None, screen);
        if !ok {
            return None;
        }
        encode(&pixels, thumb_w as u32, thumb_h as u32)
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

fn encode(bgra: &[u8], width: u32, height: u32) -> Option<String> {
    // Tamamen siyah kare (çizilemeyen pencere) önizleme sayılmaz.
    if bgra
        .as_chunks::<4>()
        .0
        .iter()
        .all(|p| p[0] < 4 && p[1] < 4 && p[2] < 4)
    {
        return None;
    }
    let rgb: Vec<u8> = bgra
        .as_chunks::<4>()
        .0
        .iter()
        .flat_map(|p| [p[2], p[1], p[0]])
        .collect();
    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, JPEG_QUALITY)
        .encode(&rgb, width, height, ExtendedColorType::Rgb8)
        .ok()?;
    Some(format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(jpeg)
    ))
}

pub fn window_thumb(hwnd: u64, max_width: u32) -> Option<String> {
    let hwnd = HWND(hwnd as usize as *mut _);
    unsafe {
        if IsIconic(hwnd).as_bool() {
            return None;
        }
        let mut rect = RECT::default();
        GetWindowRect(hwnd, &mut rect).ok()?;
        capture(
            rect.right - rect.left,
            rect.bottom - rect.top,
            max_width,
            |dc| PrintWindow(hwnd, dc, PRINT_WINDOW_FLAGS(PW_RENDERFULLCONTENT)).as_bool(),
        )
    }
}

pub fn monitor_thumb(hmonitor: u64, max_width: u32) -> Option<String> {
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
        capture(r.right - r.left, r.bottom - r.top, max_width, |dc| {
            let screen = GetDC(None);
            let ok = BitBlt(
                dc,
                0,
                0,
                r.right - r.left,
                r.bottom - r.top,
                Some(screen),
                r.left,
                r.top,
                SRCCOPY,
            )
            .is_ok();
            ReleaseDC(None, screen);
            ok
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn siyah_kare_onizleme_sayilmaz() {
        assert!(encode(&[0u8; 16], 2, 2).is_none());
    }

    #[test]
    fn renkli_kare_jpeg_veri_adresine_cevrilir() {
        let pixels: Vec<u8> = (0..16 * 16)
            .flat_map(|i| [i as u8, 120, 200, 255])
            .collect();
        let url = encode(&pixels, 16, 16).expect("jpeg");
        assert!(url.starts_with("data:image/jpeg;base64,"));
    }
}
