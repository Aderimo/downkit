//! Hareketli başlıklar: EffectCraft'ın hazır şablonları (MIT OR Apache-2.0,
//! https://github.com/storytold/effectcraft) kare kare çizilir.
//!
//! Şablonun "Essential Graphics" denetimlerinden metin ve renk olanlar dışarı
//! açılır; kullanıcı bunları değiştirir. Arka plan katmanları ("Background" adlı)
//! istenirse atılır: kalan kare saydamdır, videonun üstüne bindirilir.

use effectcraft_engine::render::render_frame;
use effectcraft_engine::templates::{build_builtin, main_comp};
use effectcraft_keyframe::Value;
use effectcraft_project::essential::EgKind;
use effectcraft_project::{ItemId, LayerId, Project, Uid};
use effectcraft_time::Tick;
use serde::{Deserialize, Serialize};

/// Kullanılan şablonlar. "slideshow" fotoğraf ister, alınmadı.
pub const TEMPLATE_IDS: [&str; 7] = [
    "lower-third",
    "title-card",
    "logo-reveal",
    "kinetic-type",
    "social-square",
    "vertical-story",
    "text-orbit-3d",
];
/// Dışa aktarılan videonun kare hızı (şablonlar 30 kare/sn).
pub const FPS: u32 = 30;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ControlKind {
    Text,
    Color,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MotionControl {
    pub name: String,
    pub kind: ControlKind,
    /// Metin ya da `#rrggbb`.
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MotionTemplate {
    pub id: String,
    pub width: u32,
    pub height: u32,
    pub duration: f64,
    pub controls: Vec<MotionControl>,
}

/// Kullanıcının seçimi: şablon, denetim değerleri (sırayla) ve arka plan.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MotionSpec {
    pub template: String,
    #[serde(default)]
    pub values: Vec<String>,
    #[serde(default)]
    pub background: bool,
}

/// Hazır şablon: proje ve ana kompozisyonu.
pub struct Built {
    pub project: Project,
    pub comp: ItemId,
}

fn hex(c: [f64; 4]) -> String {
    let b = |v: f64| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
    format!("#{:02x}{:02x}{:02x}", b(c[0]), b(c[1]), b(c[2]))
}

fn parse_hex(s: &str) -> Option<[f64; 3]> {
    let s = s.trim().trim_start_matches('#');
    if s.len() != 6 {
        return None;
    }
    let p = |i: usize| {
        u8::from_str_radix(&s[i..i + 2], 16)
            .ok()
            .map(|v| v as f64 / 255.0)
    };
    Some([p(0)?, p(2)?, p(4)?])
}

/// Ana kompozisyonun metin ve renk denetimleri: (katman, özellik) ve görünen bilgi.
fn controls(project: &Project, comp: ItemId) -> Vec<(LayerId, Uid, MotionControl)> {
    let Some(c) = project.comp(comp) else {
        return vec![];
    };
    let Some(eg) = c.essential.as_ref() else {
        return vec![];
    };
    eg.flat()
        .into_iter()
        .filter_map(|control| {
            let EgKind::Property { layer, prop, .. } = &control.kind else {
                return None;
            };
            let value = c.layer(*layer)?.props.find(*prop)?.value.clone();
            let (kind, value) = match value {
                Value::Text(doc) => (ControlKind::Text, doc.text.clone()),
                Value::Color(rgba) => (ControlKind::Color, hex(rgba)),
                _ => return None,
            };
            Some((
                *layer,
                *prop,
                MotionControl {
                    name: control.name.clone(),
                    kind,
                    value,
                },
            ))
        })
        .collect()
}

/// Kullanıcının Lottie dosyası: şablon adı bu, `values[0]` dosya yolu.
pub const LOTTIE: &str = "lottie";
/// Lottie dosyası en çok bu kadar olabilir.
const LOTTIE_MAX_BYTES: u64 = 20 * 1024 * 1024;

pub fn is_known(id: &str) -> bool {
    id == LOTTIE || TEMPLATE_IDS.contains(&id)
}

/// Lottie (.json) animasyonunu yeni bir kompozisyona aktarır. Gömülü resimler
/// alınmaz (vektör çizimler çizilir).
fn build_lottie(spec: &MotionSpec) -> Result<Built, String> {
    let path = spec.values.first().ok_or("Lottie dosyası seçilmedi")?;
    let file = std::path::Path::new(path);
    let ext = file
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase());
    if ext.as_deref() != Some("json") {
        return Err("yalnız .json Lottie dosyaları açılır".into());
    }
    let size = std::fs::metadata(file).map_err(|e| e.to_string())?.len();
    if size > LOTTIE_MAX_BYTES {
        return Err("Lottie dosyası çok büyük".into());
    }
    let bytes = std::fs::read(file).map_err(|e| e.to_string())?;
    let mut project = Project::default();
    let mut skip = |_: &effectcraft_lottie::ImportedImage| None;
    let result = effectcraft_lottie::import(&mut project, &bytes, "Lottie", "", &mut skip)
        .map_err(|e| e.to_string())?;
    Ok(Built {
        project,
        comp: result.comp,
    })
}

