use crate::types::LocalMediaInfo;

// Sıkıştırmada asıl kazanç çözünürlükte: 1080p → 720p piksel sayısını 2,25 kat
// azaltır, hem dosyayı küçültür hem kodlamayı hızlandırır. x264'ün "medium" ayarı
// ise "veryfast"e göre ~2-3 kat yavaş ve bu kullanımda fark edilir kazanç sağlamıyor.
// Ölçüm (60 sn 1080p, Ryzen 5 3600): eski "Küçük dosya" crf32/medium/1080p 11,7 sn →
// 12,2 MB; yenisi crf28/veryfast/720p 4,5 sn → 5,0 MB. NVENC denendi: hızlı ama aynı
// kalitede 3 kat büyük dosya — boyut odaklı sıkıştırmaya uygun değil.

const MIN_VIDEO_BITRATE_KBPS: u32 = 150;
/// Hedef boyut modunda kapsayıcı ve bit hızı dalgalanması için pay: sonuç hedefi aşmasın.
const TARGET_SAFETY: f64 = 0.95;

struct PresetPlan {
    crf: u32,
    x264_preset: &'static str,
    /// Kısa kenar (yatayda yükseklik, dikeyde genişlik) bundan büyükse küçültülür.
    max_short_side: u32,
    audio_kbps: u32,
    max_fps: Option<u32>,
}

fn preset_plan(preset: &str) -> PresetPlan {
    match preset {
        "high" => PresetPlan {
            crf: 23,
            x264_preset: "faster",
            max_short_side: 1080,
            audio_kbps: 160,
            max_fps: None,
        },
        "small" => PresetPlan {
            crf: 28,
            x264_preset: "veryfast",
            max_short_side: 720,
            audio_kbps: 96,
            max_fps: Some(30),
        },
        // En küçük dosya: 480p ve 24 fps ile kodlama da en hızlısıdır.
        "tiny" => PresetPlan {
            crf: 32,
            x264_preset: "veryfast",
            max_short_side: 480,
            audio_kbps: 64,
            max_fps: Some(24),
        },
        // "balanced" ve tanınmayan değerler
        _ => PresetPlan {
            crf: 26,
            x264_preset: "veryfast",
            max_short_side: 1080,
            audio_kbps: 128,
            max_fps: None,
        },
    }
}

/// Kullanıcının "Gelişmiş" bölümünde seçtiği sınırlar. Seçildiyse seviyenin ya da
/// hedef boyut planının otomatik sınırının yerine geçer; video hiçbir zaman büyütülmez.
/// Çözünürlük ve kare hızını düşürmek dosyayı küçültür, kodlamayı da hızlandırır.
#[derive(Debug, Default, Clone, Copy)]
pub struct Limits {
    pub max_short_side: Option<u32>,
    pub max_fps: Option<u32>,
}

/// Kısa kenarı `max_short_side`'ı aşan görüntüyü en-boy oranını koruyarak küçültür;
/// gerekmiyorsa `None`. Boyutlar çift sayıya yuvarlanır (H.264 4:2:0 şartı).
/// Kısa kenara bakılır ki dikey (9:16) videolar yanlışlıkla ufalmasın.
pub fn scaled_size(width: u32, height: u32, max_short_side: u32) -> Option<(u32, u32)> {
    let short = width.min(height);
    if short == 0 || short <= max_short_side {
        return None;
    }
    let ratio = max_short_side as f64 / short as f64;
    let even = |v: u32| (((v as f64 * ratio) / 2.0).round() as u32 * 2).max(2);
    Some((even(width), even(height)))
}

fn video_filter(
    info: &LocalMediaInfo,
    max_short_side: u32,
    max_fps: Option<u32>,
) -> Option<String> {
    let mut filters = Vec::new();
    if let (Some(w), Some(h)) = (info.width, info.height) {
        if let Some((nw, nh)) = scaled_size(w, h, max_short_side) {
            filters.push(format!("scale={nw}:{nh}"));
        }
    }
    if let (Some(max), Some(fps)) = (max_fps, info.fps) {
        // 60 fps'lik oyun/spor videoları yarı kareyle hem hızlı hem küçük olur.
        if fps > max as f64 + 0.5 {
            filters.push(format!("fps={max}"));
        }
    }
    (!filters.is_empty()).then(|| filters.join(","))
}

