//! Klip dönüşümü: konum, ölçek, döndürme ve saydamlık; her biri sabit ya da anahtar
//! karelerle zamana bağlı. Formüller arayüzdeki `lib/clipTransform.ts` ile aynıdır:
//! önizlemede CSS ile görülen kare dışa aktarımda da aynı çıkar.
//!
//! Anahtar kare zamanları parçanın kendi çıktı saniyesidir (`t`); arayüz kaynak
//! saniyesinden çevirip gönderir. İki kullanım vardır:
//! - zincir içi (`chain_steps`): klip kendi karesinde siyah zemin üstünde dönüşür,
//! - bindirme (`overlay_steps` + `overlay_xy`): üst izdeki klip saydam zeminle alttaki
//!   görüntünün üstüne biner.

/// İki anahtar kare arasındaki geçiş eğrisi (bir sonraki kareye doğru).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Curve {
    #[default]
    Linear,
    /// Yumuşak başla, yumuşak bitir.
    Ease,
    EaseIn,
    EaseOut,
    /// Bir sonraki kareye kadar sabit kalır, sonra atlar.
    Hold,
}

#[derive(Debug, Clone, Copy, PartialEq, serde::Deserialize)]
pub struct Key {
    pub t: f64,
    pub v: f64,
    #[serde(default)]
    pub ease: Curve,
}

#[derive(Debug, Clone, Default, PartialEq, serde::Deserialize)]
pub struct Keys {
    #[serde(default)]
    pub x: Vec<Key>,
    #[serde(default)]
    pub y: Vec<Key>,
    #[serde(default)]
    pub scale: Vec<Key>,
    #[serde(default)]
    pub rotation: Vec<Key>,
    #[serde(default)]
    pub opacity: Vec<Key>,
}

#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transform {
    /// Merkezin kaydırılması: tuvalin genişliğinin / yüksekliğinin oranı (0 = ortada).
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    /// 1 = olduğu gibi.
    #[serde(default = "one")]
    pub scale: f64,
    /// Derece, saat yönünde.
    #[serde(default)]
    pub rotation: f64,
    #[serde(default = "one")]
    pub opacity: f64,
    #[serde(default)]
    pub keys: Keys,
}

fn one() -> f64 {
    1.0
}