/// Şablonu kurar, değerleri uygular, istenirse arka planı atar.
pub fn build(spec: &MotionSpec) -> Result<Built, String> {
    if !is_known(&spec.template) {
        return Err(format!("bilinmeyen şablon: {}", spec.template));
    }
    if spec.template == LOTTIE {
        return build_lottie(spec);
    }
    let mut project = build_builtin(&spec.template).map_err(|e| e.to_string())?;
    let comp = main_comp(&project).ok_or("şablonda kompozisyon yok")?;
    let found = controls(&project, comp);
    let c = project.comp_mut(comp).ok_or("şablonda kompozisyon yok")?;
    for ((layer, prop, control), value) in found.iter().zip(&spec.values) {
        let Some(p) = c.layer_mut(*layer).and_then(|l| l.props.find_mut(*prop)) else {
            continue;
        };
        match (control.kind, &mut p.value) {
            (ControlKind::Text, Value::Text(doc)) => {
                // Uzun metin şablonu bozmasın.
                let text: String = value.chars().take(120).collect();
                doc.set_text(&text);
            }
            (ControlKind::Color, Value::Color(rgba)) => {
                if let Some([r, g, b]) = parse_hex(value) {
                    *rgba = [r, g, b, rgba[3]];
                }
            }
            _ => {}
        }
    }
    if !spec.background {
        c.layers
            .retain(|l| !l.name.to_ascii_lowercase().contains("background"));
    }
    // Denetimi olmayan sabit yazılar (ör. 3B şablondaki "in three dimensions")
    // değiştirilemez ve hep İngilizce kalır: atılır.
    let editable: Vec<LayerId> = found
        .iter()
        .filter(|(_, _, m)| m.kind == ControlKind::Text)
        .map(|(l, _, _)| *l)
        .collect();
    c.layers
        .retain(|l| l.props.prop("text/sourceText").is_none() || editable.contains(&l.id));
    Ok(Built { project, comp })
}

/// Şablonların listesi (denetimlerin varsayılan değerleriyle).
pub fn templates() -> Vec<MotionTemplate> {
    TEMPLATE_IDS
        .iter()
        .filter_map(|id| {
            let project = build_builtin(id).ok()?;
            let comp = main_comp(&project)?;
            let c = project.comp(comp)?;
            Some(MotionTemplate {
                id: (*id).to_string(),
                width: c.width,
                height: c.height,
                duration: c.duration.seconds(),
                controls: controls(&project, comp)
                    .into_iter()
                    .map(|(_, _, m)| m)
                    .collect(),
            })
        })
        .collect()
}

impl Built {
    pub fn size(&self) -> (u32, u32) {
        self.project
            .comp(self.comp)
            .map(|c| (c.width, c.height))
            .unwrap_or((0, 0))
    }

    pub fn duration(&self) -> f64 {
        self.project
            .comp(self.comp)
            .map(|c| c.duration.seconds())
            .unwrap_or(0.0)
    }

