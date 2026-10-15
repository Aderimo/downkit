//! Yüz takibi (otomatik dikey kırpma için): kaynaktan saniyede birkaç küçük gri kare
//! çıkarılır, her karede Windows'un kendi yüz algılayıcısı (`Windows.Media.FaceAnalysis`)
//! çalışır. Çevrimdışıdır, model indirmez; görüntü bilgisayardan çıkmaz. Yüzlerin
//! seçimi ve yumuşatma arayüzde (lib/faceTrack.ts) yapılır.

use std::io::Read;
use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use windows::Graphics::Imaging::{BitmapPixelFormat, BitmapSize, SoftwareBitmap};
use windows::Media::FaceAnalysis::FaceDetector;
use windows::Security::Cryptography::CryptographicBuffer;
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

use crate::error::AppError;
use crate::ffmpeg;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// Algılayıcıya giden karenin genişliği (küçük yüzler de bulunsun, iş hızlı kalsın).
const WORK_WIDTH: u32 = 640;
/// En çok bu kadar kare incelenir (uzun videoda örnekleme seyrelir).
const MAX_SAMPLES: f64 = 4000.0;
const ERROR_MESSAGE: &str = "Yüzler bulunamadı.";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FaceSample {
    /// Kaynak saniyesi.
    pub t: f64,
    /// Yüz kutuları: [x, y, w, h], karenin 0–1 oranı.
    pub faces: Vec<[f32; 4]>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FaceProgress {
    done: usize,
    total: usize,
}

/// Çalışma karesinin yüksekliği (çift).
fn work_height(width: u32, height: u32) -> u32 {
    let h = (WORK_WIDTH as f64 * height.max(1) as f64 / width.max(1) as f64).round() as u32;
    (h.max(16) + 1) & !1
}

/// Kaç kare/sn incelenecek: toplam süre uzunsa seyrelir (en az 0,5).
fn sample_rate(total_seconds: f64) -> f64 {
    let wanted = 2.0;
    if total_seconds * wanted <= MAX_SAMPLES {
        wanted
    } else {
        (MAX_SAMPLES / total_seconds).max(0.5)
    }
}

pub fn frame_args(input: &str, start: f64, length: f64, fps: f64, w: u32, h: u32) -> Vec<String> {
    vec![
        "-v".into(),
        "error".into(),
        "-ss".into(),
        format!("{start:.3}"),
        "-t".into(),
        format!("{length:.3}"),
        "-i".into(),
        input.into(),
        "-an".into(),
        "-sn".into(),
        "-vf".into(),
        format!("fps={fps:.3},scale={w}:{h},format=gray"),
        "-f".into(),
        "rawvideo".into(),
        "-pix_fmt".into(),
        "gray".into(),
        "pipe:1".into(),
    ]
}

fn detect(
    detector: &FaceDetector,
    gray: &[u8],
    w: u32,
    h: u32,
) -> windows::core::Result<Vec<[f32; 4]>> {
    let buffer = CryptographicBuffer::CreateFromByteArray(gray)?;
    let bitmap = SoftwareBitmap::CreateCopyFromBuffer(
        &buffer,
        BitmapPixelFormat::Gray8,
        w as i32,
        h as i32,
    )?;
    let faces = detector.DetectFacesAsync(&bitmap)?.join()?;
    let mut out = Vec::new();
    for face in faces {
        let b = face.FaceBox()?;
        out.push([
            b.X as f32 / w as f32,
            b.Y as f32 / h as f32,
            b.Width as f32 / w as f32,
            b.Height as f32 / h as f32,
        ]);
    }
    Ok(out)
}

fn run(
    app: &AppHandle,
    ffmpeg_exe: &std::path::Path,
    path: &str,
    ranges: &[(f64, f64)],
    width: u32,
    height: u32,
) -> Result<Vec<FaceSample>, String> {
    let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
    if !FaceDetector::IsSupported().map_err(|e| e.message())? {
        return Err("Bu Windows'ta yüz algılama yok.".into());
    }
    let detector = FaceDetector::CreateAsync()
        .and_then(|op| op.join())
        .map_err(|e| e.message())?;
    let (w, h) = (WORK_WIDTH, work_height(width, height));
    // Çok küçük yüzler (uzaktaki kalabalık) sayılmasın.
    let _ = detector.SetMinDetectableFaceSize(BitmapSize {
        Width: 24,
        Height: 24,
    });
    let total: f64 = ranges.iter().map(|(a, b)| (b - a).max(0.0)).sum();
    let fps = sample_rate(total);
    let expected = (total * fps).ceil() as usize;
    let frame_bytes = (w * h) as usize;
    let mut samples = Vec::new();
    for &(start, end) in ranges {
        if end - start < 0.05 {
            continue;
        }
        let mut child = Command::new(ffmpeg_exe)
            .args(frame_args(path, start, end - start, fps, w, h))
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| e.to_string())?;
        crate::process_guard::attach(child.id());
        let mut stdout = child.stdout.take().ok_or("stdout yok")?;
        let mut frame = vec![0u8; frame_bytes];
        let mut index = 0usize;
        while stdout.read_exact(&mut frame).is_ok() {
            let faces = detect(&detector, &frame, w, h).unwrap_or_default();
            samples.push(FaceSample {
                t: start + index as f64 / fps,
                faces,
            });
            index += 1;
            if samples.len() % 20 == 0 {
                let _ = app.emit(
                    "editor-face-progress",
                    FaceProgress {
                        done: samples.len(),
                        total: expected.max(samples.len()),
                    },
                );
            }
        }
        let _ = child.wait();
    }
    Ok(samples)
}