fn common_tail(audio_kbps: u32) -> Vec<String> {
    vec![
        // 10 bit ya da 4:4:4 kaynaklardan bile her oynatıcının açabildiği çıktı.
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-c:a".into(),
        "aac".into(),
        "-b:a".into(),
        format!("{audio_kbps}k"),
        // Dosya indirilmeden oynatılmaya başlasın (Discord, WhatsApp, tarayıcı).
        "-movflags".into(),
        "+faststart".into(),
    ]
}

/// Hazır kalite seviyeleri: CRF (sabit kalite) + çözünürlük/kare hızı sınırı.
pub fn build_args_for_preset(preset: &str, info: &LocalMediaInfo, limits: Limits) -> Vec<String> {
    let plan = preset_plan(preset);
    let mut args = Vec::new();
    let short_side = limits.max_short_side.unwrap_or(plan.max_short_side);
    if let Some(filter) = video_filter(info, short_side, limits.max_fps.or(plan.max_fps)) {
        args.extend(["-vf".into(), filter]);
    }
    args.extend([
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        plan.x264_preset.into(),
        "-crf".into(),
        plan.crf.to_string(),
    ]);
    args.extend(common_tail(plan.audio_kbps));
    args
}

#[derive(Debug, PartialEq)]
pub struct TargetPlan {
    pub video_kbps: u32,
    pub audio_kbps: u32,
    pub max_short_side: u32,
}

/// Hedef dosya boyutu için bit hızı bütçesini ses ve görüntüye böler. Bütçe
/// düştükçe ses bit hızı ve çözünürlük de düşer: 10 MB'a sığdırılan 5 dakikalık
/// bir video 1080p'de bloklaşır, 480p'de izlenebilir kalır.
pub fn target_plan(target_size_bytes: u64, duration_seconds: f64) -> TargetPlan {
    if duration_seconds <= 0.0 {
        return TargetPlan {
            video_kbps: MIN_VIDEO_BITRATE_KBPS,
            audio_kbps: 64,
            max_short_side: 360,
        };
    }
    let total_kbps = (target_size_bytes as f64 * 8.0 / 1000.0) * TARGET_SAFETY / duration_seconds;
    let audio_kbps = if total_kbps < 600.0 {
        64
    } else if total_kbps < 1500.0 {
        96
    } else {
        128
    };
    let video_kbps =
        ((total_kbps - audio_kbps as f64).round() as i64).max(MIN_VIDEO_BITRATE_KBPS as i64) as u32;
    let max_short_side = match video_kbps {
        2500.. => 1080,
        1200.. => 720,
        600.. => 480,
        _ => 360,
    };
    TargetPlan {
        video_kbps,
        audio_kbps,
        max_short_side,
    }
}

