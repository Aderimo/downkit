use std::process::Stdio;

use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, BufReader};
use tokio::process::Command;
use uuid::Uuid;

use crate::error::AppError;
use crate::events::{
    FfmpegProgressPayload, JobCanceledPayload, JobCompletePayload, JobErrorPayload,
};
use crate::state::{AppState, JobEntry};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const STDERR_TAIL_BYTES: usize = 4000;

pub fn hide_console(command: &mut Command) {
    command.creation_flags(CREATE_NO_WINDOW);
}

pub fn register(app: &AppHandle, job_id: &str, pid: u32) {
    crate::process_guard::attach(pid);
    app.state::<AppState>().jobs.lock().unwrap().insert(
        job_id.to_string(),
        JobEntry {
            pid,
            canceled: false,
            discard_partial: false,
        },
    );
}

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Finished {
    pub canceled: bool,
    pub discard_partial: bool,
}

/// İş kaydını siler ve iptal edilip edilmediğini döner.
pub fn finish(app: &AppHandle, job_id: &str) -> Finished {
    app.state::<AppState>()
        .jobs
        .lock()
        .unwrap()
        .remove(job_id)
        .map(|entry| Finished {
            canceled: entry.canceled,
            discard_partial: entry.discard_partial,
        })
        .unwrap_or_default()
}

/// İşi iptal edildi olarak işaretleyip süreç ağacını öldürür. Terminal olayı
/// burada değil, iş koşucusu süreç bittiğinde yayınlar — böylece her iş için
/// tam olarak bir terminal olay çıkar.
///
/// `discard_partial`: duraklatmada false (yarım dosya devam için kalır),
/// iptalde true (koşucu yarım dosyaları siler).
pub async fn cancel(app: &AppHandle, job_id: &str, discard_partial: bool) {
    let pid = {
        let state = app.state::<AppState>();
        let mut jobs = state.jobs.lock().unwrap();
        jobs.get_mut(job_id).map(|entry| {
            entry.canceled = true;
            entry.discard_partial = discard_partial;
            entry.pid
        })
    };

    if let Some(pid) = pid {
        let mut command = Command::new("taskkill");
        command.args(["/F", "/T", "/PID", &pid.to_string()]);
        hide_console(&mut command);
        let _ = command.output().await;
    }
}

/// Bir satırı UTF-8 olmasa bile güvenle okur (geçersiz baytlar U+FFFD olur).
/// `lines()` geçersiz UTF-8'de hata döndürüp okuma döngüsünü kırıyordu.
/// EOF ya da okuma hatasında `None`.
pub async fn read_line_lossy<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    buf: &mut Vec<u8>,
) -> Option<String> {
    buf.clear();
    match reader.read_until(b'\n', buf).await {
        Ok(0) | Err(_) => None,
        Ok(_) => Some(
            String::from_utf8_lossy(buf)
                .trim_end_matches(['\r', '\n'])
                .to_string(),
        ),
    }
}

pub fn push_tail(tail: &mut String, line: &str) {
    tail.push_str(line);
    tail.push('\n');
    if tail.len() > STDERR_TAIL_BYTES {
        let mut cut = tail.len() - STDERR_TAIL_BYTES;
        while !tail.is_char_boundary(cut) {
            cut += 1;
        }
        tail.drain(0..cut);
    }
}

/// Var olan hiçbir dosyanın (kaynak dosya dahil) üzerine yazılmasın diye
/// gerekirse " (1)", " (2)"… ekleyerek boş bir çıktı yolu bulur.
pub fn unique_output_path(dir: &std::path::Path, stem: &str, ext: &str) -> std::path::PathBuf {
    let first = dir.join(format!("{stem}.{ext}"));
    if !first.exists() {
        return first;
    }
    (1..)
        .map(|n| dir.join(format!("{stem} ({n}).{ext}")))
        .find(|candidate| !candidate.exists())
        .expect("sonsuz aralıkta boş bir ad bulunur")
}

/// Dışa aktarma sürerken kullanılan geçici çıktı yolu: aynı klasörde, aynı
/// uzantıyla (FFmpeg biçimi uzantıdan seçer). Başarıyla bitince asıl adına
/// taşınır; program yarıda kapanırsa asıl adla bozuk bir dosya kalmaz.
pub fn temp_output_path(final_path: &std::path::Path) -> std::path::PathBuf {
    let stem = final_path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let name = match final_path.extension() {
        Some(ext) => format!("{stem}.downkit-tmp.{}", ext.to_string_lossy()),
        None => format!("{stem}.downkit-tmp"),
    };
    final_path.with_file_name(name)
}

