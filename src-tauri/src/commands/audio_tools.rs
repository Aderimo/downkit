//! Ses araçları: ses onarımının önce/sonra dinlemesi (kısa WAV) ve müzikte ritim
//! (vuruş) tespiti. İkisi de FFmpeg ile kaynağın kısa bir bölümünü okur.

use std::process::Stdio;
use std::time::Duration;

use tauri::AppHandle;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

use crate::error::AppError;
use crate::ffmpeg;
use crate::ffmpeg::edit::{loudness_step, AudioFx};
use crate::jobs;
use crate::paths;

const TIMEOUT: Duration = Duration::from_secs(60);
/// Ritim tespitinde örnekleme hızı ve pencere (≈ 23 ms).
const BEAT_RATE: u32 = 11_025;
const HOP: usize = 256;
const MAX_BEAT_SECONDS: f64 = 600.0;

fn seconds(v: f64) -> String {
    format!("{:.3}", v.max(0.0))
}

async fn run(
    app: &AppHandle,
    args: Vec<String>,
    capture_stdout: bool,
) -> Result<Vec<u8>, AppError> {
    let dir = ffmpeg::binary::ensure_ffmpeg(app).await?;
    let mut command = Command::new(dir.join("ffmpeg.exe"));
    command
        .args(&args)
        .stdout(if capture_stdout {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    jobs::hide_console(&mut command);
    let mut child = command
        .spawn()
        .map_err(|e| AppError::new("Ses işlenemedi.", Some(e.to_string())))?;
    if let Some(pid) = child.id() {
        crate::process_guard::attach(pid);
    }
    let mut out = Vec::new();
    let mut err = String::new();
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take().expect("stderr piped");
    let read = async {
        if let Some(s) = stdout.as_mut() {
            let _ = s.read_to_end(&mut out).await;
        }
        let _ = stderr.read_to_string(&mut err).await;
    };
    if tokio::time::timeout(TIMEOUT, read).await.is_err() {
        let _ = child.kill().await;
        return Err(AppError::new("Ses işleme çok uzun sürdü.", None));
    }
    let status = child
        .wait()
        .await
        .map_err(|e| AppError::new("Ses işlenemedi.", Some(e.to_string())))?;
    if !status.success() {
        return Err(AppError::new(
            "Ses işlenemedi.",
            Some(err.lines().rev().take(4).collect::<Vec<_>>().join(" | ")),
        ));
    }
    Ok(out)
}

/// Kaynağın `start`'tan `length` saniyesini onarım zinciriyle (ve isteğe bağlı hedef
/// seviyeyle) WAV olarak yazar; `fx` yoksa olduğu gibi ("önce"). Dosya yolunu döner.
#[tauri::command]
pub async fn audio_fx_preview(
    app: AppHandle,
    path: String,
    start: f64,
    length: f64,
    fx: Option<AudioFx>,
    loudness: Option<f64>,
) -> Result<String, AppError> {
    if !std::path::Path::new(&path).is_file() {
        return Err(AppError::new("Dosya bulunamadı.", Some(path)));
    }
    let mut steps: Vec<String> = fx.map(|f| f.steps()).unwrap_or_default();
    if let Some(lufs) = loudness.filter(|v| v.is_finite()) {
        steps.push(loudness_step(lufs));
    }
    steps.push("aresample=48000".into());
    let name = if fx.is_some() || loudness.is_some() {
        "after"
    } else {
        "before"
    };
    let out = paths::cache_dir(&app, "audio-preview")?.join(format!("{name}.wav"));
    let args = vec![
        "-y".into(),
        "-ss".into(),
        seconds(start),
        "-t".into(),
        seconds(length.clamp(1.0, 15.0)),
        "-i".into(),
        path,
        "-vn".into(),
        "-map".into(),
        "0:a:0".into(),
        "-af".into(),
        steps.join(","),
        "-ac".into(),
        "2".into(),
        out.to_string_lossy().into_owned(),
    ];
    run(&app, args, false).await?;
    Ok(out.to_string_lossy().into_owned())
}

/// Müzikteki vuruşlar (kaynak saniyesi, `start`'a göre değil dosyanın başından).
#[tauri::command]
pub async fn audio_beats(
    app: AppHandle,
    path: String,
    start: f64,
    length: f64,
) -> Result<Vec<f64>, AppError> {
    if !std::path::Path::new(&path).is_file() {
        return Err(AppError::new("Dosya bulunamadı.", Some(path)));
    }
    let args = vec![
        "-v".into(),
        "error".into(),
        "-ss".into(),
        seconds(start),
        "-t".into(),
        seconds(length.clamp(1.0, MAX_BEAT_SECONDS)),
        "-i".into(),
        path,
        "-vn".into(),
        "-map".into(),
        "0:a:0".into(),
        "-ac".into(),
        "1".into(),
        "-ar".into(),
        BEAT_RATE.to_string(),
        "-f".into(),
        "f32le".into(),
        "-".into(),
    ];
    let bytes = run(&app, args, true).await?;
    let samples: Vec<f32> = bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|c| f32::from_le_bytes(*c))
        .collect();
    Ok(detect_beats(&samples, BEAT_RATE)
        .into_iter()
        .map(|t| ((start.max(0.0) + t) * 1000.0).round() / 1000.0)
        .collect())
}

/// Enerji artışına (spektral akı yerine kısa pencere enerjisinin pozitif farkı) göre
/// vuruşlar: uyarlamalı eşiğin üstündeki tepe noktaları, aralarında en az 0,25 sn.
pub fn detect_beats(samples: &[f32], rate: u32) -> Vec<f64> {
    if samples.len() < HOP * 8 || rate == 0 {
        return Vec::new();
    }
    let energy: Vec<f64> = samples
        .chunks(HOP)
        .map(|w| w.iter().map(|v| (*v as f64) * (*v as f64)).sum::<f64>() / w.len() as f64)
        .collect();
    let flux: Vec<f64> = energy
        .iter()
        .enumerate()
        .map(|(i, e)| {
            if i == 0 {
                0.0
            } else {
                (e - energy[i - 1]).max(0.0)
            }
        })
        .collect();
    let hop_seconds = HOP as f64 / rate as f64;
    let window = (0.5 / hop_seconds).round() as usize; // ±0,5 sn çevre
    let min_gap = (0.25 / hop_seconds).round() as usize;
    let peak = flux.iter().cloned().fold(0.0, f64::max);
    if peak <= 0.0 {
        return Vec::new();
    }
    let mut beats = Vec::new();
    let mut last: Option<usize> = None;
    for i in 1..flux.len().saturating_sub(1) {
        let lo = i.saturating_sub(window);
        let hi = (i + window).min(flux.len());
        let local = &flux[lo..hi];
        let mean = local.iter().sum::<f64>() / local.len() as f64;
        let threshold = (mean * 1.6).max(peak * 0.08);
        let is_peak = flux[i] > threshold && flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1];
        if is_peak && last.is_none_or(|l| i - l >= min_gap) {
            beats.push(i as f64 * hop_seconds);
            last = Some(i);
        }
    }
    beats
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 120 BPM metronom: her 0,5 sn'de 30 ms'lik tık, arada hafif gürültü.
    fn metronome(seconds: f64, bpm: f64) -> Vec<f32> {
        let n = (seconds * BEAT_RATE as f64) as usize;
        let period = 60.0 / bpm;
        let mut seed = 12345u32;
        (0..n)
            .map(|i| {
                let t = i as f64 / BEAT_RATE as f64;
                let phase = t % period;
                seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12345);
                let noise = ((seed >> 16) as f32 / 65535.0 - 0.5) * 0.02;
                let click = if phase < 0.03 {
                    (0.8 * (2.0 * std::f64::consts::PI * 1000.0 * t).sin() * (1.0 - phase / 0.03))
                        as f32
                } else {
                    0.0
                };
                click + noise
            })
            .collect()
    }

    #[test]
    fn metronom_vuruslari_30_ms_icinde_bulunur() {
        let beats = detect_beats(&metronome(8.0, 120.0), BEAT_RATE);
        assert!(beats.len() >= 14 && beats.len() <= 17, "{beats:?}");
        for b in &beats {
            let nearest = (b / 0.5).round() * 0.5;
            assert!((b - nearest).abs() <= 0.03, "{b} ≠ {nearest}");
        }
    }

    #[test]
    fn sessizlikte_vurus_yok() {
        assert!(detect_beats(&vec![0.0; BEAT_RATE as usize * 3], BEAT_RATE).is_empty());
        assert!(detect_beats(&[0.1; 10], BEAT_RATE).is_empty());
    }
}
