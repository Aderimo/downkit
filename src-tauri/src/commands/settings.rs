use std::path::Path;

use serde::Serialize;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;
use tokio::process::Command;

use crate::error::AppError;
use crate::{paths, ytdlp};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

async fn first_line(exe: &Path, arg: &str) -> Option<String> {
    let mut command = Command::new(exe);
    command.arg(arg).creation_flags(CREATE_NO_WINDOW);
    let output = command.output().await.ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout.lines().next().map(|l| l.trim().to_string())
}

async fn read_ytdlp_version(ytdlp_path: &Path) -> Result<String, AppError> {
    first_line(ytdlp_path, "--version")
        .await
        .ok_or_else(|| AppError::coded("toolStartFailed", "yt-dlp çalıştırılamadı.", None))
}

#[tauri::command]
pub async fn update_ytdlp(app: tauri::AppHandle) -> Result<String, AppError> {
    let path = ytdlp::binary::update_ytdlp(&app).await?;
    read_ytdlp_version(&path).await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolVersions {
    pub ytdlp: Option<String>,
    pub ffmpeg: Option<String>,
    pub deno: Option<String>,
}

/// "ffmpeg version N-120000-gabc Copyright…" → "N-120000-gabc"
fn parse_ffmpeg_version(line: &str) -> Option<String> {
    line.strip_prefix("ffmpeg version ")?
        .split_whitespace()
        .next()
        .map(str::to_string)
}

/// "deno 2.9.7 (stable, release, …)" → "2.9.7"
fn parse_deno_version(line: &str) -> Option<String> {
    line.strip_prefix("deno ")?
        .split_whitespace()
        .next()
        .map(str::to_string)
}

/// Ayarlar'daki "Araçlar" bölümü için. Kurulu olmayan aracı indirmez, `None` döner
/// (araçlar ilk ihtiyaç anında kendiliğinden indiriliyor).
#[tauri::command]
pub async fn get_tool_versions(app: tauri::AppHandle) -> Result<ToolVersions, AppError> {
    let bin = paths::bin_dir(&app)?;
    let ytdlp_exe = bin.join("yt-dlp.exe");
    let ffmpeg_exe = bin.join("ffmpeg.exe");
    let deno_exe = bin.join("deno.exe");

    let ytdlp = match ytdlp_exe.exists() {
        true => first_line(&ytdlp_exe, "--version").await,
        false => None,
    };
    let ffmpeg = match ffmpeg_exe.exists() {
        true => first_line(&ffmpeg_exe, "-version")
            .await
            .and_then(|l| parse_ffmpeg_version(&l)),
        false => None,
    };
    let deno = match deno_exe.exists() {
        true => first_line(&deno_exe, "--version")
            .await
            .and_then(|l| parse_deno_version(&l)),
        false => None,
    };
    Ok(ToolVersions {
        ytdlp,
        ffmpeg,
        deno,
    })
}

/// Hata bildirirken istenebilecek araç/veri klasörünü Gezgin'de açar.
#[tauri::command]
pub async fn open_app_data_dir(app: tauri::AppHandle) -> Result<(), AppError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::new("Uygulama veri klasörü bulunamadı.", Some(e.to_string())))?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| AppError::new("Klasör açılamadı.", Some(e.to_string())))
}

/// İlk açılışta FFmpeg arka planda hazırlanır: ilk kayıt ya da dışa aktarım
/// indirmeyi beklemesin. Zaten varsa hiçbir şey indirmez.
#[tauri::command]
pub async fn prepare_tools(app: tauri::AppHandle) -> Result<(), AppError> {
    crate::ffmpeg::binary::ensure_ffmpeg(&app).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ffmpeg_surumu_ilk_satirdan_okunur() {
        let line = "ffmpeg version N-120000-g1a2b3c4d-20260901 Copyright (c) 2000-2026 the FFmpeg developers";
        assert_eq!(
            parse_ffmpeg_version(line).as_deref(),
            Some("N-120000-g1a2b3c4d-20260901")
        );
    }

    #[test]
    fn beklenmeyen_cikti_none_doner() {
        assert_eq!(parse_ffmpeg_version("bash: ffmpeg: not found"), None);
    }
}

fn dir_size(path: &std::path::Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| match entry.file_type() {
            Ok(t) if t.is_dir() => dir_size(&entry.path()),
            Ok(_) => entry.metadata().map(|m| m.len()).unwrap_or(0),
            Err(_) => 0,
        })
        .sum()
}

/// Temizlenebilen önbellek alt klasörleri. Windows'ta önbellek kökü tarayıcı
/// verisiyle (EBWebView: ayarlar) aynı klasör olduğu için kökün tamamı silinmez;
/// süren anlık tekrarın parçaları (`replay`) da hiç dokunulmaz.
const CLEARABLE: [&str; 5] = [
    "edit",
    "edit-text",
    "preview",
    "recording-thumbs",
    "snip-thumbs",
];

fn cache_dirs(app: &tauri::AppHandle) -> Result<Vec<std::path::PathBuf>, AppError> {
    let root = app
        .path()
        .app_cache_dir()
        .map_err(|e| AppError::new("Önbellek klasörü bulunamadı.", Some(e.to_string())))?;
    Ok(CLEARABLE.iter().map(|name| root.join(name)).collect())
}

/// Önbelleğin (önizleme kopyaları, küçük resimler, yarım dışa aktarımlar) boyutu.
#[tauri::command]
pub async fn cache_usage(app: tauri::AppHandle) -> Result<u64, AppError> {
    let dirs = cache_dirs(&app)?;
    Ok(
        tauri::async_runtime::spawn_blocking(move || dirs.iter().map(|d| dir_size(d)).sum())
            .await
            .unwrap_or(0),
    )
}

/// Önbelleği boşaltır. Kayıtlar, ekran görüntüleri ve ayarlar etkilenmez.
/// Kullanımda olan dosyalar (süren bir işin) atlanır.
#[tauri::command]
pub async fn cache_clear(app: tauri::AppHandle) -> Result<u64, AppError> {
    let dirs = cache_dirs(&app)?;
    Ok(tauri::async_runtime::spawn_blocking(move || {
        let before: u64 = dirs.iter().map(|d| dir_size(d)).sum();
        for dir in &dirs {
            let Ok(entries) = std::fs::read_dir(dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                let _ = if path.is_dir() {
                    std::fs::remove_dir_all(&path)
                } else {
                    std::fs::remove_file(&path)
                };
            }
        }
        before.saturating_sub(dirs.iter().map(|d| dir_size(d)).sum())
    })
    .await
    .unwrap_or(0))
}
