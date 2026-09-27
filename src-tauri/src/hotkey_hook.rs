//! Yedek klavye kancası: bir birleşimi başka bir program tutuyorsa Windows
//! `RegisterHotKey` kaydını reddeder ve tuşu yalnızca o programa verir. Bu kanca
//! (WH_KEYBOARD_LL) tuşu sistem kancasından yine de görür ama TÜKETMEZ; tuş iki
//! programa da ulaşır. Böylece "başka program kullanıyor" denen kısayol DownKit'te
//! de çalışır. Birleşim normal yoldan kaydedilebilir hâle gelince (o program
//! bırakınca) izleme bırakılır ve tek tetikleme normal kayıttan gelir.
//!
//! Güvenlik kuralları (önceki bir kanca kullanıcının Alt+Tab'ını yutmuştu):
//! - Tuş hiçbir zaman yenmez; her olay `CallNextHookEx` ile aynen iletilir.
//! - Kanca yalnızca izlenen birleşim varken kuruludur; liste boşalınca kaldırılır.
//! - Kanca işlevi kilit beklemez (`try_lock`): Windows klavye girişini kanca
//!   dönene kadar bekletir, takılan bir kanca bütün sistemin klavyesini yavaşlatır.
//! - Olay yayını kanca iş parçacığının dışında yapılır.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::thread;

use tauri::{AppHandle, Emitter};
use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VIRTUAL_KEY, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetMessageW, PeekMessageW, PostThreadMessageW,
    SetWindowsHookExW, TranslateMessage, UnhookWindowsHookEx, KBDLLHOOKSTRUCT, LLKHF_INJECTED, MSG,
    PM_NOREMOVE, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_QUIT, WM_SYSKEYDOWN, WM_SYSKEYUP,
    WM_USER,
};

use crate::error::AppError;
use crate::hotkeys::parse_combo;

/// mods: 1=Ctrl, 2=Alt, 4=Shift.
#[derive(Clone, Copy, PartialEq, Eq)]
struct Combo {
    mods: u8,
    vk: u32,
}

struct HookState {
    app: Option<AppHandle>,
    /// Kancayı kuran iş parçacığı; `None` ise kanca kurulu değil.
    thread_id: Option<u32>,
    /// Eylem adı → izlenen birleşim (ör. "record" → Alt+F).
    watched: HashMap<String, Combo>,
    /// Tetikleyen ve hâlâ basılı tuşlar; basılı tutunca gelen tekrarlar süzülür.
    down: Vec<u32>,
}

fn state() -> &'static Mutex<HookState> {
    static STATE: OnceLock<Mutex<HookState>> = OnceLock::new();
    STATE.get_or_init(|| {
        Mutex::new(HookState {
            app: None,
            thread_id: None,
            watched: HashMap::new(),
            down: Vec::new(),
        })
    })
}

fn is_down(key: VIRTUAL_KEY) -> bool {
    (unsafe { GetAsyncKeyState(key.0 as i32) } as u16) & 0x8000 != 0
}

/// Basılı değiştiriciler; Windows tuşu basılıysa `None` (Win+Alt+F, Alt+F sayılmasın).
fn modifier_bits() -> Option<u8> {
    if is_down(VK_LWIN) || is_down(VK_RWIN) {
        return None;
    }
    Some(
        (is_down(VK_CONTROL) as u8)
            | ((is_down(VK_MENU) as u8) << 1)
            | ((is_down(VK_SHIFT) as u8) << 2),
    )
}

/// Olaya bakar, tetiklenecek eylemi döndürür. Kilit o an başka yerdeyse olay
/// atlanır: bir tetiklemeyi kaçırmak, bütün klavyeyi bekletmekten iyidir.
fn check(msg: u32, vk: u32) -> Option<(AppHandle, String)> {
    let mut st = state().try_lock().ok()?;
    // Kaldırılmakta olan eski bir kancanın olaylarını yok say (çift tetikleme olmasın).
    if st.thread_id != Some(unsafe { GetCurrentThreadId() }) {
        return None;
    }
    match msg {
        WM_KEYDOWN | WM_SYSKEYDOWN if !st.down.contains(&vk) => {
            let combo = Combo {
                mods: modifier_bits()?,
                vk,
            };
            let action = st
                .watched
                .iter()
                .find(|(_, c)| **c == combo)
                .map(|(action, _)| action.clone())?;
            st.down.push(vk);
            Some((st.app.clone()?, action))
        }
        WM_KEYUP | WM_SYSKEYUP => {
            st.down.retain(|&d| d != vk);
            None
        }
        _ => None,
    }
}