/// Kaynaktaki yüzleri bulur. `ranges`: kullanılan kaynak aralıkları (saniye);
/// `width`/`height`: kaynağın boyutu (çalışma karesinin oranı için).
#[tauri::command]
pub async fn editor_face_track(
    app: AppHandle,
    path: String,
    ranges: Vec<(f64, f64)>,
    width: u32,
    height: u32,
) -> Result<Vec<FaceSample>, AppError> {
    if !std::path::Path::new(&path).is_file() {
        return Err(AppError::new("Dosya bulunamadı.", Some(path)));
    }
    let exe = ffmpeg::binary::ensure_ffmpeg(&app)
        .await?
        .join("ffmpeg.exe");
    let ranges: Vec<(f64, f64)> = ranges
        .into_iter()
        .filter(|(a, b)| a.is_finite() && b.is_finite() && b > a && *a >= 0.0)
        .collect();
    tokio::task::spawn_blocking(move || run(&app, &exe, &path, &ranges, width, height))
        .await
        .map_err(|e| AppError::new(ERROR_MESSAGE, Some(e.to_string())))?
        .map_err(|detail| AppError::new(ERROR_MESSAGE, Some(detail)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calisma_karesi_ve_ornekleme() {
        assert_eq!(work_height(1920, 1080), 360);
        assert_eq!(work_height(1080, 1920), 1138);
        assert_eq!(sample_rate(60.0), 2.0);
        assert!((sample_rate(4000.0) - 1.0).abs() < 1e-9);
        assert_eq!(sample_rate(100_000.0), 0.5);
        let a = frame_args("C:/v.mp4", 1.5, 10.0, 2.0, 640, 360).join(" ");
        assert!(a.contains("-ss 1.500 -t 10.000 -i C:/v.mp4"));
        assert!(a.contains("fps=2.000,scale=640:360,format=gray"));
        assert!(a.ends_with("-f rawvideo -pix_fmt gray pipe:1"));
    }

    /// Elle çalıştırılır: gerçek algılayıcıyla düz bir karede yüz çıkmamalı.
    #[test]
    #[ignore]
    fn bos_karede_yuz_yok() {
        let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
        let detector = FaceDetector::CreateAsync().unwrap().join().unwrap();
        let gray = vec![128u8; 640 * 360];
        assert!(detect(&detector, &gray, 640, 360).unwrap().is_empty());
    }
}
