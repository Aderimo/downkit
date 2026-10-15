//! DownKit — © 2026 aderimo. Ücretsiz ve açık kaynak (MIT): https://github.com/Aderimo/downkit
//! "DownKit" adı ve ördek logosu TRADEMARKS.md'deki koşullara tabidir.

mod applog;
mod autostart;
mod commands;
mod error;
mod events;
mod ffmpeg;
mod hotkey_hook;
mod hotkeys;
mod hud;
mod jobs;
mod migrate;
mod motion;
mod paths;
mod platform;
mod prefs;
mod preview;
mod process_guard;
mod recorder;
mod snip;
mod state;
mod template;
mod theme_bg;
mod tool_download;
mod tray;
mod types;
mod ytdlp;

use state::AppState;
use tauri::Manager;

/// Yapımcı imzası. Derlenen exe'nin içinde düz metin olarak durur (her kopyada
/// dosya içinde aranarak bulunur) ve Ayarlar → Hakkında'da gösterilir. Kodu
/// kopyalayan biri MIT gereği bu telif bildirimini korumak zorundadır.
pub const AUTHOR_SIGNATURE: &str = concat!(
    "DownKit v",
    env!("CARGO_PKG_VERSION"),
    " | original author: aderimo | (c) 2026 aderimo | MIT | https://github.com/Aderimo/downkit"
);

/// Hakkında bölümündeki imza satırı (sabit exe'de kalsın diye arayüz buradan okur).
#[tauri::command]
fn app_signature() -> &'static str {
    AUTHOR_SIGNATURE
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // İlk eklenmeli: program zaten açıkken tekrar çalıştırılırsa (ör. masaüstü
        // kısayolu) ikinci kopya açılmaz, mevcut pencere (tepside gizli olsa bile) öne gelir.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        // Kayıt/anlık tekrar kısayolları (oyun oynarken de çalışsın diye sistem geneli).
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState::default())
        .manage(recorder::RecorderState::default())
        .setup(|app| {
            applog::install_panic_hook(app.handle().clone());
            // Önceki kurulumların (ClipKit, DownKit 0.3) ayarları ve araçları (bir kez) alınır.
            migrate::from_previous(app.handle());
            autostart::migrate_old_value();
            tool_download::init(app.handle());
            // Tepsi simgesi Rust'ta kurulur: arayüz hata verse bile tepsiden
            // pencereyi geri açmak ve programı tamamen kapatmak her zaman çalışır.
            if let Err(e) = tray::init(app.handle()) {
                eprintln!("Tepsi simgesi kurulamadı: {e}");
            }
            // Pencere gizli kurulur (tauri.conf: visible=false); Windows açılışında
            // otomatik başlatıldıysa tepside kalır, yoksa hemen gösterilir.
            if !autostart::launched_by_autostart() {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::analyze::analyze_url,
            commands::analyze::analyze_playlist,
            commands::download::start_download,
            commands::download::cancel_download,
            commands::download::discard_partial_download,
            commands::convert::probe_local_file,
            commands::convert::start_convert,
            commands::convert::cancel_convert,
            commands::compress::start_compress,
            commands::compress::cancel_compress,
            commands::resize::start_resize,
            commands::resize::cancel_resize,
            commands::settings::update_ytdlp,
            commands::edit::start_edit,
            commands::edit::cancel_edit,
            commands::edit::discard_edit_work,
            commands::editor::open_local_preview,
            commands::editor::editor_thumbnails,
            commands::editor::editor_waveform,
            commands::editor::create_preview_copy,
            commands::editor::editor_save_frame,
            commands::settings::get_tool_versions,
            commands::settings::open_app_data_dir,
            commands::settings::prepare_tools,
            commands::settings::cache_usage,
            commands::settings::cache_clear,
            commands::files::open_media_file,
            commands::files::copy_file_to_clipboard,
            commands::share::discord_send,
            commands::captions::captions_transcribe,
            commands::captions::captions_cancel,
            commands::captions::captions_ready,
            commands::files::open_folder,
            commands::files::image_preview,
            commands::motion::motion_templates,
            commands::motion::motion_preview,
            commands::motion::motion_render,
            recorder::recorder_sources,
            recorder::recorder_fullscreen_app,
            recorder::recorder_app_running,
            recorder::recorder_source_thumbs,
            recorder::recorder_prepare,
            recorder::gpu::recorder_gpus,
            recorder::recorder_start,
            recorder::recorder_stop,
            recorder::replay_start,
            recorder::replay_stop,
            recorder::replay_save,
            recorder::recorder_status,
            recorder::recordings_list,
            recorder::recording_thumbnail,
            recorder::recording_delete,
            recorder::recording_rename,
            recorder::recording_repair,
            recorder::recording_trim,
            recorder::recorder_default_dir,
            hotkeys::hotkey_probe,
            hotkey_hook::hotkey_watch,
            hotkey_hook::hotkey_unwatch,
            hotkey_hook::hotkey_unwatch_all,
            snip::snip_start,
            snip::snip_state,
            snip::snip_show,
            snip::snip_finish,
            snip::snip_open_file,
            snip::snip_default_dir,
            snip::snip_copy,
            snip::snip_save,
            snip::snip_list,
            snip::snip_thumbnail,
            snip::snip_delete,
            snip::image_write,
            snip::image_copy,
            snip::ocr::ocr_image,
            snip::translate::translate_text,
            autostart::autostart_get,
            autostart::autostart_set,
            theme_bg::theme_bg_save,
            theme_bg::theme_bg_load,
            theme_bg::theme_bg_clear,
            tray::force_quit,
            tray::tray_set_labels,
            commands::textfile::text_file_read,
            commands::textfile::text_file_write,
            commands::emoji::emoji_image_write,
            commands::silence::editor_silences,
            commands::audio_tools::audio_fx_preview,
            commands::audio_tools::audio_beats,
            commands::audio_file::audio_file_write,
            commands::face::editor_face_track,
            commands::edit::editor_cover,
            commands::project::project_save,
            commands::project::project_read,
            commands::project::autosave_write,
            commands::project::autosave_read,
            commands::project::autosave_clear,
            commands::project::paths_exist,
            prefs::prefs_load,
            prefs::prefs_save,
            app_signature,
            applog::log_write,
            applog::log_tail,
            applog::open_log_dir,
            hud::hud_show,
            hud::hud_current,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            // Ana pencere kapandıysa program biter. Gizli köşe bilgisi penceresi
            // ("hud") açık kalsa Tauri çıkmazdı: süreç, tepsi simgesi ve tek örnek
            // kilidi yaşar, gösterilecek pencere de kalmazdı (programı yeniden
            // açmak ya da tepsiye tıklamak hiçbir şey yapmazdı).
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::Destroyed,
                ..
            } if label == "main" => app.exit(0),
            tauri::RunEvent::Exit => {
                // Kayıt sürüyorsa dosya düzgün kapatılıp MP4'e aktarılır.
                tauri::async_runtime::block_on(recorder::shutdown(app));
            }
            _ => {}
        });
}
