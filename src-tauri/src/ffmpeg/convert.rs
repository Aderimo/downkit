use std::path::Path;

use serde::Deserialize;
use tokio::process::Command;

use crate::error::AppError;
use crate::types::LocalMediaInfo;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Deserialize)]
struct ProbeFormat {
    duration: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ProbeStream {
    codec_type: Option<String>,
    codec_name: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    avg_frame_rate: Option<String>,
    r_frame_rate: Option<String>,
}

/// ffprobe kare hızını kesir olarak verir ("30000/1001"); "0/0" bilinmiyor demektir.
fn parse_frame_rate(rate: &str) -> Option<f64> {
    let (num, den) = rate.split_once('/').unwrap_or((rate, "1"));
    let (num, den) = (
        num.trim().parse::<f64>().ok()?,
        den.trim().parse::<f64>().ok()?,
    );
    (num > 0.0 && den > 0.0).then(|| num / den)
}

#[derive(Debug, Deserialize)]
struct ProbeOutput {
    format: ProbeFormat,
    #[serde(default)]
    streams: Vec<ProbeStream>,
}

pub async fn probe_file(ffmpeg_dir: &Path, input: &str) -> Result<LocalMediaInfo, AppError> {
    let ffprobe = ffmpeg_dir.join("ffprobe.exe");
    let mut command = Command::new(&ffprobe);
    command
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            input,
        ])
        .creation_flags(CREATE_NO_WINDOW);

    let output = command
        .output()
        .await
        .map_err(|e| AppError::new("Dosya okunamadı.", Some(e.to_string())))?;

    if !output.status.success() {
        return Err(AppError::new(
            "Bu dosya okunamadı. Desteklenen bir video/ses dosyası olduğundan emin olun.",
            Some(String::from_utf8_lossy(&output.stderr).to_string()),
        ));
    }

    let probe: ProbeOutput = serde_json::from_slice(&output.stdout)
        .map_err(|e| AppError::new("Dosya bilgileri okunamadı.", Some(e.to_string())))?;

    let path = Path::new(input);
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(input)
        .to_string();
    let file_size_bytes = tokio::fs::metadata(input)
        .await
        .map(|m| m.len())
        .unwrap_or(0);
    let container = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let video_stream = probe
        .streams
        .iter()
        .find(|s| s.codec_type.as_deref() == Some("video"));
    let audio_stream = probe
        .streams
        .iter()
        .find(|s| s.codec_type.as_deref() == Some("audio"));

    Ok(LocalMediaInfo {
        file_name,
        file_path: input.to_string(),
        file_size_bytes,
        duration_seconds: probe.format.duration.and_then(|d| d.parse::<f64>().ok()),
        width: video_stream.and_then(|s| s.width),
        height: video_stream.and_then(|s| s.height),
        fps: video_stream.and_then(|s| {
            s.avg_frame_rate
                .as_deref()
                .and_then(parse_frame_rate)
                .or_else(|| s.r_frame_rate.as_deref().and_then(parse_frame_rate))
        }),
        video_codec: video_stream.and_then(|s| s.codec_name.clone()),
        audio_codec: audio_stream.and_then(|s| s.codec_name.clone()),
        container,
    })
}

