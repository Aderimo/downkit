//! Klip hareketleri (yakınlaştır, kaydır, sarsıntı…) ve geçiş stilleri (yakınlaştır,
//! bulanık, kaydır, döndür…) için FFmpeg filtreleri.
//!
//! Formüller arayüzdeki `lib/clipFx.ts` ile birebir aynıdır: önizlemede CSS ile
//! görülen hareket dışa aktarımda da aynı çıkar. Hepsi zamana bağlı ifadelerdir
//! (`t` parçanın kendi saniyesi); boyut gerektiren efektler kaynak boyutu
//! bilinmiyorsa atlanır.

/// Klibin süresi boyunca süren hareket.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Motion {
    #[default]
    None,
    ZoomIn,
    ZoomOut,
    PanLeft,
    PanRight,
    KenBurns,
    Shake,
    Pulse,
}

/// Klibin başındaki/sonundaki geçiş stili; süreler `fade_in`/`fade_out`'tan gelir.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Transition {
    /// Siyaha (ya da beyaza) kararma: eski davranış.
    #[default]
    Fade,
    Zoom,
    Blur,
    Slide,
    /// Saat yönünde dönerek girer / çıkar.
    Spin,
    /// Saat yönünün tersine dönerek.
    SpinCcw,
    Whip,
    Glitch,
}

pub const DEFAULT_STRENGTH: f64 = 0.25;

/// Bir parçanın efekt girdileri (çıktı saniyesiyle).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FxInput {
    pub motion: Motion,
    pub strength: f64,
    /// Bu parça klibin kaçıncı saniyesinden başlıyor (üst katman bölmüşse > 0).
    pub offset: f64,
    /// Klibin tam çıktı süresi (hareketin ilerlemesi buna göre).
    pub total: f64,
    pub transition: Transition,
    /// Parçanın süresi ve geçiş süreleri.
    pub duration: f64,
    pub fade_in: f64,
    pub fade_out: f64,
}

fn n(value: f64) -> String {
    let text = format!("{value:.4}");
    text.trim_end_matches('0').trim_end_matches('.').to_string()
}

/// Yumuşak geçiş: 0→1 arası `p` için smoothstep.
fn ease(p: &str) -> String {
    format!("(({p})*({p})*(3-2*({p})))")
}

impl FxInput {
    fn strength(&self) -> f64 {
        if self.strength.is_finite() && self.strength > 0.0 {
            self.strength.clamp(0.05, 0.6)
        } else {
            DEFAULT_STRENGTH
        }
    }

    /// Hareketin ilerlemesi (0–1, klibin tamamına göre).
    fn progress(&self) -> String {
        let total = if self.total > 0.01 {
            self.total
        } else {
            self.duration.max(0.01)
        };
        format!("clip(({}+t)/{},0,1)", n(self.offset.max(0.0)), n(total))
    }

    /// Klibin zamanı (sarsıntı ve nabız için).
    fn clip_time(&self) -> String {
        format!("({}+t)", n(self.offset.max(0.0)))
    }

    fn has_in(&self) -> bool {
        self.fade_in > 0.0
    }

    fn has_out(&self) -> bool {
        self.fade_out > 0.0
    }

    /// Geçişe girişin ilerlemesi: 0 başta, 1 bitince (geçiş yoksa hep 1).
    fn p_in(&self) -> String {
        if self.has_in() {
            format!("clip(t/{},0,1)", n(self.fade_in))
        } else {
            "1".into()
        }
    }

    /// Çıkışın ilerlemesi: 0 çıkış başlamadan, 1 klibin sonunda (yoksa hep 0).
    fn p_out(&self) -> String {
        if self.has_out() {
            let start = (self.duration - self.fade_out).max(0.0);
            format!("clip((t-{})/{},0,1)", n(start), n(self.fade_out))
        } else {
            "0".into()
        }
    }

    /// Geçişin şiddeti: girişte 1→0, çıkışta 0→1 (ikisinin büyüğü).
    fn edge(&self) -> String {
        format!("max(1-{},{})", ease(&self.p_in()), ease(&self.p_out()))
    }

    fn uses_transition(&self) -> bool {
        self.transition != Transition::Fade && (self.has_in() || self.has_out())
    }

    /// Siyah/beyaz kararma uygulanmalı mı (yalnızca "Fade" stilinde).
    pub fn wants_fade(&self) -> bool {
        self.transition == Transition::Fade
    }

    #[cfg(test)]
    pub fn is_active(&self) -> bool {
        self.motion != Motion::None || self.uses_transition()
    }