/// Geçici çıktıyı asıl adına taşır; o arada aynı adla dosya oluştuysa yeni bir ad
/// bulunur (var olan dosyanın üzerine yazılmaz). Asıl yolu döner.
pub fn promote_output(
    temp: &std::path::Path,
    wanted: &std::path::Path,
) -> std::io::Result<std::path::PathBuf> {
    let target = if wanted.exists() {
        let dir = wanted.parent().unwrap_or(std::path::Path::new("."));
        let stem = wanted
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        let ext = wanted
            .extension()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        unique_output_path(dir, &stem, &ext)
    } else {
        wanted.to_path_buf()
    };
    std::fs::rename(temp, &target)?;
    Ok(target)
}

pub struct FfmpegJob {
    /// Olay adı öneki: "convert" | "compress" | "resize"
    pub event_prefix: &'static str,
    /// Arayüzün kendi dilinde göstereceği hata kodu (ör. "convertFailed").
    pub error_code: &'static str,
    pub error_message: &'static str,
    pub duration_seconds: Option<f64>,
    /// FFmpeg'in yazdığı dosya (geçici yol olabilir).
    pub output_path: String,
    /// Verilirse başarıyla bitince `output_path` bu ada taşınır.
    pub final_path: Option<String>,
    /// Sıkıştırmada kaynağın boyutu: sonuç küçülmediyse kullanıcıya söylenir.
    pub input_size_bytes: Option<u64>,
    /// Ekran kartıyla kodlama başarısız olursa bir kez bu argümanlarla (işlemci) yeniden denenir.
    pub fallback_args: Option<Vec<String>>,
}

fn start_child(
    ffmpeg_exe: &std::path::Path,
    args: &[String],
) -> std::io::Result<tokio::process::Child> {
    let mut command = Command::new(ffmpeg_exe);
    command
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut command);
    command.spawn()
}

pub async fn spawn_ffmpeg(
    app: &AppHandle,
    ffmpeg_exe: &std::path::Path,
    args: Vec<String>,
    job: FfmpegJob,
) -> Result<String, AppError> {
    let child = start_child(ffmpeg_exe, &args)
        .map_err(|e| AppError::new(job.error_message, Some(e.to_string())))?;

    let job_id = Uuid::new_v4().to_string();
    if let Some(pid) = child.id() {
        register(app, &job_id, pid);
    }

    let app_for_task = app.clone();
    let job_id_for_task = job_id.clone();
    let exe = ffmpeg_exe.to_path_buf();

    tauri::async_runtime::spawn(async move {
        run_ffmpeg(app_for_task, job_id_for_task, exe, child, job).await;
    });

    Ok(job_id)
}

/// Yeniden denemede iş kaydındaki süreç kimliği güncellenir; bu arada iptal
/// edildiyse yeni süreç hemen durdurulur. İptal edildiyse true.
pub async fn replace_pid(app: &AppHandle, job_id: &str, pid: u32) -> bool {
    crate::process_guard::attach(pid);
    let canceled = {
        let state = app.state::<AppState>();
        let mut jobs = state.jobs.lock().unwrap();
        match jobs.get_mut(job_id) {
            Some(entry) => {
                entry.pid = pid;
                entry.canceled
            }
            None => false,
        }
    };
    if canceled {
        let mut command = Command::new("taskkill");
        command.args(["/F", "/T", "/PID", &pid.to_string()]);
        hide_console(&mut command);
        let _ = command.output().await;
    }
    canceled
}

pub fn is_canceled(app: &AppHandle, job_id: &str) -> bool {
    app.state::<AppState>()
        .jobs
        .lock()
        .unwrap()
        .get(job_id)
        .is_some_and(|e| e.canceled)
}