unsafe extern "system" fn hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let info = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
        // Başka bir programın yapay ürettiği tuşlar sayılmaz.
        if info.flags.0 & LLKHF_INJECTED.0 == 0 {
            if let Some((app, action)) = check(wparam.0 as u32, info.vkCode) {
                // Yayın kanca iş parçacığını bekletmesin.
                thread::spawn(move || {
                    let _ = app.emit("downkit-hotkey", action);
                });
            }
        }
    }
    // Tuş hiçbir zaman yenmez: öteki programın kısayolu da çalışmaya devam eder.
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

/// Kanca, kendi ileti döngüsü olan ayrı bir iş parçacığında kurulur (LL kancaları
/// ancak döngüsü olan iş parçacığında çalışır). `WM_QUIT` gelince kaldırılır.
fn start_hook(st: &mut HookState) -> Result<(), AppError> {
    if st.thread_id.is_some() {
        return Ok(());
    }
    let (tx, rx) = std::sync::mpsc::channel::<Result<u32, String>>();
    thread::spawn(move || unsafe {
        let mut msg = MSG::default();
        // İleti kuyruğu şimdi oluşsun ki kaldırma isteği (WM_QUIT) kaybolmasın.
        let _ = PeekMessageW(&mut msg, None, WM_USER, WM_USER, PM_NOREMOVE);
        let hook = match SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), None, 0) {
            Ok(h) => h,
            Err(e) => {
                let _ = tx.send(Err(e.to_string()));
                return;
            }
        };
        let _ = tx.send(Ok(GetCurrentThreadId()));
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        let _ = UnhookWindowsHookEx(hook);
    });
    match rx.recv() {
        Ok(Ok(id)) => {
            st.thread_id = Some(id);
            Ok(())
        }
        Ok(Err(e)) => Err(AppError::new("Klavye kancası kurulamadı.", Some(e))),
        Err(_) => Err(AppError::new("Klavye kancası kurulamadı.", None)),
    }
}

fn stop_hook(st: &mut HookState) {
    st.down.clear();
    if let Some(id) = st.thread_id.take() {
        let _ = unsafe { PostThreadMessageW(id, WM_QUIT, WPARAM(0), LPARAM(0)) };
    }
}

/// Birleşimi kancayla izlemeye başlar; tuşa basılınca `downkit-hotkey` olayı
/// eylem adıyla yayınlanır. Aynı eylem yeniden izlenirse birleşimi güncellenir.
#[tauri::command]
pub fn hotkey_watch(app: AppHandle, action: String, accelerator: String) -> Result<(), AppError> {
    let (mods, vk) =
        parse_combo(&accelerator).ok_or_else(|| AppError::new("Tanınmayan kısayol.", None))?;
    let mut st = state()
        .lock()
        .map_err(|_| AppError::new("Klavye kancasına ulaşılamadı.", None))?;
    start_hook(&mut st)?;
    st.app = Some(app);
    st.watched.insert(action, Combo { mods, vk });
    Ok(())
}

/// Tek eylemin izlemesini bırakır (normal kayıt devralınca çağrılır). İzlenen
/// birleşim kalmadıysa kanca kaldırılır.
#[tauri::command]
pub fn hotkey_unwatch(action: String) {
    if let Ok(mut st) = state().lock() {
        st.watched.remove(&action);
        if st.watched.is_empty() {
            stop_hook(&mut st);
        }
    }
}

/// Bütün izlemeleri bırakır ve kancayı kaldırır (kısayollar baştan kurulurken
/// ya da kısayol atanırken çağrılır).
#[tauri::command]
pub fn hotkey_unwatch_all() {
    if let Ok(mut st) = state().lock() {
        st.watched.clear();
        stop_hook(&mut st);
    }
}
