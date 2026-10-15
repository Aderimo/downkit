//! Hareketli başlık komutları: şablon listesi, önizleme karesi ve saydam video.

use std::io::Write;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use sha2::{Digest, Sha256};
use tauri::Manager;

use crate::error::AppError;
use crate::ffmpeg::binary::ensure_ffmpeg;
use crate::motion::{self, MotionSpec, MotionTemplate, FPS};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// Önizleme karesinin en büyük genişliği.
const PREVIEW_WIDTH: f64 = 480.0;

fn failed(detail: impl ToString) -> AppError {
    AppError::new("Hareketli başlık oluşturulamadı.", Some(detail.to_string()))
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, AppError> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(failed)?
        .map_err(failed)
}

#[tauri::command]
pub async fn motion_templates() -> Result<Vec<MotionTemplate>, AppError> {
    blocking(|| Ok(motion::templates())).await
}

/// İstenen andaki küçük önizleme karesi (PNG veri adresi).
#[tauri::command]
pub async fn motion_preview(spec: MotionSpec, time: f64) -> Result<String, AppError> {
    blocking(move || {
        use base64::Engine;
        use image::ImageEncoder as _;
        let built = motion::build(&spec)?;
        let (w, _) = built.size();
        let scale = (PREVIEW_WIDTH / w.max(1) as f64).min(1.0);
        let (rgba, w, h) = built.frame(time, scale);
        let mut png = Vec::new();
        image::codecs::png::PngEncoder::new(&mut png)
            .write_image(&rgba, w, h, image::ExtendedColorType::Rgba8)
            .map_err(|e| e.to_string())?;
        Ok(format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(png)
        ))
    })
    .await
}

/// Çizilen videonun en uzun kenarı ve en uzun süresi.
const MAX_SIDE: f64 = 1920.0;
const MAX_SECONDS: f64 = 60.0;

/// Çizilen video: yolu, boyutu ve süresi (katmanın boyu ve uzunluğu buna göre).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rendered {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub duration: f64,
}

/// Aynı seçim aynı dosyaya düşer: yeniden çizilmez. Lottie dosyası değişirse
/// (boyut ya da tarih) yeni ad alır.
fn output_name(spec: &MotionSpec) -> String {
    let json = serde_json::to_string(spec).unwrap_or_default();
    let stamp = if spec.template == motion::LOTTIE {
        spec.values
            .first()
            .and_then(|p| std::fs::metadata(p).ok())
            .map(|m| format!("{}|{:?}", m.len(), m.modified().ok()))
            .unwrap_or_default()
    } else {
        String::new()
    };
    let digest = Sha256::digest(format!("v1|{json}|{stamp}").as_bytes());
    let hex: String = digest.iter().take(8).map(|b| format!("{b:02x}")).collect();
    format!("{}-{hex}.webm", spec.template)
}

/// Kareleri FFmpeg'e verir: saydam VP9 (WebM). Önizleme (WebView) de dışa aktarma da
/// aynı dosyayı kullanır.
fn render_to(ffmpeg: &Path, built: &motion::Built, out: &Path) -> Result<(), String> {
    let (w, h) = built.size();
    let scale = (MAX_SIDE / w.max(h).max(1) as f64).min(1.0);
    let duration = built.duration().min(MAX_SECONDS);
    let frames = (duration * FPS as f64).round().max(1.0) as u32;
    // Ölçekli karenin gerçek boyutu ilk kareden alınır.
    let (first, w, h) = built.frame(0.0, scale);
    let tmp = out.with_extension("webm.part");
    let mut child = Command::new(ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo"])
        .args(["-pix_fmt", "rgba", "-s", &format!("{w}x{h}")])
        .args(["-r", &FPS.to_string(), "-i", "-"])
        .args(["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0"])
        .args([
            "-crf",
            "30",
            "-deadline",
            "good",
            "-cpu-used",
            "4",
            "-row-mt",
            "1",
        ])
        .args(["-auto-alt-ref", "0", "-f", "webm"])
        .arg(&tmp)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| e.to_string())?;
    let written = (|| -> Result<(), String> {
        let stdin = child.stdin.as_mut().ok_or("ffmpeg girişi yok")?;
        stdin.write_all(&first).map_err(|e| e.to_string())?;
        for i in 1..frames {
            let (rgba, _, _) = built.frame(i as f64 / FPS as f64, scale);
            stdin.write_all(&rgba).map_err(|e| e.to_string())?;
        }
        Ok(())
    })();
    drop(child.stdin.take());
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if written.is_err() || !output.status.success() {
        let _ = std::fs::remove_file(&tmp);
        let log = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(written.err().unwrap_or(log));
    }
    std::fs::rename(&tmp, out).map_err(|e| e.to_string())
}

