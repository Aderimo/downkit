//! Klipler arası geçişler: bir klip biterken sonraki klip FFmpeg'in `xfade`
//! filtresiyle (çapraz geçiş, silme, kaydırma, daire…) girer; ses `acrossfade`
//! ile yumuşakça karışır.
//!
//! Ayrı dosya ya da lisans gerekmez: hepsi FFmpeg'in içindedir (saat yönünün
//! tersine dairesel silme FFmpeg'in özel ifadesiyle). Arayüzdeki önizleme
//! (`lib/xfade.ts`) aynı yönleri CSS ile gösterir.

/// Desteklenen geçişler. Adlar FFmpeg'in `xfade=transition=` değerleriyle aynıdır.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum XfadeKind {
    Fade,
    FadeBlack,
    FadeWhite,
    FadeGrays,
    Dissolve,
    WipeLeft,
    WipeRight,
    WipeUp,
    WipeDown,
    SlideLeft,
    SlideRight,
    SlideUp,
    SlideDown,
    SmoothLeft,
    CoverLeft,
    RevealRight,
    CircleOpen,
    CircleClose,
    HorzOpen,
    VertOpen,
    DiagTl,
    /// Saat yönünde dairesel silme (tepeden başlar).
    Radial,
    /// Saat yönünün tersine dairesel silme (FFmpeg'de hazır yok: özel ifade).
    RadialCcw,
    SqueezeH,
    ZoomIn,
    Pixelize,
    HBlur,
    HrSlice,
    HlWind,
    SmoothRight,
    SmoothUp,
    SmoothDown,
    CoverRight,
    CoverUp,
    CoverDown,
    RevealLeft,
    RevealUp,
    RevealDown,
    HorzClose,
    VertClose,
    SqueezeV,
    CircleCrop,
    RectCrop,
    FadeFast,
    FadeSlow,
    /// Işık sızması: geçerken soldan sıcak bir parıltı (özel ifade).
    LightLeak,
    /// Glitch: yatay bantlar kayarak görüntü değişir (özel ifade).
    Glitch,
}