pub fn build_args_for_target_size(
    target_size_bytes: u64,
    info: &LocalMediaInfo,
    limits: Limits,
) -> Vec<String> {
    let plan = target_plan(target_size_bytes, info.duration_seconds.unwrap_or(0.0));
    let mut args = Vec::new();
    let short_side = limits.max_short_side.unwrap_or(plan.max_short_side);
    if let Some(filter) = video_filter(info, short_side, Some(limits.max_fps.unwrap_or(30))) {
        args.extend(["-vf".into(), filter]);
    }
    args.extend([
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        "veryfast".into(),
        "-b:v".into(),
        format!("{}k", plan.video_kbps),
        "-maxrate".into(),
        format!("{}k", (plan.video_kbps as f64 * 1.2) as u32),
        "-bufsize".into(),
        format!("{}k", plan.video_kbps * 2),
    ]);
    args.extend(common_tail(plan.audio_kbps));
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(width: u32, height: u32, fps: f64, duration: f64) -> LocalMediaInfo {
        LocalMediaInfo {
            chapters: Vec::new(),
            file_name: "v.mp4".into(),
            file_path: "C:/v.mp4".into(),
            file_size_bytes: 0,
            duration_seconds: Some(duration),
            width: Some(width),
            height: Some(height),
            fps: Some(fps),
            video_codec: Some("h264".into()),
            audio_codec: Some("aac".into()),
            container: "mp4".into(),
        }
    }

    #[test]
    fn yatay_video_kisa_kenara_gore_kucultulur() {
        assert_eq!(scaled_size(3840, 2160, 720), Some((1280, 720)));
        assert_eq!(scaled_size(1920, 1080, 1080), None);
        assert_eq!(scaled_size(1280, 720, 1080), None, "büyütülmez");
    }

    #[test]
    fn dikey_video_ufalmaz_genislige_gore_kucultulur() {
        assert_eq!(scaled_size(1080, 1920, 720), Some((720, 1280)));
    }

    #[test]
    fn olcekli_boyutlar_cift_sayidir() {
        let (w, h) = scaled_size(1918, 1078, 720).unwrap();
        assert_eq!((w % 2, h % 2), (0, 0));
    }

    #[test]
    fn kucuk_dosya_720p_ve_30fps_ile_hizli_kodlar() {
        let args =
            build_args_for_preset("small", &info(3840, 2160, 60.0, 600.0), Limits::default())
                .join(" ");
        assert!(args.contains("-vf scale=1280:720,fps=30"), "{args}");
        assert!(args.contains("-preset veryfast"));
        assert!(!args.contains("medium"));
    }

    #[test]
    fn cok_kucuk_dosya_480p_ve_24fps_ile_en_hizli_kodlar() {
        let args = build_args_for_preset("tiny", &info(3840, 2160, 60.0, 600.0), Limits::default())
            .join(" ");
        assert!(args.contains("scale=854:480"), "{args}");
        assert!(args.contains("fps=24"), "{args}");
        assert!(args.contains("-crf 32"), "{args}");
        assert!(args.contains("-b:a 64k"), "{args}");
    }

    #[test]
    fn zaten_kucuk_videoya_filtre_eklenmez() {
        let args =
            build_args_for_preset("balanced", &info(1280, 720, 30.0, 60.0), Limits::default());
        assert!(!args.contains(&"-vf".to_string()));
    }

    #[test]
    fn yuksek_kalite_1080p_ustunu_kucultur() {
        let args = build_args_for_preset("high", &info(2560, 1440, 30.0, 60.0), Limits::default())
            .join(" ");
        assert!(args.contains("scale=1920:1080"));
        assert!(args.contains("-crf 23"));
    }

    #[test]
    fn kullanicinin_sectigi_cozunurluk_ve_fps_seviyenin_yerine_gecer() {
        let limits = Limits {
            max_short_side: Some(360),
            max_fps: Some(15),
        };
        let args = build_args_for_preset("high", &info(1920, 1080, 60.0, 60.0), limits).join(" ");
        assert!(args.contains("-vf scale=640:360,fps=15"), "{args}");
        assert!(args.contains("-crf 23"), "kalite seviyesi korunur: {args}");
        // Seçilen değer kaynaktan büyükse büyütülmez.
        let big = Limits {
            max_short_side: Some(1080),
            max_fps: None,
        };
        let args = build_args_for_preset("tiny", &info(1280, 720, 30.0, 60.0), big);
        assert!(!args.join(" ").contains("scale="), "{args:?}");
    }

    #[test]
    fn hedef_boyutta_secilen_sinirlar_uygulanir() {
        let limits = Limits {
            max_short_side: Some(480),
            max_fps: Some(24),
        };
        let args =
            build_args_for_target_size(50 * 1024 * 1024, &info(1920, 1080, 60.0, 60.0), limits)
                .join(" ");
        assert!(args.contains("-vf scale=854:480,fps=24"), "{args}");
        // Seçim yoksa hedef boyut modu 30 fps ile sınırlar.
        let args = build_args_for_target_size(
            50 * 1024 * 1024,
            &info(1920, 1080, 60.0, 60.0),
            Limits::default(),
        )
        .join(" ");
        assert!(args.contains("fps=30"), "{args}");
    }

    #[test]
    fn hedef_boyut_butceye_gore_cozunurluk_secer() {
        // 5 dakikalık video 10 MB'a: ~250 kbps → 360p, düşük ses bit hızı.
        let tight = target_plan(10 * 1024 * 1024, 300.0);
        assert_eq!(tight.max_short_side, 360);
        assert_eq!(tight.audio_kbps, 64);
        // 1 dakikalık video 50 MB'a: bol bütçe → 1080p.
        let roomy = target_plan(50 * 1024 * 1024, 60.0);
        assert_eq!(roomy.max_short_side, 1080);
        assert_eq!(roomy.audio_kbps, 128);
    }

    #[test]
    fn hedef_boyut_asilmasin_diye_pay_birakilir() {
        let plan = target_plan(10 * 1024 * 1024, 60.0);
        let total_bytes = (plan.video_kbps + plan.audio_kbps) as f64 * 1000.0 / 8.0 * 60.0;
        assert!(total_bytes < 10.0 * 1024.0 * 1024.0);
    }

    #[test]
    fn cok_kucuk_hedef_alt_sinira_takilir() {
        assert_eq!(
            target_plan(100_000, 3600.0).video_kbps,
            MIN_VIDEO_BITRATE_KBPS
        );
    }
}