/// Saydam videoyu çizer (önceden çizildiyse yeniden çizmez).
#[tauri::command]
pub async fn motion_render(app: tauri::AppHandle, spec: MotionSpec) -> Result<Rendered, AppError> {
    if !motion::is_known(&spec.template) {
        return Err(failed(format!("bilinmeyen şablon: {}", spec.template)));
    }
    let dir: PathBuf = app.path().app_data_dir().map_err(failed)?.join("motion");
    std::fs::create_dir_all(&dir).map_err(failed)?;
    let out = dir.join(output_name(&spec));
    let ffmpeg = ensure_ffmpeg(&app).await?.join("ffmpeg.exe");
    blocking(move || {
        let built = motion::build(&spec)?;
        if !out.is_file() {
            render_to(&ffmpeg, &built, &out)?;
        }
        let (width, height) = built.size();
        Ok(Rendered {
            path: out.to_string_lossy().into_owned(),
            width,
            height,
            duration: built.duration().min(MAX_SECONDS),
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(values: &[&str]) -> MotionSpec {
        MotionSpec {
            template: "kinetic-type".into(),
            values: values.iter().map(|v| v.to_string()).collect(),
            background: false,
        }
    }

    #[test]
    fn ayni_secim_ayni_dosya_adi_farkli_secim_farkli() {
        assert_eq!(output_name(&spec(&["A"])), output_name(&spec(&["A"])));
        assert_ne!(output_name(&spec(&["A"])), output_name(&spec(&["B"])));
        assert!(output_name(&spec(&[])).starts_with("kinetic-type-"));
        assert!(output_name(&spec(&[])).ends_with(".webm"));
    }

    /// FFmpeg kuruluysa: cargo test --lib saydam_webm -- --ignored
    #[test]
    #[ignore]
    fn saydam_webm_cizilir() {
        let appdata = std::env::var("APPDATA").unwrap();
        // Yeni kurulumun araçları; yoksa ClipKit döneminin klasörü.
        let bin = ["com.aderimo.downkit", "com.aderimo.clipkit"]
            .iter()
            .map(|id| format!("{appdata}\\{id}\\bin\\"))
            .find(|dir| Path::new(&format!("{dir}ffmpeg.exe")).is_file())
            .expect("FFmpeg kurulu değil");
        let out = std::env::temp_dir().join("downkit-motion-test.webm");
        let _ = std::fs::remove_file(&out);
        let built = motion::build(&spec(&["BİR", "İKİ", "ÜÇ"])).unwrap();
        render_to(Path::new(&(bin.clone() + "ffmpeg.exe")), &built, &out).unwrap();
        let probe = Command::new(bin + "ffprobe.exe")
            .args([
                "-v",
                "error",
                "-show_entries",
                "stream=width,height:stream_tags=alpha_mode",
            ])
            .args(["-show_entries", "format=duration", "-of", "default=nw=1"])
            .arg(&out)
            .output()
            .unwrap();
        let text = String::from_utf8_lossy(&probe.stdout);
        assert!(
            text.contains("width=1920") && text.contains("alpha_mode=1"),
            "{text}"
        );
        assert!(text.contains("duration=4.0"), "{text}");
    }
}