impl XfadeKind {
    /// FFmpeg'deki adı.
    pub fn name(self) -> &'static str {
        match self {
            XfadeKind::Fade => "fade",
            XfadeKind::FadeBlack => "fadeblack",
            XfadeKind::FadeWhite => "fadewhite",
            XfadeKind::FadeGrays => "fadegrays",
            XfadeKind::Dissolve => "dissolve",
            XfadeKind::WipeLeft => "wipeleft",
            XfadeKind::WipeRight => "wiperight",
            XfadeKind::WipeUp => "wipeup",
            XfadeKind::WipeDown => "wipedown",
            XfadeKind::SlideLeft => "slideleft",
            XfadeKind::SlideRight => "slideright",
            XfadeKind::SlideUp => "slideup",
            XfadeKind::SlideDown => "slidedown",
            XfadeKind::SmoothLeft => "smoothleft",
            XfadeKind::CoverLeft => "coverleft",
            XfadeKind::RevealRight => "revealright",
            XfadeKind::CircleOpen => "circleopen",
            XfadeKind::CircleClose => "circleclose",
            XfadeKind::HorzOpen => "horzopen",
            XfadeKind::VertOpen => "vertopen",
            XfadeKind::DiagTl => "diagtl",
            XfadeKind::Radial => "radial",
            XfadeKind::RadialCcw => "custom",
            XfadeKind::SqueezeH => "squeezeh",
            XfadeKind::ZoomIn => "zoomin",
            XfadeKind::Pixelize => "pixelize",
            XfadeKind::HBlur => "hblur",
            XfadeKind::HrSlice => "hrslice",
            XfadeKind::HlWind => "hlwind",
            XfadeKind::SmoothRight => "smoothright",
            XfadeKind::SmoothUp => "smoothup",
            XfadeKind::SmoothDown => "smoothdown",
            XfadeKind::CoverRight => "coverright",
            XfadeKind::CoverUp => "coverup",
            XfadeKind::CoverDown => "coverdown",
            XfadeKind::RevealLeft => "revealleft",
            XfadeKind::RevealUp => "revealup",
            XfadeKind::RevealDown => "revealdown",
            XfadeKind::HorzClose => "horzclose",
            XfadeKind::VertClose => "vertclose",
            XfadeKind::SqueezeV => "squeezev",
            XfadeKind::CircleCrop => "circlecrop",
            XfadeKind::RectCrop => "rectcrop",
            XfadeKind::FadeFast => "fadefast",
            XfadeKind::FadeSlow => "fadeslow",
            XfadeKind::LightLeak => "custom",
            XfadeKind::Glitch => "custom",
        }
    }

    /// `xfade=transition=` değeri (özel geçişte ifadesiyle birlikte).
    pub fn transition(self) -> String {
        match self {
            // B, tepeden başlayıp saat yönünün tersine açılan dilimde görünür (P: 1 → 0).
            XfadeKind::RadialCcw => {
                "custom:expr='if(lt(mod(atan2(W/2-X,H/2-Y)+2*PI,2*PI),(1-P)*2*PI),B,A)'".into()
            }
            // B, A'nın üstüne karışırken soldan sıcak parıltı yükselip söner (YUV düzlemleri).
            XfadeKind::LightLeak => "custom:expr='clip(A*P+B*(1-P)+if(eq(PLANE,0),90,if(eq(PLANE,1),-22,26))*sin(PI*P)*(1-X/W*0.6),0,255)'".into(),
            // Ortada görüntü değişir; o sırada yatay bantlar yana kayar.
            XfadeKind::Glitch => "custom:expr='if(gt(P,0.5),if(eq(PLANE,0),a0(X+if(lt(mod(floor(Y/24)*7+floor(P*30),5),2),40*sin(PI*P),0),Y),if(eq(PLANE,1),a1(X+if(lt(mod(floor(Y/12)*7+floor(P*30),5),2),20*sin(PI*P),0),Y),a2(X+if(lt(mod(floor(Y/12)*7+floor(P*30),5),2),20*sin(PI*P),0),Y))),if(eq(PLANE,0),b0(X-if(lt(mod(floor(Y/24)*7+floor(P*30),5),2),40*sin(PI*P),0),Y),if(eq(PLANE,1),b1(X-if(lt(mod(floor(Y/12)*7+floor(P*30),5),2),20*sin(PI*P),0),Y),b2(X-if(lt(mod(floor(Y/12)*7+floor(P*30),5),2),20*sin(PI*P),0),Y))))'".into(),
            other => other.name().into(),
        }
    }
}

/// Bir klipten sonrakine geçiş ve süresi (çıktı saniyesi). Süre kesimin iki
/// yanından yarı yarıya alınır: zaman çizelgesindeki toplam süre değişmez.
#[derive(Debug, Clone, Copy, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Xfade {
    pub kind: XfadeKind,
    pub duration: f64,
}

pub const MIN_SECONDS: f64 = 0.1;
pub const MAX_SECONDS: f64 = 3.0;

impl Xfade {
    /// Geçerli süre; sayı değilse 0 (geçiş yok).
    pub fn seconds(&self) -> f64 {
        if self.duration.is_finite() {
            self.duration.clamp(0.0, MAX_SECONDS)
        } else {
            0.0
        }
    }
}

/// `xfade` iki girişin aynı kare hızında ve zaman tabanında olmasını ister;
/// hızlandırılmış (setpts) parçalar da böylece aynı akışa oturur.
pub fn normalize_step(fps: u32) -> String {
    format!("fps={},format=yuv420p,settb=AVTB", fps.clamp(10, 120))
}

/// Görüntüde iki akışı birleştiren adım: geçiş ya da düz ekleme.
pub fn video_join(
    from: &str,
    next: &str,
    xfade: Option<(XfadeKind, f64)>,
    offset: f64,
    to: &str,
) -> String {
    match xfade {
        Some((kind, d)) => format!(
            "{from}{next}xfade=transition={}:duration={}:offset={}{to}",
            kind.transition(),
            num(d),
            num(offset.max(0.0))
        ),
        None => format!("{from}{next}concat=n=2:v=1:a=0{to}"),
    }
}