fn args(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

const AUDIO_TARGETS: [&str; 5] = ["mp3", "m4a", "aac", "wav", "flac"];

/// Kaynağın kodekleri hedef kapsayıcıya olduğu gibi sığıyorsa yeniden kodlamaya
/// gerek yok: akışlar kopyalanır (ör. H.264 + AAC MKV → MP4). Saniyeler sürer ve
/// kalite kaybı olmaz. Kodek adları ffprobe'un `codec_name` değerleridir.
pub fn can_copy_streams(target: &str, video: Option<&str>, audio: Option<&str>) -> bool {
    let video_in = |allowed: &[&str]| video.is_some_and(|v| allowed.contains(&v));
    let audio_ok = |allowed: &[&str]| audio.is_none_or(|a| allowed.contains(&a));
    match target {
        "mp4" | "mov" => video_in(&["h264", "hevc"]) && audio_ok(&["aac", "mp3"]),
        "mkv" => {
            video_in(&["h264", "hevc", "vp8", "vp9", "av1", "mpeg4"])
                && audio_ok(&["aac", "mp3", "opus", "vorbis", "flac", "ac3"])
        }
        "webm" => video_in(&["vp8", "vp9", "av1"]) && audio_ok(&["opus", "vorbis"]),
        "m4a" | "aac" => audio == Some("aac"),
        "mp3" => audio == Some("mp3"),
        "flac" => audio == Some("flac"),
        _ => false,
    }
}

pub fn build_copy_args(target: &str) -> Vec<String> {
    let mut out = if AUDIO_TARGETS.contains(&target) {
        args(&["-vn", "-c:a", "copy"])
    } else {
        // İlk görüntü + tüm ses akışları; altyazılar her kapsayıcıya sığmadığı için alınmaz.
        args(&["-map", "0:v:0", "-map", "0:a?", "-c", "copy"])
    };
    if matches!(target, "mp4" | "mov" | "m4a") {
        out.extend(args(&["-movflags", "+faststart"]));
    }
    out
}

/// Hedef kapsayıcıya uygun codec argümanlarını seçer. Her zaman yeniden
/// kodluyoruz (remux uyumluluk kontrolü yerine) — daha yavaş ama her
/// kaynak/hedef kombinasyonunda güvenilir. Kapsayıcının kabul ettiği codec
/// seçilmeli: ör. WebM H.264 taşıyamaz, VP9 + Opus ister.
pub fn build_codec_args(target_container: &str) -> Vec<String> {
    match target_container {
        "mp3" => args(&["-vn", "-c:a", "libmp3lame", "-b:a", "192k"]),
        "m4a" | "aac" => args(&["-vn", "-c:a", "aac", "-b:a", "192k"]),
        "wav" => args(&["-vn", "-c:a", "pcm_s16le"]),
        "flac" => args(&["-vn", "-c:a", "flac"]),
        "webm" => args(&[
            "-c:v",
            "libvpx-vp9",
            "-crf",
            "32",
            "-b:v",
            "0",
            "-row-mt",
            "1",
            "-deadline",
            "good",
            "-cpu-used",
            "4",
            "-c:a",
            "libopus",
            "-b:a",
            "128k",
        ]),
        // "Eski cihazlar" için klasik AVI: MPEG-4 Part 2 + MP3.
        "avi" => args(&[
            "-c:v",
            "mpeg4",
            "-q:v",
            "4",
            "-c:a",
            "libmp3lame",
            "-b:a",
            "192k",
        ]),
        _ => args(&[
            "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-b:a", "192k",
        ]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn webm_vp9_ve_opus_kullanir() {
        let a = build_codec_args("webm").join(" ");
        assert!(a.contains("libvpx-vp9") && a.contains("libopus"));
        assert!(!a.contains("libx264"));
    }

    #[test]
    fn ses_hedeflerinde_goruntu_atilir() {
        for target in ["mp3", "m4a", "aac", "wav", "flac"] {
            assert_eq!(build_codec_args(target)[0], "-vn", "{target}");
        }
    }

    #[test]
    fn uyumlu_kodekler_yeniden_kodlanmadan_kopyalanir() {
        assert!(can_copy_streams("mp4", Some("h264"), Some("aac")));
        assert!(can_copy_streams("mkv", Some("vp9"), Some("opus")));
        assert!(can_copy_streams("webm", Some("vp9"), Some("opus")));
        assert!(can_copy_streams("m4a", Some("h264"), Some("aac")));
        assert!(can_copy_streams("mp4", Some("h264"), None), "sessiz video");
    }

    #[test]
    fn uyumsuz_kodekler_yeniden_kodlanir() {
        assert!(!can_copy_streams("mp4", Some("vp9"), Some("opus")));
        assert!(!can_copy_streams("webm", Some("h264"), Some("aac")));
        assert!(
            !can_copy_streams("mp4", None, Some("aac")),
            "yalnız ses dosyası"
        );
        assert!(!can_copy_streams("mp3", Some("h264"), Some("aac")));
        assert!(!can_copy_streams("avi", Some("h264"), Some("mp3")));
        assert!(!can_copy_streams("wav", None, Some("pcm_s16le")));
    }

    #[test]
    fn kopyalamada_ses_hedefi_goruntuyu_atar() {
        assert_eq!(build_copy_args("m4a")[..3], ["-vn", "-c:a", "copy"]);
        assert!(build_copy_args("mp4").contains(&"+faststart".to_string()));
    }

    #[test]
    fn kare_hizi_kesirden_okunur() {
        assert!((parse_frame_rate("30000/1001").unwrap() - 29.97).abs() < 0.01);
        assert_eq!(parse_frame_rate("60/1"), Some(60.0));
        assert_eq!(parse_frame_rate("0/0"), None);
        assert_eq!(parse_frame_rate("25"), Some(25.0));
    }

    #[test]
    fn mp4_ve_mov_h264_kullanir() {
        for target in ["mp4", "mov", "mkv"] {
            assert!(
                build_codec_args(target).contains(&"libx264".to_string()),
                "{target}"
            );
        }
    }
}
