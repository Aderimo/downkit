//! Kaydedilebilecek kaynaklar: monitörler ve açık pencereler.
//!
//! ddagrab monitörü DXGI çıkış sırasıyla seçer (varsayılan ekran kartının
//! çıkışları). Her monitör bu sırayla eşleştirilir; eşleşmeyen (başka ekran
//! kartındaki) monitör gfxcapture ile yakalanır.

use std::collections::HashMap;

use serde::Serialize;
use windows::core::{w, BOOL, HSTRING};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, RECT};
use windows::Win32::Graphics::Dwm::{
    DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS,
};
use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1};
use windows::Win32::Graphics::Gdi::{
    EnumDisplayMonitors, GetMonitorInfoW, MonitorFromWindow, RedrawWindow, HDC, HMONITOR,
    MONITORINFO, MONITORINFOEXW, MONITOR_DEFAULTTONULL, RDW_ALLCHILDREN, RDW_ERASE, RDW_FRAME,
    RDW_INVALIDATE, RDW_UPDATENOW,
};
use windows::Win32::Storage::FileSystem::{
    GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW,
};
use windows::Win32::System::Threading::{
    GetCurrentProcessId, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetForegroundWindow, GetWindow, GetWindowLongPtrW, GetWindowTextW,
    GetWindowThreadProcessId, IsIconic, IsWindowVisible, GWL_EXSTYLE, GW_OWNER,
    MONITORINFOF_PRIMARY, WS_EX_TOOLWINDOW,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub hmonitor: u64,
    pub dda_index: Option<u32>,
    /// Masaüstü koordinatı (sanal ekranın sol üstü); çoklu ekran kaydında
    /// yan yana dizilim bu konumlarla yapılır.
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub primary: bool,
    /// Masaüstündeki sıra (soldan sağa, 1'den başlar): arayüzde "2. ekran".
    pub number: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    pub hwnd: u64,
    pub title: String,
    pub exe: String,
    pub width: u32,
    pub height: u32,
    pub minimized: bool,
    /// DownKit'in kendi penceresi.
    pub own: bool,
}

fn wide_to_string(buffer: &[u16]) -> String {
    let len = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
    String::from_utf16_lossy(&buffer[..len])
}

/// ddagrab'ın `output_idx` sırası: varsayılan ekran kartının çıkışları.
fn dda_indices() -> HashMap<isize, u32> {
    let mut map = HashMap::new();
    unsafe {
        let Ok(factory) = CreateDXGIFactory1::<IDXGIFactory1>() else {
            return map;
        };
        let Ok(adapter) = factory.EnumAdapters1(0) else {
            return map;
        };
        let mut index = 0;
        while let Ok(output) = adapter.EnumOutputs(index) {
            if let Ok(desc) = output.GetDesc() {
                map.insert(desc.Monitor.0 as isize, index);
            }
            index += 1;
        }
    }
    map
}

unsafe extern "system" fn collect_monitor(
    monitor: HMONITOR,
    _hdc: HDC,
    _rect: *mut RECT,
    data: LPARAM,
) -> BOOL {
    let list = unsafe { &mut *(data.0 as *mut Vec<(HMONITOR, RECT, bool)>) };
    let mut info = MONITORINFOEXW::default();
    info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
    if unsafe {
        GetMonitorInfoW(
            monitor,
            &mut info as *mut MONITORINFOEXW as *mut MONITORINFO,
        )
    }
    .as_bool()
    {
        let primary = info.monitorInfo.dwFlags & MONITORINFOF_PRIMARY != 0;
        list.push((monitor, info.monitorInfo.rcMonitor, primary));
    }
    BOOL(1)
}

pub fn list_monitors() -> Vec<MonitorInfo> {
    let mut raw: Vec<(HMONITOR, RECT, bool)> = Vec::new();
    unsafe {
        let _ = EnumDisplayMonitors(
            None,
            None,
            Some(collect_monitor),
            LPARAM(&mut raw as *mut _ as isize),
        );
    }
    // Soldan sağa, sonra yukarıdan aşağı: Windows'un ekran numaralarına yakın.
    raw.sort_by_key(|(_, r, _)| (r.left, r.top));
    let dda = dda_indices();
    raw.into_iter()
        .enumerate()
        .map(|(i, (monitor, rect, primary))| MonitorInfo {
            hmonitor: monitor.0 as usize as u64,
            dda_index: dda.get(&(monitor.0 as isize)).copied(),
            x: rect.left,
            y: rect.top,
            width: (rect.right - rect.left).max(0) as u32,
            height: (rect.bottom - rect.top).max(0) as u32,
            primary,
            number: i as u32 + 1,
        })
        .collect()
}