    /// Ölçek (≥1) ve kırpma merkezinin konumu (0–1).
    fn geometry(&self) -> Option<(String, String, String)> {
        let s = n(self.strength());
        let q = ease(&self.progress());
        let time = self.clip_time();
        let (mut zoom, mut cx, mut cy) = match self.motion {
            Motion::None => ("1".to_string(), "0.5".to_string(), "0.5".to_string()),
            Motion::ZoomIn => (format!("(1+{s}*{q})"), "0.5".into(), "0.5".into()),
            Motion::ZoomOut => (format!("(1+{s}*(1-{q}))"), "0.5".into(), "0.5".into()),
            Motion::PanLeft => (format!("(1+{s})"), format!("(1-{q})"), "0.5".into()),
            Motion::PanRight => (format!("(1+{s})"), q.clone(), "0.5".into()),
            Motion::KenBurns => (
                format!("(1+{s}*{q})"),
                format!("(0.3+0.4*{q})"),
                format!("(0.35+0.3*{q})"),
            ),
            Motion::Shake => (
                format!("(1+{s}*0.5)"),
                format!("(0.5+0.45*sin({time}*31)*cos({time}*7.3))"),
                format!("(0.5+0.45*cos({time}*27)*sin({time}*5.1))"),
            ),
            Motion::Pulse => (
                format!("(1+{s}*0.6*pow(abs(sin(PI*2*{time})),4))"),
                "0.5".into(),
                "0.5".into(),
            ),
        };
        if self.uses_transition() {
            let edge = self.edge();
            match self.transition {
                Transition::Zoom => zoom = format!("{zoom}*(1+0.6*{edge})"),
                Transition::Whip => zoom = format!("{zoom}*(1+1.2*{edge})"),
                Transition::Spin | Transition::SpinCcw => zoom = format!("{zoom}*(1+0.5*{edge})"),
                Transition::Glitch => {
                    let active = self.glitch_active();
                    zoom = format!("{zoom}*1.06");
                    cx = format!("({cx}+0.45*sin(t*90)*{active})");
                    cy = format!("({cy}+0.3*cos(t*70)*{active})");
                }
                _ => {}
            }
        }
        if zoom == "1" && cx == "0.5" && cy == "0.5" {
            return None;
        }
        Some((zoom, format!("clip({cx},0,1)"), format!("clip({cy},0,1)")))
    }

    /// Glitch titreşimi açık mı (geçiş süresince, 0,12 sn'de bir yarım süre).
    fn glitch_active(&self) -> String {
        let start = (self.duration - self.fade_out).max(0.0);
        let window = match (self.has_in(), self.has_out()) {
            (true, true) => format!("max(lt(t,{}),gte(t,{}))", n(self.fade_in), n(start)),
            (true, false) => format!("lt(t,{})", n(self.fade_in)),
            (false, true) => format!("gte(t,{})", n(start)),
            (false, false) => "0".into(),
        };
        format!("{window}*lt(mod(t,0.12),0.06)")
    }

    /// Bulanıklık pencereleri: geçişin ilk üçte birinde güçlü, sonra azalan.
    fn blur_steps(&self, height: u32) -> Vec<String> {
        let strong = (height as f64 * 0.025).clamp(4.0, 60.0);
        let mut steps = Vec::new();
        for (i, radius) in [strong, strong * 0.55, strong * 0.25]
            .into_iter()
            .enumerate()
        {
            let (a, b) = (i as f64 / 3.0, (i as f64 + 1.0) / 3.0);
            let mut parts = Vec::new();
            if self.has_in() {
                parts.push(format!(
                    "between(t,{},{})",
                    n(self.fade_in * a),
                    n(self.fade_in * b)
                ));
            }
            if self.has_out() {
                parts.push(format!(
                    "between(t,{},{})",
                    n(self.duration - self.fade_out * b),
                    n(self.duration - self.fade_out * a)
                ));
            }
            if parts.is_empty() {
                continue;
            }
            steps.push(format!(
                "boxblur=lr={}:lp=1:enable='{}'",
                radius.round() as u32,
                parts.join("+")
            ));
        }
        steps
    }

