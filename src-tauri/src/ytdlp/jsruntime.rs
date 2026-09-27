use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use sha2::{Digest, Sha256};
use tokio::sync::Mutex;

use crate::error::AppError;
use crate::paths;

// yt-dlp, YouTube'daki JavaScript doğrulamalarını çözmek için harici bir JS
// çalışma ortamı istiyor (varsayılanı Deno). Yoksa "bazı formatlar eksik
// olabilir" uyarısı veriyor ve YouTube ileride tamamen bozulabilir. Deno da
// yt-dlp ve FFmpeg gibi ilk ihtiyaç anında resmi GitHub sürümünden indirilir.
const DENO_ZIP_URL: &str =
    "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip";

fn download_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

pub fn deno_exe(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    Ok(paths::bin_dir(app)?.join("deno.exe"))
}

pub async fn ensure_deno(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    let exe = deno_exe(app)?;
    if exe.exists() {
        return Ok(exe);
    }
    // Analiz ve indirme aynı anda istese de dosya bir kez indirilsin.
    let _guard = download_lock().lock().await;
    if !exe.exists() {
        download_deno(&exe).await?;
    }
    Ok(exe)
}

/// yt-dlp'ye eklenecek JS çalışma ortamı argümanları. Deno yalnızca YouTube için
/// gerekiyor; indirilemezse boş döner — YouTube yine çoğunlukla çalışır, yalnızca
/// bazı formatlar eksik kalabilir. Bu yüzden indirme hatası işi durdurmaz.
pub async fn ytdlp_args(app: &tauri::AppHandle, platform: &str) -> Vec<String> {
    if platform != "youtube" {
        return Vec::new();
    }
    match ensure_deno(app).await {
        Ok(exe) => vec!["--js-runtimes".into(), format!("deno:{}", exe.display())],
        Err(_) => Vec::new(),
    }
}

fn download_error(detail: String) -> AppError {
    AppError::coded(
        "toolDownloadFailed",
        "Deno indirilemedi. İnternet bağlantınızı kontrol edin.",
        Some(detail),
    )
}

async fn fetch(url: &str) -> Result<Vec<u8>, AppError> {
    let response = reqwest::get(url)
        .await
        .map_err(|e| download_error(e.to_string()))?;
    if !response.status().is_success() {
        return Err(download_error(format!(
            "HTTP {} — {url}",
            response.status()
        )));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| download_error(e.to_string()))?;
    Ok(bytes.to_vec())
}

async fn download_deno(exe: &Path) -> Result<(), AppError> {
    let sums = fetch(&format!("{DENO_ZIP_URL}.sha256sum")).await?;
    let expected = parse_sha256(&String::from_utf8_lossy(&sums))
        .ok_or_else(|| download_error("sha256 özeti okunamadı".into()))?;

    let zip_bytes = crate::tool_download::fetch("deno", DENO_ZIP_URL)
        .await
        .map_err(download_error)?;
    let actual = sha256_hex(&zip_bytes);
    if actual != expected {
        return Err(download_error(format!(
            "sha256 uyuşmadı: beklenen {expected}, gelen {actual}"
        )));
    }

    let exe = exe.to_path_buf();
    tokio::task::spawn_blocking(move || extract_deno(&zip_bytes, &exe))
        .await
        .map_err(|e| download_error(e.to_string()))?
}

fn extract_deno(zip_bytes: &[u8], exe: &Path) -> Result<(), AppError> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(zip_bytes))
        .map_err(|e| download_error(e.to_string()))?;
    let mut entry = archive
        .by_name("deno.exe")
        .map_err(|e| download_error(e.to_string()))?;
    let mut data = Vec::new();
    entry
        .read_to_end(&mut data)
        .map_err(|e| download_error(e.to_string()))?;

    // Önce geçici dosyaya yazılıp sonra taşınır: indirme yarıda kesilirse bozuk
    // bir deno.exe "var" sanılıp hep kullanılmaya çalışılmasın.
    let tmp = exe.with_extension("exe.tmp");
    std::fs::write(&tmp, &data).map_err(|e| download_error(e.to_string()))?;
    std::fs::rename(&tmp, exe).map_err(|e| download_error(e.to_string()))?;
    Ok(())
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Deno'nun Windows özet dosyası PowerShell biçiminde ("Hash : ABCD…"),
/// Linux'unkiler "abcd…  dosya" biçiminde; ikisinde de 64 haneli onaltılık
/// tek bir değer vardır.
pub fn parse_sha256(text: &str) -> Option<String> {
    text.split(|c: char| !c.is_ascii_hexdigit())
        .find(|token| token.len() == 64)
        .map(str::to_lowercase)
}

#[cfg(test)]
mod tests {
    use super::*;

    const HASH: &str = "a0c3101b4158d1dfb7d6a78a7bf0f3de80c96bb423c152beec8beb22786f2238";

    #[test]
    fn powershell_bicimindeki_ozet_okunur() {
        let text = "Algorithm : SHA256\r\nHash      : A0C3101B4158D1DFB7D6A78A7BF0F3DE80C96BB423C152BEEC8BEB22786F2238\r\nPath      : C:\\a\\deno\\deno-x86_64-pc-windows-msvc.zip\r\n";
        assert_eq!(parse_sha256(text).as_deref(), Some(HASH));
    }

    #[test]
    fn linux_bicimindeki_ozet_okunur() {
        let text = format!("{HASH}  deno-x86_64-unknown-linux-gnu.zip\n");
        assert_eq!(parse_sha256(&text).as_deref(), Some(HASH));
    }

    #[test]
    fn ozet_yoksa_none_doner() {
        assert_eq!(parse_sha256("Not Found"), None);
    }

    #[test]
    fn sha256_bilinen_degeri_uretir() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    /// Gerçek indirme — ağ gerektirir, varsayılan olarak çalışmaz:
    /// `cargo test deno_indirilir_ve_dogrulanir -- --ignored`
    /// `DOWNKIT_DENO_DIR` verilirse deno.exe oraya bırakılır (ör. uygulamanın bin klasörü).
    #[tokio::test]
    #[ignore]
    async fn deno_indirilir_ve_dogrulanir() {
        let keep_dir = std::env::var_os("DOWNKIT_DENO_DIR").map(PathBuf::from);
        let dir = keep_dir.clone().unwrap_or_else(|| {
            std::env::temp_dir().join(format!("downkit-deno-{}", uuid::Uuid::new_v4()))
        });
        std::fs::create_dir_all(&dir).unwrap();
        let exe = dir.join("deno.exe");
        download_deno(&exe).await.expect("indirme başarısız");
        let output = std::process::Command::new(&exe)
            .arg("--version")
            .output()
            .unwrap();
        assert!(String::from_utf8_lossy(&output.stdout).starts_with("deno "));
        if keep_dir.is_none() {
            std::fs::remove_dir_all(&dir).unwrap();
        }
    }
}