impl Default for Transform {
    fn default() -> Self {
        Transform {
            x: 0.0,
            y: 0.0,
            scale: 1.0,
            rotation: 0.0,
            opacity: 1.0,
            keys: Keys::default(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Prop {
    X,
    Y,
    Scale,
    Rotation,
    Opacity,
}

/// Bir özellikte en fazla bu kadar anahtar kare (ifade kısa kalsın).
const MAX_KEYS: usize = 64;

impl Prop {
    fn limits(self) -> (f64, f64, f64) {
        // (en az, en çok, varsayılan)
        match self {
            Prop::X | Prop::Y => (-2.0, 2.0, 0.0),
            Prop::Scale => (0.1, 3.0, 1.0),
            Prop::Rotation => (-360.0, 360.0, 0.0),
            Prop::Opacity => (0.0, 1.0, 1.0),
        }
    }

    fn clamp(self, v: f64) -> f64 {
        let (lo, hi, default) = self.limits();
        if v.is_finite() {
            v.clamp(lo, hi)
        } else {
            default
        }
    }
}

fn n(value: f64) -> String {
    let text = format!("{value:.5}");
    let text = text.trim_end_matches('0').trim_end_matches('.');
    if text == "-0" {
        "0".into()
    } else {
        text.to_string()
    }
}

fn even(v: f64) -> u32 {
    let v = v.ceil().max(2.0) as u32;
    v + (v & 1)
}

impl Transform {
    fn base(&self, prop: Prop) -> f64 {
        prop.clamp(match prop {
            Prop::X => self.x,
            Prop::Y => self.y,
            Prop::Scale => self.scale,
            Prop::Rotation => self.rotation,
            Prop::Opacity => self.opacity,
        })
    }

    /// Geçerli, sıralı anahtar kareler.
    fn keys(&self, prop: Prop) -> Vec<Key> {
        let raw = match prop {
            Prop::X => &self.keys.x,
            Prop::Y => &self.keys.y,
            Prop::Scale => &self.keys.scale,
            Prop::Rotation => &self.keys.rotation,
            Prop::Opacity => &self.keys.opacity,
        };
        let mut keys: Vec<Key> = raw
            .iter()
            .filter(|k| k.t.is_finite() && k.v.is_finite())
            .map(|k| Key {
                v: prop.clamp(k.v),
                ..*k
            })
            .collect();
        keys.sort_by(|a, b| a.t.total_cmp(&b.t));
        keys.dedup_by(|b, a| (b.t - a.t).abs() < 1e-4);
        keys.truncate(MAX_KEYS);
        keys
    }

    /// Özelliğin aldığı en küçük ve en büyük değer (eğriler aşmaz: uçlar karelerdedir).
    fn range(&self, prop: Prop) -> (f64, f64) {
        let keys = self.keys(prop);
        if keys.is_empty() {
            let v = self.base(prop);
            return (v, v);
        }
        keys.iter().fold((f64::MAX, f64::MIN), |(lo, hi), k| {
            (lo.min(k.v), hi.max(k.v))
        })
    }

    fn constant(&self, prop: Prop, value: f64) -> bool {
        let (lo, hi) = self.range(prop);
        (lo - value).abs() < 1e-6 && (hi - value).abs() < 1e-6
    }

    /// Dönüşüm görüntüyü değiştirmiyor.
    pub fn is_identity(&self) -> bool {
        [Prop::X, Prop::Y, Prop::Rotation]
            .into_iter()
            .all(|p| self.constant(p, 0.0))
            && self.constant(Prop::Scale, 1.0)
            && self.constant(Prop::Opacity, 1.0)
    }

    /// Özelliğin `var` zamanındaki değeri (FFmpeg ifadesi).
    pub fn expr(&self, prop: Prop, var: &str) -> String {
        let keys = self.keys(prop);
        match keys.len() {
            0 => return n(self.base(prop)),
            1 => return n(keys[0].v),
            _ => {}
        }
        let mut e = n(keys[keys.len() - 1].v);
        for i in (0..keys.len() - 1).rev() {
            let (a, b) = (keys[i], keys[i + 1]);
            let seg = if a.ease == Curve::Hold || (b.v - a.v).abs() < 1e-9 {
                n(a.v)
            } else {
                let p = format!("clip(({var}-{})/{},0,1)", n(a.t), n((b.t - a.t).max(1e-3)));
                let curve = match a.ease {
                    Curve::Linear | Curve::Hold => p,
                    Curve::Ease => format!("({p}*{p}*(3-2*{p}))"),
                    Curve::EaseIn => format!("({p}*{p})"),
                    Curve::EaseOut => format!("({p}*(2-{p}))"),
                };
                format!("({}+({})*{curve})", n(a.v), n(b.v - a.v))
            };
            e = format!("if(lt({var},{}),{seg},{e})", n(b.t));
        }
        format!("if(lt({var},{}),{},{e})", n(keys[0].t), n(keys[0].v))
    }

    fn rotates(&self) -> bool {
        !self.constant(Prop::Rotation, 0.0)
    }

    /// Döndürme için içeriğin oturduğu tuval: köşeler kesilmesin diye köşegen kadar.
    fn rotated_size(&self, w: u32, h: u32) -> (u32, u32) {
        if self.rotates() {
            let d = even((w as f64).hypot(h as f64));
            (d, d)
        } else {
            (w, h)
        }
    }

    fn rotate_step(&self, w: u32, h: u32, fill: &str) -> Option<String> {
        if !self.rotates() {
            return None;
        }
        let (dw, dh) = self.rotated_size(w, h);
        Some(format!(
            "rotate=a='({})*PI/180':ow={dw}:oh={dh}:c={fill}",
            self.expr(Prop::Rotation, "t")
        ))
    }

    fn scale_step(&self) -> Option<String> {
        if self.constant(Prop::Scale, 1.0) {
            return None;
        }
        let s = self.expr(Prop::Scale, "t");
        Some(format!(
            "scale=w='2*ceil(iw*({s})/2)':h='2*ceil(ih*({s})/2)':eval=frame"
        ))
    }

    /// Zincir içi: `w`×`h` boyutundaki klip kendi karesinde, siyah zemin üstünde dönüşür.
    pub fn chain_steps(&self, w: u32, h: u32) -> Vec<String> {
        if self.is_identity() || w < 16 || h < 16 {
            return Vec::new();
        }
        let (fw, fh) = (w as f64, h as f64);
        let (dw, dh) = self.rotated_size(w, h);
        let (_, smax) = self.range(Prop::Scale);
        let (xmin, xmax) = self.range(Prop::X);
        let (ymin, ymax) = self.range(Prop::Y);
        // Sabit tuval: içerik ortasında; kırpma penceresi kaydırmanın her değerinde içinde kalır.
        let pw = even(
            (fw * (1.0 + 2.0 * xmax))
                .max(fw * (1.0 - 2.0 * xmin))
                .max(smax * dw as f64),
        );
        let ph = even(
            (fh * (1.0 + 2.0 * ymax))
                .max(fh * (1.0 - 2.0 * ymin))
                .max(smax * dh as f64),
        );
        let mut steps: Vec<String> = Vec::new();
        steps.extend(self.rotate_step(w, h, "black"));
        steps.extend(self.scale_step());
        steps.push(format!(
            "pad=w={pw}:h={ph}:x='(ow-iw)/2':y='(oh-ih)/2':color=black:eval=frame"
        ));
        steps.push(format!(
            "crop={w}:{h}:x='{}-({})*{w}':y='{}-({})*{h}'",
            n((pw - w) as f64 / 2.0),
            self.expr(Prop::X, "t"),
            n((ph - h) as f64 / 2.0),
            self.expr(Prop::Y, "t"),
        ));
        if !self.constant(Prop::Opacity, 1.0) {
            // Siyah zemin üstünde saydamlık: parlaklık ve doygunluk oranla iner.
            let a = self.expr(Prop::Opacity, "t");
            steps.push(format!(
                "eq=contrast='{a}':brightness='0.5*(({a})-1)':saturation='{a}':eval=frame"
            ));
        }
        steps
    }

    /// Bindirme: `w`×`h` boyutundaki (alfa kanallı) içerik döndürülür, ölçeklenir ve
    /// saydamlığı uygulanır. Kare boyutu sabit kalır (ölçeğin en büyüğüne göre).
    pub fn overlay_steps(&self, w: u32, h: u32) -> Vec<String> {
        let mut steps: Vec<String> = Vec::new();
        if w < 16 || h < 16 {
            return steps;
        }
        steps.extend(self.rotate_step(w, h, "none"));
        if let Some(scale) = self.scale_step() {
            let (dw, dh) = self.rotated_size(w, h);
            let (_, smax) = self.range(Prop::Scale);
            steps.push(scale);
            steps.push(format!(
                "pad=w={}:h={}:x='(ow-iw)/2':y='(oh-ih)/2':color=black@0:eval=frame",
                even(smax * dw as f64),
                even(smax * dh as f64)
            ));
        }
        if self.keys(Prop::Opacity).len() > 1 {
            steps.push(format!(
                "geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='alpha(X,Y)*({})'",
                self.expr(Prop::Opacity, "T")
            ));
        } else {
            let (a, _) = self.range(Prop::Opacity);
            if a < 1.0 - 1e-6 {
                steps.push(format!("lutyuv=a='val*{}'", n(a)));
            }
        }
        steps
    }

    /// Bindirmenin konumu (overlay filtresinin x/y ifadeleri): `var` bindirmenin kendi
    /// zamanı (ör. `(t-2.5)`).
    pub fn overlay_xy(&self, var: &str) -> (String, String) {
        (
            format!("W/2+({})*W-w/2", self.expr(Prop::X, var)),
            format!("H/2+({})*H-h/2", self.expr(Prop::Y, var)),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(t: f64, v: f64, ease: Curve) -> Key {
        Key { t, v, ease }
    }

    #[test]
    fn varsayilan_donusum_filtre_uretmez() {
        let tr = Transform::default();
        assert!(tr.is_identity());
        assert!(tr.chain_steps(1920, 1080).is_empty());
        assert!(tr.overlay_steps(640, 360).is_empty());
    }

    #[test]
    fn anahtar_kareler_parcali_ifade_olur() {
        let tr = Transform {
            keys: Keys {
                scale: vec![
                    key(2.0, 2.0, Curve::Linear),
                    key(0.0, 1.0, Curve::Ease),
                    key(3.0, 1.5, Curve::Hold),
                ],
                ..Keys::default()
            },
            ..Transform::default()
        };
        assert_eq!(
            tr.expr(Prop::Scale, "t"),
            "if(lt(t,0),1,if(lt(t,2),(1+(1)*(clip((t-0)/2,0,1)*clip((t-0)/2,0,1)*(3-2*clip((t-0)/2,0,1)))),if(lt(t,3),(2+(-0.5)*clip((t-2)/1,0,1)),1.5)))"
        );
        assert_eq!(tr.range(Prop::Scale), (1.0, 2.0));
        // Tek kare: sabit değer; sınır dışı değer kırpılır.
        let one = Transform {
            keys: Keys {
                opacity: vec![key(1.0, 4.0, Curve::Linear)],
                ..Keys::default()
            },
            ..Transform::default()
        };
        assert_eq!(one.expr(Prop::Opacity, "t"), "1");
    }

    #[test]
    fn zincir_ici_donusum_sabit_tuvalde_kirpar() {
        let tr = Transform {
            x: 0.25,
            scale: 0.5,
            rotation: 30.0,
            opacity: 0.5,
            ..Transform::default()
        };
        let steps = tr.chain_steps(640, 360);
        assert_eq!(steps[0], "rotate=a='(30)*PI/180':ow=736:oh=736:c=black");
        assert_eq!(
            steps[1],
            "scale=w='2*ceil(iw*(0.5)/2)':h='2*ceil(ih*(0.5)/2)':eval=frame"
        );
        // Tuval: kaydırma için 640×1.5 = 960; yükseklik 360.
        assert_eq!(
            steps[2],
            "pad=w=960:h=368:x='(ow-iw)/2':y='(oh-ih)/2':color=black:eval=frame"
        );
        assert_eq!(steps[3], "crop=640:360:x='160-(0.25)*640':y='4-(0)*360'");
        assert!(steps[4].starts_with("eq=contrast='0.5'"));
    }

    #[test]
    fn bindirme_saydam_zeminle_olceklenir_ve_konumlanir() {
        let tr = Transform {
            x: 0.3,
            y: -0.25,
            scale: 0.4,
            opacity: 0.8,
            ..Transform::default()
        };
        let steps = tr.overlay_steps(480, 360);
        assert_eq!(
            steps,
            vec![
                "scale=w='2*ceil(iw*(0.4)/2)':h='2*ceil(ih*(0.4)/2)':eval=frame".to_string(),
                "pad=w=192:h=144:x='(ow-iw)/2':y='(oh-ih)/2':color=black@0:eval=frame".into(),
                "lutyuv=a='val*0.8'".into(),
            ]
        );
        assert_eq!(
            tr.overlay_xy("(t-1)"),
            (
                "W/2+(0.3)*W-w/2".to_string(),
                "H/2+(-0.25)*H-h/2".to_string()
            )
        );
        let faded = Transform {
            keys: Keys {
                opacity: vec![key(0.0, 0.0, Curve::Linear), key(1.0, 1.0, Curve::Linear)],
                ..Keys::default()
            },
            ..Transform::default()
        };
        assert!(faded.overlay_steps(480, 360)[0].starts_with("geq=lum='lum(X,Y)'"));
    }
}