/// Bir FFmpeg sürecini sonuna kadar izler: ilerlemeyi yayınlar, hata kuyruğunu toplar.
async fn pump(
    app: &AppHandle,
    job_id: &str,
    mut child: tokio::process::Child,
    job: &FfmpegJob,
) -> (bool, String) {
    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");
    let mut stdout = BufReader::new(stdout);
    let mut stderr = BufReader::new(stderr);
    let (mut out_buf, mut err_buf) = (Vec::new(), Vec::new());
    let mut stderr_done = false;
    let mut stderr_tail = String::new();
    let mut out_time_us: Option<u64> = None;
    let mut speed: Option<f64> = None;

    loop {
        tokio::select! {
            line = read_line_lossy(&mut stdout, &mut out_buf) => {
                let Some(line) = line else { break };
                let Some((key, value)) = line.split_once('=') else { continue };
                match key {
                    "out_time_us" => out_time_us = value.trim().parse().ok(),
                    "speed" => speed = value.trim().trim_end_matches('x').parse().ok(),
                    "progress" => {
                        let percent = match (out_time_us, job.duration_seconds) {
                            (Some(us), Some(d)) if d > 0.0 => {
                                Some(((us as f64 / 1_000_000.0) / d * 100.0).min(100.0))
                            }
                            _ => None,
                        };
                        let _ = app.emit(
                            &format!("{}-progress", job.event_prefix),
                            FfmpegProgressPayload { job_id: job_id.to_string(), percent, speed },
                        );
                    }
                    _ => {}
                }
            }
            line = read_line_lossy(&mut stderr, &mut err_buf), if !stderr_done => {
                match line {
                    Some(line) => push_tail(&mut stderr_tail, &line),
                    None => stderr_done = true,
                }
            }
        }
    }
    // stdout önce kapanırsa hata satırları stderr'de kalmış olabilir.
    while !stderr_done {
        match read_line_lossy(&mut stderr, &mut err_buf).await {
            Some(line) => push_tail(&mut stderr_tail, &line),
            None => stderr_done = true,
        }
    }
    let status = child.wait().await;
    (matches!(status, Ok(s) if s.success()), stderr_tail)
}

async fn run_ffmpeg(
    app: AppHandle,
    job_id: String,
    ffmpeg_exe: std::path::PathBuf,
    child: tokio::process::Child,
    mut job: FfmpegJob,
) {
    let (mut succeeded, mut stderr_tail) = pump(&app, &job_id, child, &job).await;
    let mut notice: Option<&'static str> = None;

    // Ekran kartı kodlaması başarısız: yarım dosya silinir, işlemciyle bir kez daha denenir.
    if !succeeded && !is_canceled(&app, &job_id) {
        if let Some(args) = job.fallback_args.take() {
            let _ = tokio::fs::remove_file(&job.output_path).await;
            if let Ok(child) = start_child(&ffmpeg_exe, &args) {
                let canceled = match child.id() {
                    Some(pid) => replace_pid(&app, &job_id, pid).await,
                    None => false,
                };
                let (ok, tail) = pump(&app, &job_id, child, &job).await;
                succeeded = ok && !canceled;
                if !ok {
                    stderr_tail = tail;
                }
                notice = Some("gpuFallback");
            }
        }
    }

    let canceled = finish(&app, &job_id).canceled;

    if canceled || !succeeded {
        // Yarım kalmış çıktı dosyası işe yaramaz; kaynak dosyaya asla dokunulmaz.
        let _ = tokio::fs::remove_file(&job.output_path).await;
    }

    if canceled {
        let _ = app.emit(
            &format!("{}-canceled", job.event_prefix),
            JobCanceledPayload {
                job_id,
                partial_target: None,
            },
        );
        return;
    }
    if succeeded {
        let mut file_path = job.output_path.clone();
        if let Some(final_path) = &job.final_path {
            match promote_output(
                std::path::Path::new(&job.output_path),
                std::path::Path::new(final_path),
            ) {
                Ok(path) => file_path = path.to_string_lossy().into_owned(),
                Err(e) => {
                    let _ = tokio::fs::remove_file(&job.output_path).await;
                    let _ = app.emit(
                        &format!("{}-error", job.event_prefix),
                        JobErrorPayload {
                            job_id,
                            message: job.error_message.to_string(),
                            code: Some(job.error_code),
                            raw_detail: Some(e.to_string()),
                        },
                    );
                    return;
                }
            }
        }
        let size = tokio::fs::metadata(&file_path)
            .await
            .map(|m| m.len())
            .unwrap_or(0);
        let not_smaller = job.input_size_bytes.is_some_and(|input| size >= input);
        let _ = app.emit(
            &format!("{}-complete", job.event_prefix),
            JobCompletePayload {
                job_id,
                file_path,
                file_size_bytes: size,
                notice: if not_smaller {
                    Some("notSmaller")
                } else {
                    notice
                },
            },
        );
    } else {
        let _ = app.emit(&format!("{}-error", job.event_prefix), {
            let friendly = ffmpeg_friendly(&stderr_tail);
            JobErrorPayload {
                job_id,
                message: friendly
                    .map(|f| f.message)
                    .unwrap_or(job.error_message)
                    .to_string(),
                code: Some(friendly.map(|f| f.code).unwrap_or(job.error_code)),
                raw_detail: Some(stderr_tail),
            }
        });
    }
}

