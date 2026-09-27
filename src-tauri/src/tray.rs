//! Sistem tepsisi simgesi (saatin yanındaki DownKit logosu).
//!
//! Bu simgenin pencere gizliyken bile çalışması şart; o yüzden WebView
//! (arayüz) tarafında değil, doğrudan Rust'ta kurulur. Arayüz askıya alınsa,
//! hata verse ya da henüz yüklenmemiş olsa bile "Göster" ve "Çıkış" her zaman
//! işler. Kayıt gibi arayüzdeki duruma bağlı eylemler arayüze olay olarak
//! iletilir; arayüz dinlemiyorsa o eylem sessizce düşer.

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime,
};

use crate::error::AppError;
use crate::prefs;

const TRAY_ID: &str = "downkit";

struct Labels<'a> {
    show: &'a str,
    snip: &'a str,
    record: &'a str,
    replay: &'a str,
    quit: &'a str,
}

const TR: Labels<'static> = Labels {
    show: "DownKit'i göster",
    snip: "Ekran görüntüsü al",
    record: "Kaydı başlat / durdur",
    replay: "Anlık tekrarı kaydet",
    quit: "Çıkış",
};

const EN: Labels<'static> = Labels {
    show: "Show DownKit",
    snip: "Take screenshot",
    record: "Start / stop recording",
    replay: "Save instant replay",
    quit: "Quit",
};

/// Açılışta arayüz henüz yok; dili kalıcı ayarlardan okur. Arayüz açıldıktan
/// sonra dil değişirse `tray_set_labels` ile menü yeniden kurulur.
fn current_labels(app: &AppHandle) -> Labels<'static> {
    match prefs::read_value(app, "downkit.language").as_deref() {
        Some(lang) if lang.starts_with("tr") => TR,
        _ => EN,
    }
}

fn build_menu<R: Runtime>(app: &AppHandle<R>, labels: &Labels) -> tauri::Result<Menu<R>> {
    let show = MenuItem::with_id(app, "show", labels.show, true, None::<&str>)?;
    let snip = MenuItem::with_id(app, "snip", labels.snip, true, None::<&str>)?;
    let record = MenuItem::with_id(app, "record", labels.record, true, None::<&str>)?;
    let replay = MenuItem::with_id(app, "save_replay", labels.replay, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", labels.quit, true, None::<&str>)?;
    Menu::with_items(app, &[&show, &snip, &record, &replay, &quit])
}

fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Çıkıştan önce arayüze bekleyen ayar yazımını bitirmesi için kısa bir süre
/// tanınır; arayüz cevap vermezse (gizli ya da donuksa) süre dolunca yine de
/// çıkılır. Böylece "Çıkış"a basınca program her hâlükârda kapanır.
fn request_quit<R: Runtime>(app: &AppHandle<R>) {
    let _ = app.emit("tray-quit-requested", ());
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1200));
        handle.exit(0);
    });
}

/// Arayüz ayarları diske yazdıktan sonra bunu çağırır; çıkışı bekletmez.
/// (Süre aşımı sayacı da ayrıca çıkışı tetikler; iki çağrı zararsızdır.)
#[tauri::command]
pub fn force_quit(app: AppHandle) {
    app.exit(0);
}

/// Arayüzde dil değişince menü başlıkları yeni dilde yeniden kurulur.
#[tauri::command]
pub fn tray_set_labels(
    app: AppHandle,
    show: String,
    snip: String,
    record: String,
    replay: String,
    quit: String,
) -> Result<(), AppError> {
    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| AppError::new("Tepsi simgesi bulunamadı.", None))?;
    let labels = Labels {
        show: &show,
        snip: &snip,
        record: &record,
        replay: &replay,
        quit: &quit,
    };
    build_menu(&app, &labels)
        .and_then(|menu| tray.set_menu(Some(menu)))
        .map_err(|e| AppError::new("Tepsi menüsü kurulamadı.", Some(e.to_string())))
}

/// Tepsi simgesini kurar. Sol tık pencereyi geri getirir; sağ tık menüyü açar.
/// Kurulum başarısız olursa program tepsisiz çalışmaya devam eder (pencere
/// kapatılınca normal şekilde çıkar).
pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app, &current_labels(app))?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("DownKit")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main(app),
            "snip" => {
                let _ = app.emit("tray-action", "snip");
            }
            "record" => {
                let _ = app.emit("tray-action", "toggle-record");
            }
            "save_replay" => {
                let _ = app.emit("tray-action", "save-replay");
            }
            "quit" => request_quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}