    /// `time` anındaki kare: RGBA (düz, ön çarpımsız), boyutlar.
    pub fn frame(&self, time: f64, scale: f64) -> (Vec<u8>, u32, u32) {
        let image = render_frame(
            &self.project,
            self.comp,
            Tick::from_seconds_f64(time.max(0.0)),
            scale,
        );
        (image.to_rgba8(), image.width, image.height)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(id: &str, values: &[&str], background: bool) -> MotionSpec {
        MotionSpec {
            template: id.into(),
            values: values.iter().map(|v| v.to_string()).collect(),
            background,
        }
    }

    #[test]
    fn sablonlarin_hepsi_kurulur_ve_metin_denetimi_vardir() {
        let list = templates();
        assert_eq!(list.len(), TEMPLATE_IDS.len());
        for t in &list {
            assert!(t.width > 0 && t.height > 0 && t.duration > 0.0, "{}", t.id);
            assert!(
                t.controls.iter().any(|c| c.kind == ControlKind::Text),
                "{} metinsiz",
                t.id
            );
        }
        let lower = list.iter().find(|t| t.id == "lower-third").unwrap();
        assert!(lower.controls.iter().any(|c| c.kind == ControlKind::Color));
    }

    #[test]
    fn degerler_uygulanir_arka_plan_atilir() {
        let built = build(&spec(
            "lower-third",
            &["Ayşe Yılmaz", "Editör", "#ff0000"],
            false,
        ))
        .unwrap();
        let list = controls(&built.project, built.comp);
        assert_eq!(list[0].2.value, "Ayşe Yılmaz");
        assert_eq!(list[1].2.value, "Editör");
        assert_eq!(list[2].2.value, "#ff0000");
        let c = built.project.comp(built.comp).unwrap();
        assert!(c.layers.iter().all(|l| !l.name.contains("Background")));
        // Saydam: köşe pikseli boş.
        let (rgba, w, h) = built.frame(2.0, 0.25);
        assert_eq!(rgba.len(), (w * h * 4) as usize);
        assert_eq!(rgba[3], 0, "sol üst köşe saydam olmalı");
        // Ortada bir şeyler çizilmiş.
        assert!(rgba.chunks(4).any(|p| p[3] > 200));
    }

    #[test]
    fn denetimsiz_sabit_yazilar_atilir() {
        let built = build(&spec("text-orbit-3d", &["DÖNÜŞ"], false)).unwrap();
        let c = built.project.comp(built.comp).unwrap();
        let texts: Vec<String> = c
            .layers
            .iter()
            .filter_map(|l| match &l.props.prop("text/sourceText")?.value {
                Value::Text(doc) => Some(doc.text.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(texts, vec!["DÖNÜŞ".to_string()]);
    }

    #[test]
    fn arka_planli_kare_tamamen_doludur() {
        let built = build(&spec("title-card", &[], true)).unwrap();
        let (rgba, _, _) = built.frame(1.0, 0.1);
        assert!(rgba.chunks(4).all(|p| p[3] == 255));
    }

    #[test]
    fn lottie_dosyasi_aktarilir_ve_cizilir() {
        let dir = std::env::temp_dir().join(format!("downkit-lottie-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        // 100x100, 1 sn (30 kare): kırmızı dolu bir kare.
        let doc = r#"{"v":"5.7.0","fr":30,"ip":0,"op":30,"w":100,"h":100,"nm":"t","layers":[
          {"ty":4,"nm":"kutu","ind":1,"ip":0,"op":30,"st":0,"ks":{"o":{"a":0,"k":100},"p":{"a":0,"k":[50,50,0]},"a":{"a":0,"k":[0,0,0]},"s":{"a":0,"k":[100,100,100]},"r":{"a":0,"k":0}},
           "shapes":[{"ty":"gr","it":[{"ty":"rc","p":{"a":0,"k":[0,0]},"s":{"a":0,"k":[40,40]},"r":{"a":0,"k":0}},
             {"ty":"fl","c":{"a":0,"k":[1,0,0,1]},"o":{"a":0,"k":100}},
             {"ty":"tr","p":{"a":0,"k":[0,0]},"a":{"a":0,"k":[0,0]},"s":{"a":0,"k":[100,100]},"r":{"a":0,"k":0},"o":{"a":0,"k":100}}]}]}]}"#;
        let path = dir.join("kutu.json");
        std::fs::write(&path, doc).unwrap();
        let built = build(&MotionSpec {
            template: LOTTIE.into(),
            values: vec![path.to_string_lossy().into_owned()],
            background: false,
        })
        .unwrap();
        assert_eq!(built.size(), (100, 100));
        assert!((built.duration() - 1.0).abs() < 0.05);
        let (rgba, w, _) = built.frame(0.5, 1.0);
        let center = ((50 * w + 50) * 4) as usize;
        assert_eq!(&rgba[center..center + 4], &[255, 0, 0, 255]);
        assert_eq!(rgba[3], 0, "köşe saydam");
        // Uzantısı yanlış dosya reddedilir.
        let bad = MotionSpec {
            template: LOTTIE.into(),
            values: vec![dir.join("x.txt").to_string_lossy().into_owned()],
            background: false,
        };
        assert!(build(&bad).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn bilinmeyen_sablon_ve_bozuk_renk_reddedilir_ya_da_atlanir() {
        assert!(build(&spec("slideshow", &[], false)).is_err());
        assert!(build(&spec("yok", &[], false)).is_err());
        let built = build(&spec("lower-third", &["A", "B", "kırmızı"], false)).unwrap();
        let list = controls(&built.project, built.comp);
        assert_eq!(list[2].2.value, templates()[0].controls[2].value);
    }
}

/// README vitrini: her şablonun ortasındaki kare, verilen dildeki metinlerle.
/// VITRIN_DIZIN=<klasör> VITRIN_DIL=tr cargo test --lib vitrin -- --ignored
#[cfg(test)]
mod vitrin {
    use super::*;

    #[test]
    #[ignore]
    fn vitrin_kareleri_yazilir() {
        let dir = std::env::var("VITRIN_DIZIN").expect("VITRIN_DIZIN");
        let lang = std::env::var("VITRIN_DIL").unwrap_or_else(|_| "en".into());
        let locale: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(format!("../src/locales/{lang}.json")).unwrap(),
        )
        .unwrap();
        std::fs::create_dir_all(&dir).unwrap();
        for t in templates() {
            let texts: Vec<String> = locale["motion"]["tpl"][&t.id]["values"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            let mut k = 0;
            let values = t
                .controls
                .iter()
                .map(|c| match c.kind {
                    ControlKind::Text => {
                        k += 1;
                        texts.get(k - 1).cloned().unwrap_or_else(|| c.value.clone())
                    }
                    ControlKind::Color => c.value.clone(),
                })
                .collect();
            let built = build(&MotionSpec {
                template: t.id.clone(),
                values,
                background: true,
            })
            .unwrap();
            let (rgba, w, h) = built.frame(t.duration * 0.5, 0.5);
            image::save_buffer(
                format!("{dir}/{}.png", t.id),
                &rgba,
                w,
                h,
                image::ColorType::Rgba8,
            )
            .unwrap();
        }
    }
}