/// FFmpeg'in kullanıcının kendisinin çözebileceği hatalarını açıklar.
/// Kullanıcıya kendi dilinde gösterilecek hata (kod + ileti).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Friendly {
    pub code: &'static str,
    pub message: &'static str,
}

fn ffmpeg_friendly(stderr: &str) -> Option<Friendly> {
    let text = stderr.to_lowercase();
    if text.contains("no space left on device") {
        return Some(Friendly {
            code: "diskFull",
            message: "Diskte yeterli boş alan yok. Yer açıp tekrar deneyin.",
        });
    }
    if text.contains("permission denied") {
        return Some(Friendly {
            code: "permissionDenied",
            message: "Kayıt klasörüne yazılamadı. Başka bir klasör seçin.",
        });
    }
    if text.contains("invalid data found when processing input")
        || text.contains("moov atom not found")
    {
        return Some(Friendly {
            code: "sourceCorrupt",
            message: "Kaynak dosya bozuk ya da tam inmemiş görünüyor.",
        });
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gecici_cikti_ayni_klasorde_ayni_uzantiyla() {
        let temp = temp_output_path(std::path::Path::new("C:\\Videolar\\Klibim.mp4"));
        assert_eq!(
            temp,
            std::path::Path::new("C:\\Videolar\\Klibim.downkit-tmp.mp4")
        );
        let gif = temp_output_path(std::path::Path::new("D:\\a b.gif"));
        assert_eq!(gif, std::path::Path::new("D:\\a b.downkit-tmp.gif"));
    }

    #[test]
    fn gecici_cikti_tasinir_var_olan_dosyanin_uzerine_yazilmaz() {
        let dir = std::env::temp_dir().join(format!("downkit-promote-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let wanted = dir.join("klip.mp4");
        let temp = temp_output_path(&wanted);
        std::fs::write(&temp, b"yeni").unwrap();
        assert_eq!(promote_output(&temp, &wanted).unwrap(), wanted);
        assert!(!temp.exists());
        // Aynı adla dosya oluştuysa yeni ad bulunur.
        std::fs::write(&temp, b"ikinci").unwrap();
        let second = promote_output(&temp, &wanted).unwrap();
        assert_eq!(second, dir.join("klip (1).mp4"));
        assert_eq!(std::fs::read(&wanted).unwrap(), b"yeni");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn ffmpeg_disk_dolu_hatasi_aciklanir() {
        let stderr = "av_interleaved_write_frame(): No space left on device";
        assert_eq!(ffmpeg_friendly(stderr).map(|f| f.code), Some("diskFull"));
        assert_eq!(ffmpeg_friendly("Conversion failed!"), None);
    }

    #[test]
    fn var_olan_dosyanin_uzerine_yazilmaz() {
        let dir = std::env::temp_dir().join(format!("downkit-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("video.mp4"), b"kaynak").unwrap();
        std::fs::write(dir.join("video (1).mp4"), b"eski cikti").unwrap();

        let path = unique_output_path(&dir, "video", "mp4");
        assert_eq!(path, dir.join("video (2).mp4"));

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn kuyruk_sinirini_asinca_eski_satirlar_atilir() {
        let mut tail = String::new();
        for _ in 0..2000 {
            push_tail(&mut tail, "satır");
        }
        assert!(tail.len() <= STDERR_TAIL_BYTES + 8);
        assert!(tail.ends_with("satır\n"));
    }

    #[test]
    fn cok_baytli_karakterde_kesmek_paniklemez() {
        let mut tail = String::new();
        for _ in 0..3000 {
            push_tail(&mut tail, "ığşçöü");
        }
        assert!(tail.is_char_boundary(0));
    }

    #[tokio::test]
    async fn gecersiz_utf8_satir_okumayi_kesmez() {
        // cp1254'te "ı" = 0xFD, UTF-8'de geçersiz.
        let data: &[u8] = b"ilk\nbozuk \xFD satir\nson\n";
        let mut reader = BufReader::new(data);
        let mut buf = Vec::new();
        assert_eq!(
            read_line_lossy(&mut reader, &mut buf).await.as_deref(),
            Some("ilk")
        );
        let bozuk = read_line_lossy(&mut reader, &mut buf).await.unwrap();
        assert!(bozuk.starts_with("bozuk"));
        assert_eq!(
            read_line_lossy(&mut reader, &mut buf).await.as_deref(),
            Some("son")
        );
        assert_eq!(read_line_lossy(&mut reader, &mut buf).await, None);
    }
}
