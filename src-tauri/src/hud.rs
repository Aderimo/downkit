//! Ekranın köşesinde kısa süre görünen bilgi penceresi (NVIDIA'nın "Kayıt başladı /
//! Son 1 dakika kaydedildi" bildirimi gibi). Kısayol oyun oynarken basıldığında
//! kullanıcı ne olduğunu görsün diye.
//!
//! - Odak almaz (WS_EX_NOACTIVATE + SW_SHOWNOACTIVATE): tam ekran oyunu küçültmez.
//! - Ekran yakalamaya görünmez (WDA_EXCLUDEFROMCAPTURE): kendi kaydımıza girmez.
//! - İlk kullanımda oluşturulur; sayfası açılınca son mesajı `hud_current` ile alır.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::error::AppError;

const LABEL: &str = "hud";
const WIDTH: f64 = 380.0;
const HEIGHT: f64 = 96.0;
const MARGIN: f64 = 24.0;
const VISIBLE_MS: u64 = 2800;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HudMessage {
    id: u64,
    /// "record" | "saved" | "replayOn" | "replayOff" | "error" | "info"
    kind: String,
    title: String,
    detail: Option<String>,
}

static SEQ: AtomicU64 = AtomicU64::new(0);
static LATEST: Mutex<Option<HudMessage>> = Mutex::new(None);

#[tauri::command]
pub fn hud_current() -> Option<HudMessage> {
    LATEST.lock().ok().and_then(|m| m.clone())
}

fn create(app: &AppHandle) -> Result<WebviewWindow, AppError> {
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html?hud=1".into()))
        .title("DownKit")
        .inner_size(WIDTH, HEIGHT)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focusable(false)
        .focused(false)
        .visible(false)
        .build()
        .map_err(|e| AppError::new("Bilgi penceresi açılamadı.", Some(e.to_string())))?;
    #[cfg(windows)]
    if let Ok(raw) = window.hwnd() {
        // Tauri başka bir windows sürümü kullanıyor: tutamaç ham işaretçiyle aktarılır.
        let hwnd = windows::Win32::Foundation::HWND(raw.0);
        use windows::Win32::UI::WindowsAndMessaging::{
            SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE,
        };
        // Windows 10 2004 öncesinde desteklenmez; o zaman kayıtta görünebilir.
        let _ = unsafe { SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE) };
    }
    Ok(window)
}

/// İmlecin bulunduğu ekranın sağ üst köşesi (oyun o ekrandadır).
fn place(app: &AppHandle, window: &WebviewWindow) {
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return;
    };
    let scale = monitor.scale_factor();
    let (pos, size) = (monitor.position(), monitor.size());
    let x = pos.x as f64 + size.width as f64 - (WIDTH + MARGIN) * scale;
    let y = pos.y as f64 + MARGIN * scale;
    let _ = window.set_size(tauri::LogicalSize::new(WIDTH, HEIGHT));
    let _ = window.set_position(tauri::PhysicalPosition::new(x.round(), y.round()));
}

fn show_without_focus(window: &WebviewWindow) {
    #[cfg(windows)]
    if let Ok(raw) = window.hwnd() {
        // Tauri başka bir windows sürümü kullanıyor: tutamaç ham işaretçiyle aktarılır.
        let hwnd = windows::Win32::Foundation::HWND(raw.0);
        use windows::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, ShowWindow, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
            SW_SHOWNOACTIVATE,
        };
        unsafe {
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            let _ = SetWindowPos(
                hwnd,
                Some(HWND_TOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE,
            );
        }
        return;
    }
    let _ = window.show();
}

/// `show_without_focus` pencereyi Tauri'nin haberi olmadan gösterdiği için gizleme
/// de doğrudan yapılır: Tauri pencereyi zaten gizli sandığından `hide()` hiçbir şey
/// yapmaz ve bilgi ekranda asılı kalır.
fn hide_window(window: &WebviewWindow) {
    #[cfg(windows)]
    if let Ok(raw) = window.hwnd() {
        let hwnd = windows::Win32::Foundation::HWND(raw.0);
        use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};
        unsafe {
            let _ = ShowWindow(hwnd, SW_HIDE);
        }
        return;
    }
    let _ = window.hide();
}

#[tauri::command]
pub async fn hud_show(
    app: AppHandle,
    kind: String,
    title: String,
    detail: Option<String>,
) -> Result<(), AppError> {
    let id = SEQ.fetch_add(1, Ordering::SeqCst) + 1;
    let message = HudMessage {
        id,
        kind,
        title,
        detail,
    };
    if let Ok(mut latest) = LATEST.lock() {
        *latest = Some(message.clone());
    }
    let window = match app.get_webview_window(LABEL) {
        Some(window) => window,
        None => create(&app)?,
    };
    place(&app, &window);
    let _ = app.emit_to(LABEL, "hud-message", message);
    show_without_focus(&window);
    // Daha yeni bir mesaj gelmediyse süre dolunca gizlenir.
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(VISIBLE_MS)).await;
        if SEQ.load(Ordering::SeqCst) == id {
            hide_window(&window);
        }
    });
    Ok(())
}