    /// Görüntü filtreleri; `size` kaynağın (ya da normalize edilmiş) boyutu.
    pub fn steps(&self, size: Option<(u32, u32)>) -> Vec<String> {
        let Some((w, h)) = size.filter(|(w, h)| *w >= 16 && *h >= 16) else {
            return Vec::new();
        };
        let mut steps = Vec::new();
        if let Some((zoom, cx, cy)) = self.geometry() {
            steps.push(format!(
                "scale=w='2*ceil({w}*{zoom}/2)':h='2*ceil({h}*{zoom}/2)':eval=frame"
            ));
            steps.push(format!("crop={w}:{h}:x='(iw-{w})*{cx}':y='(ih-{h})*{cy}'"));
        }
        if !self.uses_transition() {
            return steps;
        }
        match self.transition {
            Transition::Spin | Transition::SpinCcw => {
                // Saat yönünde: girişte −180° → 0, çıkışta 0 → 180°; ters yönde işaret döner.
                let sign = if self.transition == Transition::SpinCcw {
                    "-"
                } else {
                    ""
                };
                let angle = format!(
                    "({sign}(-(1-{})+{})*PI)",
                    ease(&self.p_in()),
                    ease(&self.p_out())
                );
                steps.push(format!("rotate=a='{angle}':c=black"));
            }
            Transition::Slide => {
                // İçerik sağdan girer, sola çıkar: üç kat genişlikte tuvalin ortasında durur.
                let shift = format!("((1-{})-{})", ease(&self.p_in()), ease(&self.p_out()));
                steps.push(format!("pad={}:{h}:{w}:0:black", w * 3));
                steps.push(format!("crop={w}:{h}:x='{w}*(1-{shift})':y=0"));
            }
            Transition::Blur | Transition::Whip => steps.extend(self.blur_steps(h)),
            Transition::Glitch => {
                let shift = (w as f64 * 0.012).round().max(2.0) as i32;
                steps.push(format!(
                    "rgbashift=rh={}:bh={}:enable='{}'",
                    -shift,
                    shift,
                    self.glitch_active()
                ));
            }
            Transition::Zoom | Transition::Fade => {}
        }
        steps
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(motion: Motion, transition: Transition, fade_in: f64, fade_out: f64) -> FxInput {
        FxInput {
            motion,
            strength: 0.25,
            offset: 0.0,
            total: 4.0,
            transition,
            duration: 4.0,
            fade_in,
            fade_out,
        }
    }

    #[test]
    fn efektsiz_klipte_filtre_yok() {
        let fx = input(Motion::None, Transition::Fade, 0.5, 0.5);
        assert!(!fx.is_active());
        assert!(fx.steps(Some((1920, 1080))).is_empty());
    }

    #[test]
    fn yakinlastirma_kare_kare_olcek_ve_kirpma_uretir() {
        let steps = input(Motion::ZoomIn, Transition::Fade, 0.0, 0.0).steps(Some((1920, 1080)));
        assert_eq!(steps.len(), 2);
        assert!(steps[0].starts_with("scale=w='2*ceil(1920*(1+0.25*"));
        assert!(steps[0].ends_with(":eval=frame"));
        assert!(steps[1].starts_with("crop=1920:1080:"));
    }

    #[test]
    fn boyut_bilinmezse_hareket_atlanir() {
        assert!(input(Motion::ZoomIn, Transition::Zoom, 0.5, 0.0)
            .steps(None)
            .is_empty());
    }

    #[test]
    fn gecis_stilleri_kendi_filtresini_ekler() {
        let size = Some((1280, 720));
        let spin = input(Motion::None, Transition::Spin, 0.5, 0.0).steps(size);
        assert!(spin.iter().any(|s| s.starts_with("rotate=")));
        let slide = input(Motion::None, Transition::Slide, 0.0, 0.5).steps(size);
        assert!(slide.iter().any(|s| s == "pad=3840:720:1280:0:black"));
        let blur = input(Motion::None, Transition::Blur, 0.6, 0.6).steps(size);
        assert_eq!(blur.iter().filter(|s| s.starts_with("boxblur")).count(), 3);
        let glitch = input(Motion::None, Transition::Glitch, 0.4, 0.0).steps(size);
        assert!(glitch.iter().any(|s| s.starts_with("rgbashift")));
        assert!(!input(Motion::None, Transition::Zoom, 0.5, 0.0).wants_fade());
    }

    #[test]
    fn gecis_suresi_yoksa_stil_bir_sey_yapmaz() {
        let fx = input(Motion::None, Transition::Spin, 0.0, 0.0);
        assert!(!fx.is_active());
    }
}

#[cfg(test)]
mod print {
    use super::*;

    /// Elle FFmpeg denemesi için: `cargo test fx_yazdir -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn fx_yazdir() {
        let motions = [
            Motion::ZoomIn,
            Motion::ZoomOut,
            Motion::PanLeft,
            Motion::PanRight,
            Motion::KenBurns,
            Motion::Shake,
            Motion::Pulse,
        ];
        let transitions = [
            Transition::Zoom,
            Transition::Blur,
            Transition::Slide,
            Transition::Spin,
            Transition::Whip,
            Transition::Glitch,
        ];
        let base = FxInput {
            motion: Motion::None,
            strength: 0.25,
            offset: 0.0,
            total: 3.0,
            transition: Transition::Fade,
            duration: 3.0,
            fade_in: 0.6,
            fade_out: 0.6,
        };
        for m in motions {
            println!(
                "FX|{m:?}|{}",
                FxInput { motion: m, ..base }
                    .steps(Some((640, 360)))
                    .join(",")
            );
        }
        for t in transitions {
            println!(
                "FX|{t:?}|{}",
                FxInput {
                    transition: t,
                    ..base
                }
                .steps(Some((640, 360)))
                .join(",")
            );
        }
    }
}