fn exe_name(pid: u32) -> String {
    exe_path(pid)
        .map(|path| path.rsplit(['\\', '/']).next().unwrap_or("").to_string())
        .unwrap_or_default()
}

fn exe_path(pid: u32) -> Option<String> {
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buffer = [0u16; 520];
        let mut size = buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            windows::core::PWSTR(buffer.as_mut_ptr()),
            &mut size,
        )
        .is_ok();
        let _ = CloseHandle(process);
        ok.then(|| String::from_utf16_lossy(&buffer[..size as usize]))
    }
}

/// Programın dosya bilgisindeki açıklaması (ör. "League of Legends"), yoksa None.
fn file_description(path: &str) -> Option<String> {
    let wide = HSTRING::from(path);
    unsafe {
        let size = GetFileVersionInfoSizeW(&wide, None);
        if size == 0 {
            return None;
        }
        let mut data = vec![0u8; size as usize];
        GetFileVersionInfoW(&wide, None, size, data.as_mut_ptr().cast()).ok()?;
        // Önce dil / kod sayfası çifti okunur, açıklama onun altında durur.
        let mut ptr: *mut core::ffi::c_void = std::ptr::null_mut();
        let mut len = 0u32;
        let translation = w!("\\VarFileInfo\\Translation");
        let lang = if VerQueryValueW(data.as_ptr().cast(), translation, &mut ptr, &mut len)
            .as_bool()
            && len >= 4
        {
            let pair = std::slice::from_raw_parts(ptr as *const u16, 2);
            format!("{:04x}{:04x}", pair[0], pair[1])
        } else {
            "040904b0".to_string()
        };
        let key = HSTRING::from(format!("\\StringFileInfo\\{lang}\\FileDescription"));
        if !VerQueryValueW(data.as_ptr().cast(), &key, &mut ptr, &mut len).as_bool() || len == 0 {
            return None;
        }
        let text = std::slice::from_raw_parts(ptr as *const u16, len as usize);
        let name = wide_to_string(text);
        let name = name.trim();
        (!name.is_empty()).then(|| name.to_string())
    }
}

