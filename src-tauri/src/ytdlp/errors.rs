/// Tanınan bir hata: arayüz `code` ile kendi dilindeki metni seçer,
/// `message` Türkçe yedektir.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Friendly {
    pub code: &'static str,
    pub message: &'static str,
}

/// (aranacak kalıplar, kod, Türkçe mesaj). Sıra önemlidir: daha özel kalıplar
/// (ör. bot doğrulaması, altyazı kısıtlaması) daha genel olanlardan (ör. "sign in",
/// 429) önce denenir.
const RULES: &[(&[&str], &str, &str)] = &[
    (
        &["not a bot", "confirm you’re not a bot"],
        "botCheck",
        "Platform bot doğrulaması istiyor. Biraz bekleyip tekrar deneyin ya da Ayarlar'dan yt-dlp'yi güncelleyin.",
    ),
    (
        &["drm protected", "drm-protected", "is drm"],
        "drmProtected",
        "Bu içerik DRM korumalı. DownKit DRM korumalı içerikleri indirmez.",
    ),
    (
        &["private video", "video is private"],
        "privateVideo",
        "Bu video gizli; yalnızca sahibinin izin verdiği kişiler izleyebilir.",
    ),
    (
        &["confirm your age", "age-restricted", "inappropriate for some users"],
        "ageRestricted",
        "Bu video yaş sınırlı; oturum açılmadan indirilemez.",
    ),
    (
        &["members-only", "members only", "join this channel", "requires payment", "premium members"],
        "membersOnly",
        "Bu içerik yalnızca üyelere açık. DownKit erişim kısıtlamalarını aşmaz.",
    ),
    (
        &["not available in your country", "blocked it in your country", "geo restrict", "geo-restrict"],
        "geoBlocked",
        "Bu video bulunduğunuz ülkede kullanılamıyor.",
    ),
    // "not currently live" kalıbını da içerdiği için yayın-başlamadı kuralından önce.
    (
        &["channel is not currently live", "channel is offline"],
        "channelOffline",
        "Bu kanal şu an yayında değil. Kanalın geçmiş yayınlarından (VOD) ya da kliplerinden birinin linkini dene.",
    ),
    (
        &["live event will begin", "premieres in", "is not currently live", "this live event"],
        "notLiveYet",
        "Bu yayın henüz başlamadı. Başladıktan sonra tekrar deneyin.",
    ),
    (
        &["unable to download video subtitles"],
        "subtitlesFailed",
        "Altyazılar indirilemedi (platform altyazı isteklerini kısıtladı). \"Altyazıları indir\" seçeneğini kapatıp tekrar deneyin.",
    ),
    (
        &["requested format is not available"],
        "formatUnavailable",
        "Seçilen kalite bu video için yok. \"En iyi kalite\" ile tekrar deneyin.",
    ),
    (
        &["http error 429", "too many requests"],
        "rateLimited",
        "Platform çok fazla istek aldı. Birkaç dakika sonra tekrar deneyin.",
    ),
    (
        &["http error 403"],
        "forbidden",
        "Platform indirmeyi reddetti. Ayarlar'dan yt-dlp'yi güncelleyip tekrar deneyin.",
    ),
    (
        &["video unavailable", "has been removed", "does not exist", "http error 404", "no video formats found"],
        "videoUnavailable",
        "Video bulunamadı: kaldırılmış olabilir ya da bağlantı hatalı.",
    ),
    (&["unsupported url"], "unsupportedUrl", "Bu bağlantı desteklenmiyor."),
    (
        &["no space left", "errno 28"],
        "diskFull",
        "Diskte yeterli boş alan yok. Yer açıp tekrar deneyin.",
    ),
    (
        &["permission denied", "errno 13", "access is denied"],
        "permissionDenied",
        "Kayıt klasörüne yazılamadı. Ayarlar'dan başka bir klasör seçin.",
    ),
    (
        &["ffmpeg not found", "ffprobe and ffmpeg not found"],
        "ffmpegMissing",
        "FFmpeg bulunamadı; video ve ses birleştirilemedi. Uygulamayı yeniden başlatın.",
    ),
    (
        &[
            "unable to download webpage",
            "getaddrinfo failed",
            "name or service not known",
            "timed out",
            "connection reset",
            "connection refused",
            "network is unreachable",
        ],
        "network",
        "Platforma bağlanılamadı. İnternet bağlantınızı kontrol edin.",
    ),
    // Bölüm indirmede yt-dlp akışı ffmpeg'e okutur; ffmpeg'in asıl hatası (çoğunlukla
    // YouTube'un geçici 403'ü) bize ulaşmaz, yalnızca bu satır gelir.
    (
        &["ffmpeg exited with code"],
        "streamInterrupted",
        "Platform bağlantıyı yarıda kesti (çoğunlukla geçicidir). Tekrar deneyin.",
    ),
];

