//! Sessizlik bulma: FFmpeg `silencedetect` çıktısını okur. Kayıtta ayrı mikrofon izi
//! varsa (DownKit kaydı: "Mix" + "Microphone") konuşma sessizliği o izde aranır;
//! böylece oyun sesi sürerken konuşulmayan yerler de bulunur.

/// `silencedetect` argümanları: yalnızca ses çözülür, çıktı atılır.
pub fn silence_args(
    input: &str,
    audio_index: usize,
    noise_db: f64,
    min_seconds: f64,
) -> Vec<String> {
    let noise = if noise_db.is_finite() {
        noise_db.clamp(-70.0, -10.0)
    } else {
        -38.0
    };
    let min = if min_seconds.is_finite() {
        min_seconds.clamp(0.1, 10.0)
    } else {
        0.6
    };
    vec![
        "-hide_banner".into(),
        "-nostats".into(),
        "-v".into(),
        "info".into(),
        "-i".into(),
        input.into(),
        "-map".into(),
        format!("0:a:{audio_index}"),
        "-vn".into(),
        "-sn".into(),
        "-dn".into(),
        "-af".into(),
        format!("silencedetect=noise={noise:.1}dB:d={min:.2}"),
        "-f".into(),
        "null".into(),
        "-".into(),
    ]
}

/// stderr satırlarından sessiz aralıklar. Dosya sessizken biterse son aralığın sonu
/// `duration` (bilinmiyorsa başlangıcı + 1 saat; arayüz klip sonuna kırpar).
pub fn parse_silences(stderr: &str, duration: Option<f64>) -> Vec<(f64, f64)> {
    let value = |line: &str, key: &str| -> Option<f64> {
        let rest = &line[line.find(key)? + key.len()..];
        rest.trim_start()
            .split(|c: char| c.is_whitespace() || c == '|')
            .next()?
            .parse::<f64>()
            .ok()
            .filter(|v| v.is_finite())
    };
    let mut out = Vec::new();
    let mut open: Option<f64> = None;
    for line in stderr.lines().filter(|l| l.contains("silencedetect")) {
        if let Some(start) = value(line, "silence_start:") {
            open = Some(start.max(0.0));
        } else if let Some(end) = value(line, "silence_end:") {
            if let Some(start) = open.take() {
                if end > start {
                    out.push((start, end));
                }
            }
        }
    }
    if let Some(start) = open {
        let end = duration.filter(|d| *d > start).unwrap_or(start + 3600.0);
        out.push((start, end));
    }
    out
}

/// Ses izlerinin adlarından konuşma (mikrofon) izinin sırası.
pub fn voice_track(titles: &[Option<String>]) -> Option<usize> {
    if titles.len() < 2 {
        return None;
    }
    titles.iter().position(|t| {
        t.as_deref()
            .map(|t| {
                let t = t.to_lowercase();
                t.contains("micro") || t.contains("mikrofon") || t.contains("voice") || t == "mic"
            })
            .unwrap_or(false)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const LOG: &str = "\
[silencedetect @ 000001] silence_start: 1.2345
[silencedetect @ 000001] silence_end: 2.5 | silence_duration: 1.2655
size=N/A time=00:00:05.00 bitrate=N/A speed= 500x
[silencedetect @ 000001] silence_start: -0.01
[silencedetect @ 000001] silence_end: 0.8 | silence_duration: 0.81
[silencedetect @ 000001] silence_start: 9.75
";

    #[test]
    fn araliklar_okunur_sondaki_acik_sessizlik_dosya_sonunda_biter() {
        let s = parse_silences(LOG, Some(12.0));
        assert_eq!(s, vec![(1.2345, 2.5), (0.0, 0.8), (9.75, 12.0)]);
        let s = parse_silences(LOG, None);
        assert_eq!(s[2], (9.75, 3609.75));
        assert!(parse_silences("", Some(3.0)).is_empty());
    }

    #[test]
    fn argumanlar_sinirlanir_ve_izi_secer() {
        let a = silence_args("C:/a b/ses.mp4", 1, -99.0, 0.0).join(" ");
        assert!(a.contains("-map 0:a:1"));
        assert!(a.contains("silencedetect=noise=-70.0dB:d=0.10"));
        assert!(a.ends_with("-f null -"));
        let b = silence_args("x.mp4", 0, f64::NAN, f64::NAN).join(" ");
        assert!(b.contains("noise=-38.0dB:d=0.60"));
    }

    #[test]
    fn mikrofon_izi_bulunur() {
        let titles = [Some("Mix".to_string()), Some("Microphone".to_string())];
        assert_eq!(voice_track(&titles), Some(1));
        assert_eq!(voice_track(&[Some("Microphone".into())]), None);
        assert_eq!(voice_track(&[None, None]), None);
    }
}
