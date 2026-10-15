/// ffmpeg ve yt-dlp'ye verilecek saniye değeri ("65", "65.5"): gereksiz sıfırlar atılır.
pub fn seconds_arg(value: f64) -> String {
    let text = format!("{:.3}", value.max(0.0));
    text.trim_end_matches('0').trim_end_matches('.').to_string()
}

/// Yerel dosyadan bir kesit çıkarır.
///
/// - `precise = false`: yeniden kodlama yok (`-c copy`); saniyeler sürer, kalite
///   kaybı yoktur ama kesim en yakın anahtar kareye kayabilir (birkaç saniye).
/// - `precise = true`: görüntü yeniden kodlanır, kesim tam istenen karede olur.
///
/// Giriş öncesi `-ss` hızlı arama yapar; `-t` süreyi verir.
pub fn build_args(
    input: &str,
    output: &str,
    start_seconds: f64,
    end_seconds: f64,
    precise: bool,
) -> Vec<String> {
    let duration = (end_seconds - start_seconds).max(0.0);
    let mut args: Vec<String> = vec![
        "-y".into(),
        "-ss".into(),
        seconds_arg(start_seconds),
        "-i".into(),
        input.into(),
        "-t".into(),
        seconds_arg(duration),
    ];
    if precise {
        args.extend(
            [
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "20",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-movflags",
                "+faststart",
            ]
            .map(String::from),
        );
    } else {
        args.extend(
            [
                "-map",
                "0:v:0?",
                "-map",
                "0:a?",
                "-c",
                "copy",
                "-avoid_negative_ts",
                "make_zero",
            ]
            .map(String::from),
        );
    }
    args.extend(["-progress", "pipe:1", "-nostats"].map(String::from));
    args.push(output.into());
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saniye_argumani_sade_yazilir() {
        assert_eq!(seconds_arg(65.0), "65");
        assert_eq!(seconds_arg(65.5), "65.5");
        assert_eq!(seconds_arg(-3.0), "0");
    }

    #[test]
    fn hizli_kesim_yeniden_kodlamaz() {
        let args = build_args("in.mp4", "out.mp4", 60.0, 90.0, false).join(" ");
        assert!(args.contains("-ss 60 -i in.mp4 -t 30"));
        assert!(args.contains("-c copy"));
        assert!(!args.contains("libx264"));
    }

    #[test]
    fn hassas_kesim_goruntuyu_yeniden_kodlar() {
        let args = build_args("in.mkv", "out.mp4", 10.0, 12.5, true).join(" ");
        assert!(args.contains("-t 2.5"));
        assert!(args.contains("libx264"));
        assert!(args.ends_with("out.mp4"));
    }
}