/// yt-dlp'nin bilinen hata çıktılarını kullanıcının anlayacağı açıklamalara çevirir.
/// Tanınmayan hatalarda `None` döner; çağıran genel bir mesaj gösterir ve ham
/// çıktı "Teknik ayrıntılar" altında kalır.
pub fn friendly(stderr: &str) -> Option<Friendly> {
    let text = stderr.to_lowercase();
    RULES
        .iter()
        .find(|(needles, _, _)| needles.iter().any(|n| text.contains(n)))
        .map(|&(_, code, message)| Friendly { code, message })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn code(stderr: &str) -> Option<&'static str> {
        friendly(stderr).map(|f| f.code)
    }

    #[test]
    fn bolum_indirmede_ffmpeg_kopmasi_gecici_sayilir() {
        let stderr = "\n\nERROR: ffmpeg exited with code 3436169992\n";
        assert_eq!(code(stderr), Some("streamInterrupted"));
        // Sebep görünüyorsa daha özel kural kazanır.
        let with_cause = "HTTP error 403 Forbidden\nERROR: ffmpeg exited with code 1";
        assert_eq!(code(with_cause), Some("forbidden"));
    }

    #[test]
    fn gizli_video_taninir() {
        let stderr = "ERROR: [youtube] abc: Private video. Sign in if you've been granted access";
        assert_eq!(code(stderr), Some("privateVideo"));
    }

    #[test]
    fn bot_dogrulamasi_genel_oturum_mesajindan_once_gelir() {
        let stderr = "ERROR: [youtube] abc: Sign in to confirm you're not a bot.";
        assert_eq!(code(stderr), Some("botCheck"));
    }

    #[test]
    fn yas_siniri_taninir() {
        let stderr = "ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users.";
        assert_eq!(code(stderr), Some("ageRestricted"));
    }

    #[test]
    fn kaldirilmis_video_taninir() {
        let stderr =
            "ERROR: [youtube] abc: Video unavailable. This video has been removed by the uploader";
        assert_eq!(code(stderr), Some("videoUnavailable"));
    }

    #[test]
    fn altyazi_kisitlamasi_video_kisitlamasi_sanilmaz() {
        let stderr =
            "ERROR: Unable to download video subtitles for 'en': HTTP Error 429: Too Many Requests";
        let f = friendly(stderr).unwrap();
        assert_eq!(f.code, "subtitlesFailed");
        assert!(f.message.contains("Altyazılar"));
    }

    #[test]
    fn yayinda_olmayan_kanal_taninir() {
        let stderr = "ERROR: [kick:live] xqc: The channel is not currently live";
        assert_eq!(code(stderr), Some("channelOffline"));
    }

    #[test]
    fn baglanti_hatasi_taninir() {
        let stderr = "ERROR: [generic] Unable to download webpage: <urlopen error [Errno 11001] getaddrinfo failed>";
        assert_eq!(code(stderr), Some("network"));
    }

    #[test]
    fn disk_dolu_taninir() {
        let stderr = "ERROR: unable to write data: [Errno 28] No space left on device";
        assert_eq!(code(stderr), Some("diskFull"));
    }

    #[test]
    fn taninmayan_hata_none_doner() {
        assert_eq!(friendly("ERROR: tuhaf bir şey oldu"), None);
        assert_eq!(friendly(""), None);
    }
}
