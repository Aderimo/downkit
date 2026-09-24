/// URL'nin host'undan desteklenen platform anahtarını çıkarır — frontend'deki
/// `lib/validation.ts` ile aynı host listesi, iki tarafın da aynı platform
/// isimlerini üretmesi için kasıtlı olarak burada tekrarlanıyor.
pub fn detect_platform(url: &str) -> Option<&'static str> {
    let host = url::Url::parse(url).ok()?.host_str()?.to_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host);

    let table: &[(&str, &[&str])] = &[
        ("youtube", &["youtube.com", "youtu.be"]),
        ("tiktok", &["tiktok.com"]),
        ("instagram", &["instagram.com"]),
        ("x", &["x.com", "twitter.com"]),
        ("reddit", &["reddit.com"]),
        ("facebook", &["facebook.com", "fb.watch"]),
        ("twitch", &["twitch.tv"]),
        ("kick", &["kick.com"]),
        ("vimeo", &["vimeo.com"]),
        ("dailymotion", &["dailymotion.com"]),
        ("pinterest", &["pinterest.com", "pin.it"]),
    ];

    for (platform, hosts) in table {
        for allowed in *hosts {
            if host == *allowed || host.ends_with(&format!(".{allowed}")) {
                return Some(platform);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kick_linkleri_taninir() {
        assert_eq!(detect_platform("https://kick.com/xqc"), Some("kick"));
        assert_eq!(
            detect_platform("https://www.kick.com/xqc/clips/clip_1"),
            Some("kick")
        );
        assert_eq!(detect_platform("https://notkick.com/xqc"), None);
    }

    #[test]
    fn alt_alan_adi_eslesir_benzer_ad_eslesmez() {
        assert_eq!(
            detect_platform("https://m.youtube.com/watch?v=a"),
            Some("youtube")
        );
        assert_eq!(detect_platform("https://notyoutube.com/watch?v=a"), None);
    }
}
