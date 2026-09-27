//! Hata günlüğü: %LOCALAPPDATA%\com.downkit.app\logs\downkit.log. Arayüz iş
//! hatalarını ve beklenmeyen hataları yazar; Rust paniği de buraya düşer.
//! "Hatayı bildir" raporu son satırları ekler (yollardaki kullanıcı adı gizlenerek).
//! Dosya 1 MB'ı geçince bir öncekinin üzerine `downkit.old.log` olur.

use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

use crate::error::AppError;

const MAX_BYTES: u64 = 1_000_000;
const MAX_LINE: usize = 4000;
static WRITE: Mutex<()> = Mutex::new(());

fn log_dir(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_log_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

/// Satırları dosyanın sonuna ekler; hata olursa sessizce vazgeçer (günlük asla
/// asıl işi bozmamalı).
pub fn append(app: &AppHandle, lines: &[String]) {
    let Some(dir) = log_dir(app) else {
        return;
    };
    let _guard = WRITE.lock();
    let path = dir.join("downkit.log");
    if std::fs::metadata(&path).is_ok_and(|m| m.len() > MAX_BYTES) {
        let _ = std::fs::rename(&path, dir.join("downkit.old.log"));
    }
    let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    else {
        return;
    };
    for line in lines {
        let line: String = line.chars().take(MAX_LINE).collect();
        let _ = writeln!(file, "{line}");
    }
}

/// Program çökerse (Rust paniği) nedeni günlüğe yazılır.
pub fn install_panic_hook(app: AppHandle) {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let seconds = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        append(&app, &[format!("unix:{seconds} [panic] {info}")]);
        previous(info);
    }));
}

#[tauri::command]
pub fn log_write(app: AppHandle, lines: Vec<String>) {
    append(&app, &lines);
}

/// Son `max_lines` satır (eskiden yeniye).
#[tauri::command]
pub fn log_tail(app: AppHandle, max_lines: usize) -> String {
    let Some(dir) = log_dir(&app) else {
        return String::new();
    };
    let text = std::fs::read_to_string(dir.join("downkit.log")).unwrap_or_default();
    tail_lines(&text, max_lines.clamp(1, 500))
}

fn tail_lines(text: &str, count: usize) -> String {
    let lines: Vec<&str> = text.lines().collect();
    lines[lines.len().saturating_sub(count)..].join("\n")
}

#[tauri::command]
pub fn open_log_dir(app: AppHandle) -> Result<(), AppError> {
    let dir = log_dir(&app).ok_or_else(|| AppError::new("Günlük klasörü bulunamadı.", None))?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| AppError::new("Klasör açılamadı.", Some(e.to_string())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn son_satirlar_sirasiyla_doner() {
        assert_eq!(tail_lines("a\nb\nc\n", 2), "b\nc");
        assert_eq!(tail_lines("a", 5), "a");
        assert_eq!(tail_lines("", 3), "");
    }
}
