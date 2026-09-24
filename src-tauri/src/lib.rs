mod commands;
mod error;
mod events;
mod ffmpeg;
mod jobs;
mod paths;
mod platform;
mod process_guard;
mod state;
mod template;
mod types;
mod ytdlp;

use state::AppState;
use tauri::Manager;

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
        .manage(AppState::default())
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
            commands::trim::start_trim,
            commands::trim::cancel_trim,
            commands::settings::get_ytdlp_version,
            commands::settings::update_ytdlp,
            commands::settings::get_tool_versions,
            commands::settings::open_app_data_dir,
            commands::files::open_media_file,
            commands::files::open_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
