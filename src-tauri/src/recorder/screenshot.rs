//! Ekran görüntüsü: seçili kaynağın (ekran ya da pencere) tam çözünürlüklü
//! anlık görüntüsünü PNG olarak kaydeder. Yakalama `thumbs` ile aynı GDI
//! yolunu kullanır ama küçültme yapılmaz; simge durumundaki pencere çizilemez.

use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
    GetMonitorInfoW, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    HBITMAP, HDC, HGDIOBJ, HMONITOR, MONITORINFO, SRCCOPY,
};

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

/// BGRA → RGBA (alfa dolu).
pub fn to_rgba(bgra: &[u8]) -> Vec<u8> {
    bgra.as_chunks::<4>()
        .0
        .iter()
        .flat_map(|p| [p[2], p[1], p[0], 255])
        .collect()
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
