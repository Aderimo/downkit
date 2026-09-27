use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tokio::process::Command;
use tokio::sync::Mutex;

use crate::error::AppError;
use crate::{paths, tool_download};

const YTDLP_DOWNLOAD_URL: &str =
    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn download_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// yt-dlp.exe'nin yerel kopyasını döner; yoksa resmi GitHub release'inden indirir.
/// Küçük installer + her zaman güncel araç tercihi için bkz. proje planı.
pub async fn ensure_ytdlp(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    let exe = paths::bin_dir(app)?.join("yt-dlp.exe");
    if exe.exists() {
        return Ok(exe);
    }
    // Analiz ve indirme aynı anda istese de dosya bir kez indirilsin.
    let _guard = download_lock().lock().await;
    if !exe.exists() {
        download_ytdlp(&exe).await?;
    }
    Ok(exe)
}

/// Ayarlar'daki "Şimdi güncelle" ve açılıştaki otomatik kontrol için.
/// yt-dlp'nin kendi `-U` güncelleyicisi yeni sürüm yoksa hiçbir şey indirmez ve
/// indirdiğini imzayla doğrular. Bozuk bir kopya `-U` çalıştıramazsa baştan indirilir.
pub async fn update_ytdlp(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    let exe = ensure_ytdlp(app).await?;
    let _guard = download_lock().lock().await;

    let mut command = Command::new(&exe);
    command.arg("-U").creation_flags(CREATE_NO_WINDOW);
    match command.output().await {
        Ok(output) if output.status.success() => Ok(exe),
        _ => {
            download_ytdlp(&exe).await?;
            Ok(exe)
        }
    }
}

fn download_error(detail: String) -> AppError {
    AppError::coded(
        "toolDownloadFailed",
        "yt-dlp indirilemedi. İnternet bağlantınızı kontrol edin.",
        Some(detail),
    )
}

async fn download_ytdlp(exe: &Path) -> Result<(), AppError> {
    let bytes = tool_download::fetch("yt-dlp", YTDLP_DOWNLOAD_URL)
        .await
        .map_err(download_error)?;

    // Önce geçici dosyaya yazılıp sonra taşınır: indirme yarıda kesilirse bozuk
    // bir yt-dlp.exe "var" sanılıp her analizde hata vermesin.
    let tmp = exe.with_extension("exe.tmp");
    tokio::fs::write(&tmp, &bytes).await.map_err(|e| {
        AppError::coded(
            "toolDownloadFailed",
            "yt-dlp diske yazılamadı.",
            Some(e.to_string()),
        )
    })?;
    tokio::fs::rename(&tmp, exe).await.map_err(|e| {
        AppError::coded(
            "toolDownloadFailed",
            "yt-dlp diske yazılamadı.",
            Some(e.to_string()),
        )
    })?;
    Ok(())
}