/// "League of Legends (TM) Client" gibi adlardan marka işaretleri atılır.
pub fn clean_app_name(raw: &str) -> String {
    let without_marks: String = raw
        .replace("(TM)", "")
        .replace("(R)", "")
        .chars()
        .filter(|c| !matches!(c, '™' | '®' | '©'))
        .collect();
    without_marks
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Pencerenin programının görünen adı. Masaüstü (Gezgin) ve DownKit'in kendisi None.
fn window_app(hwnd: HWND) -> Option<String> {
    let mut pid = 0u32;
    unsafe {
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 || pid == GetCurrentProcessId() {
            return None;
        }
    }
    let path = exe_path(pid)?;
    let file = path.rsplit(['\\', '/']).next().unwrap_or("");
    if file.eq_ignore_ascii_case("explorer.exe") {
        return None;
    }
    let stem = file.rsplit_once('.').map_or(file, |(stem, _)| stem);
    let name = file_description(&path)
        .map(|d| clean_app_name(&d))
        .filter(|d| !d.is_empty())
        .unwrap_or_else(|| clean_app_name(stem));
    (!name.is_empty()).then_some(name)
}

/// Kaydın ayrılacağı klasörün adı (NVIDIA'daki oyun klasörü gibi): pencere
/// kaydında o pencerenin programı; ekran kaydında öndeki pencere ekranı tamamen
/// kaplıyorsa (tam ekran oyun ya da video) onun programı. Yoksa None ve kayıt
/// "Ana ekran" klasörüne gider.
pub fn app_folder(target: &super::args::CaptureTarget) -> Option<String> {
    use super::args::CaptureTarget;
    match target {
        CaptureTarget::Window { hwnd, .. } => window_app(HWND(*hwnd as usize as *mut _)),
        // Çoklu ekran kaydında tek bir uygulamaya bağlanamaz.
        CaptureTarget::Monitors { .. } => None,
        CaptureTarget::Monitor { hmonitor, .. } => unsafe {
            let front = GetForegroundWindow();
            if front.is_invalid() {
                return None;
            }
            let monitor = MonitorFromWindow(front, MONITOR_DEFAULTTONULL);
            if monitor.0 as usize as u64 != *hmonitor {
                return None;
            }
            let mut info = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            if !GetMonitorInfoW(monitor, &mut info).as_bool() {
                return None;
            }
            let mut rect = RECT::default();
            let _ = DwmGetWindowAttribute(
                front,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                &mut rect as *mut RECT as *mut _,
                std::mem::size_of::<RECT>() as u32,
            );
            let area =
                |r: &RECT| ((r.right - r.left).max(0) as i64) * ((r.bottom - r.top).max(0) as i64);
            let m = info.rcMonitor;
            let overlap = RECT {
                left: rect.left.max(m.left),
                top: rect.top.max(m.top),
                right: rect.right.min(m.right),
                bottom: rect.bottom.min(m.bottom),
            };
            // Gerçek tam ekran (%99,5): büyütülmüş pencere görev çubuğunu açıkta
            // bırakır (~%95) ve sayılmaz. %90 eşiğinde büyütülmüş Chrome'da yapılan
            // ekran kaydı "Ana ekran" yerine "Google Chrome" klasörüne gidiyordu.
            if area(&overlap) * 1000 < area(&m) * 995 {
                return None;
            }
            window_app(front)
        },
    }
}

unsafe extern "system" fn collect_window(hwnd: HWND, data: LPARAM) -> BOOL {
    let list = unsafe { &mut *(data.0 as *mut Vec<WindowInfo>) };
    unsafe {
        if !IsWindowVisible(hwnd).as_bool() {
            return BOOL(1);
        }
        // Başka bir pencereye ait iletişim kutuları ve araç pencereleri listelenmez.
        if GetWindow(hwnd, GW_OWNER).is_ok_and(|owner| !owner.is_invalid()) {
            return BOOL(1);
        }
        if GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW.0 != 0 {
            return BOOL(1);
        }
        // Gizlenmiş (ör. arka plandaki Mağaza uygulamaları) pencereler.
        let mut cloaked = 0u32;
        let _ = DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            &mut cloaked as *mut u32 as *mut _,
            std::mem::size_of::<u32>() as u32,
        );
        if cloaked != 0 {
            return BOOL(1);
        }
        let mut title = [0u16; 512];
        let len = GetWindowTextW(hwnd, &mut title);
        if len <= 0 {
            return BOOL(1);
        }
        let title = wide_to_string(&title[..len as usize]);
        if title == "Program Manager" {
            return BOOL(1);
        }
        let mut rect = RECT::default();
        let _ = DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut rect as *mut RECT as *mut _,
            std::mem::size_of::<RECT>() as u32,
        );
        let (width, height) = (
            (rect.right - rect.left).max(0) as u32,
            (rect.bottom - rect.top).max(0) as u32,
        );
        let minimized = IsIconic(hwnd).as_bool();
        if !minimized && (width < 80 || height < 60) {
            return BOOL(1);
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        list.push(WindowInfo {
            hwnd: hwnd.0 as usize as u64,
            title,
            exe: exe_name(pid),
            width,
            height,
            minimized,
            own: pid == GetCurrentProcessId(),
        });
    }
    BOOL(1)
}

/// Pencere yakalaması (Windows.Graphics.Capture) yalnızca pencere yeniden
/// çizilince kare verir; durağan pencerede ilk kare hiç gelmeyebilir. Pencereye
/// yeniden çizim isteği gönderilir (içeriği değişmez).
pub fn redraw_window(hwnd: u64) {
    unsafe {
        let _ = RedrawWindow(
            Some(HWND(hwnd as usize as *mut _)),
            None,
            None,
            RDW_INVALIDATE | RDW_ERASE | RDW_FRAME | RDW_ALLCHILDREN | RDW_UPDATENOW,
        );
    }
}

/// Kaydedilebilecek pencereler (görev çubuğunda görünenler).
pub fn list_windows() -> Vec<WindowInfo> {
    let mut list: Vec<WindowInfo> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(collect_window), LPARAM(&mut list as *mut _ as isize));
    }
    list
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uygulama_adindan_marka_isaretleri_atilir() {
        assert_eq!(
            clean_app_name("League of Legends (TM) Client"),
            "League of Legends Client"
        );
        assert_eq!(clean_app_name("VALORANT™  "), "VALORANT");
        assert_eq!(clean_app_name("Discord"), "Discord");
    }
}