/// Seste aynı adım: geçişte iki ses üçgen eğriyle karışır.
pub fn audio_join(from: &str, next: &str, seconds: Option<f64>, to: &str) -> String {
    match seconds {
        Some(d) => format!("{from}{next}acrossfade=d={}:c1=tri:c2=tri{to}", num(d)),
        None => format!("{from}{next}concat=n=2:v=0:a=1{to}"),
    }
}

fn num(value: f64) -> String {
    let text = format!("{value:.4}");
    text.trim_end_matches('0').trim_end_matches('.').to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adlar_ffmpeg_ile_ayni() {
        let kind: XfadeKind = serde_json::from_str("\"wipeleft\"").unwrap();
        assert_eq!(kind, XfadeKind::WipeLeft);
        assert_eq!(kind.name(), "wipeleft");
        let x: Xfade = serde_json::from_str(r#"{"kind":"circleopen","duration":0.8}"#).unwrap();
        assert_eq!(x.kind.name(), "circleopen");
        assert!((x.seconds() - 0.8).abs() < 1e-9);
    }

    #[test]
    fn ters_yonlu_dairesel_silme_ozel_ifadeyle() {
        let kind: XfadeKind = serde_json::from_str("\"radialccw\"").unwrap();
        assert_eq!(kind, XfadeKind::RadialCcw);
        let join = video_join("[a]", "[b]", Some((kind, 1.0)), 2.0, "[c]");
        assert!(
            join.starts_with("[a][b]xfade=transition=custom:expr='if(lt(mod(atan2("),
            "{join}"
        );
        assert!(join.ends_with(":duration=1:offset=2[c]"), "{join}");
    }

    #[test]
    fn yeni_gecisler_ffmpeg_adiyla_ya_da_ozel_ifadeyle() {
        for (json, name) in [
            ("smoothright", "smoothright"),
            ("coverdown", "coverdown"),
            ("revealup", "revealup"),
            ("circlecrop", "circlecrop"),
            ("fadeslow", "fadeslow"),
        ] {
            let kind: XfadeKind = serde_json::from_str(&format!("\"{json}\"")).unwrap();
            assert_eq!(kind.transition(), name);
        }
        let leak: XfadeKind = serde_json::from_str("\"lightleak\"").unwrap();
        assert!(leak
            .transition()
            .starts_with("custom:expr='clip(A*P+B*(1-P)"));
        let glitch: XfadeKind = serde_json::from_str("\"glitch\"").unwrap();
        assert!(glitch.transition().contains("a0(X+if(lt(mod(floor(Y/24)"));
    }

    #[test]
    fn sure_sinirlanir() {
        let x = Xfade {
            kind: XfadeKind::Fade,
            duration: 10.0,
        };
        assert_eq!(x.seconds(), MAX_SECONDS);
        let bad = Xfade {
            kind: XfadeKind::Fade,
            duration: f64::NAN,
        };
        assert_eq!(bad.seconds(), 0.0);
    }

    #[test]
    fn birlestirme_adimlari() {
        assert_eq!(
            video_join(
                "[v0]",
                "[v1]",
                Some((XfadeKind::SlideLeft, 0.8)),
                4.6,
                "[x1]"
            ),
            "[v0][v1]xfade=transition=slideleft:duration=0.8:offset=4.6[x1]"
        );
        assert_eq!(
            video_join("[x1]", "[v2]", None, 0.0, "[x2]"),
            "[x1][v2]concat=n=2:v=1:a=0[x2]"
        );
        assert_eq!(
            audio_join("[a0]", "[a1]", Some(0.8), "[y1]"),
            "[a0][a1]acrossfade=d=0.8:c1=tri:c2=tri[y1]"
        );
    }
}
