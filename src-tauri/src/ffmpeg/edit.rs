//! Klip Düzenleyici için FFmpeg argümanları: kare şeridi, dalga formu, önizleme
//! kopyası ve klipleri tek dosyada birleştirme. Hepsi saf fonksiyon; süreç
//! yönetimi `commands::editor` ve `commands::edit` içinde.

use super::fx::{FxInput, Motion, Transition};
use super::transform::Transform;
use super::trim::seconds_arg;
use super::xfade::{self, Xfade};

/// Kaynaktan alınacak tek parça (saniye), oynatma hızı, ses düzeyi ve geçişler.
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    /// Çoklu kaynakta `inputs` dizisindeki sıra (yoksa 0 = ilk kaynak).
    #[serde(default)]
    pub source: usize,
    pub start: f64,
    pub end: f64,
    /// 2 = iki kat hızlı. Eski istekler hız göndermez: 1 sayılır.
    #[serde(default = "normal_speed")]
    pub speed: f64,
    /// 0 = sessiz, 1 = olduğu gibi, 2 = iki kat.
    #[serde(default = "normal_speed")]
    pub volume: f64,
    /// Baştan açılma / sonda kararma süresi (çıktı saniyesi); görüntü ve ses birlikte.
    #[serde(default)]
    pub fade_in: f64,
    #[serde(default)]
    pub fade_out: f64,
    /// Görünüm: filtre, renk ayarları, efektler.
    #[serde(default)]
    pub look: Look,
    /// Açılma/kararma siyah yerine beyazdan ("Beyaza aç" geçişi).
    #[serde(default)]
    pub fade_white: bool,
    /// Zaman çizelgesindeki boşluk: bu süre boyunca siyah görüntü ve sessizlik
    /// (`end - start` kadar). Kaynaktan bir şey okunmaz, indirilmez.
    #[serde(default)]
    pub black: bool,
    /// Klip boyunca hareket (yakınlaştır, kaydır, sarsıntı…) ve şiddeti (0,05–0,6).
    #[serde(default)]
    pub motion: Motion,
    #[serde(default)]
    pub motion_strength: f64,
    /// Bu parça klibin kaçıncı saniyesinden başlıyor ve klibin tam süresi
    /// (üst katman klibi böldüyse hareket kaldığı yerden sürsün diye).
    #[serde(default)]
    pub motion_offset: f64,
    #[serde(default)]
    pub motion_total: f64,
    /// Başta/sonda geçiş stili (süreler fade_in/fade_out).
    #[serde(default)]
    pub transition: Transition,
    /// Bu parçadan bir sonrakine geçiş (klipler arası, `xfade`). Son parçada ve
    /// siyah boşlukta yok sayılır.
    #[serde(default)]
    pub xfade: Option<Xfade>,
    /// Geçiş için baştaki/sondaki dondurulmuş kare süresi (çıktı saniyesi):
    /// kaynakta kesimin ötesinde yeterli görüntü yoksa eksik kısım uçtaki kareyle
    /// doldurulur. Arayüz göndermez; `apply_xfade_handles` hesaplar.
    /// Sesteki sürekli gürültüyü (fan, uğultu) azaltır (`afftdn`).
    #[serde(default)]
    pub denoise: bool,
    /// Ses onarımı: gürültü, rüzgâr, yankı, konuşma iyileştirme (varsa `denoise`'un yerine).
    #[serde(default)]
    pub audio_fx: Option<AudioFx>,
    /// Hızlandırılmış klipte hareket bulanıklığı: art arda kareler karıştırılır (`tmix`).
    #[serde(default)]
    pub motion_blur: bool,
    /// Dondurulmuş kare: kaynağın bu saniyesindeki kare `output_duration` boyunca durur
    /// (ses yok). `start`/`end` yalnızca süreyi verir.
    #[serde(default)]
    pub freeze_at: Option<f64>,
    /// Ters oynatma: görüntü ve ses sondan başa (`reverse`/`areverse`).
    #[serde(default)]
    pub reverse: bool,
    /// Konum, ölçek, döndürme, saydamlık (anahtar karelerle; zamanlar parçanın saniyesi).
    #[serde(default)]
    pub transform: Option<Transform>,
    /// Zamanlı yakınlaştırma: dönüşümden sonra karenin tamamına (kamera gibi).
    #[serde(default)]
    pub zoom: Option<Transform>,
    #[serde(skip)]
    pub pad_head: f64,
    #[serde(skip)]
    pub pad_tail: f64,
}

/// Hazır renk filtreleri.
#[derive(Debug, Clone, Copy, Default, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FilterKind {
    #[default]
    None,
    /// Siyah-beyaz.
    Bw,
    Sepia,
    /// Canlı: doygunluk ve kontrast artar.
    Vivid,
    Cool,
    Warm,
    /// Sinema: yüksek kontrast, soluk renk.
    Cinema,
    /// Solgun: düşük kontrast, açık ton.
    Faded,
    // --- Sinematik paketler ---
    /// Gölgeler camgöbeği, açık tonlar turuncu (sinema afişi görünümü).
    TealOrange,
    /// Sert siyah-beyaz.
    Noir,
    Vintage,
    Neon,
    Pastel,
    /// Yeşil ton (film havası).
    Matrix,
    /// Altın saat.
    Golden,
    /// Kasvetli: soluk, mavi gölgeler.
    Moody,
}

/// Klibin görünümü. Renk değerleri −1…1 (0 = olduğu gibi), bulanıklık 0…1.
#[derive(Debug, Clone, Default, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Look {
    pub filter: FilterKind,
    pub brightness: f64,
    pub contrast: f64,
    pub saturation: f64,
    /// −1 soğuk (mavi) … 1 sıcak (turuncu).
    pub temperature: f64,
    pub blur: f64,
    /// Yatay aynalama.
    pub mirror: bool,
    /// Kenarları karartma.
    pub vignette: bool,
    /// Glitch, RGB ayrışma, flaş, gren, ışık sızması, VHS, keskinleştirme.
    pub fx: LookFx,
    /// Renk düzeltme: pozlama, ton, tekerlekler, seviyeler, eğri, LUT.
    pub grade: Option<Grade>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, serde::Deserialize)]
#[serde(default)]
pub struct Wheel {
    pub x: f64,
    pub y: f64,
}

impl Wheel {
    /// Kırmızı/yeşil/mavi kaydırması (toplamı 0; arayüzdeki `wheelRgb` ile aynı).
    fn rgb(&self) -> [f64; 3] {
        let (x, y) = (clamp_unit(self.x), clamp_unit(self.y));
        let s = 3f64.sqrt() / 2.0;
        [x, -x / 2.0 + s * y, -x / 2.0 - s * y].map(|v| v * GRADE_WHEEL_SCALE)
    }
}

#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
pub struct LutFile {
    pub path: String,
}

/// Renk düzeltme (arayüzdeki `lib/colorGrade.ts`): pozlama → eğri → seviyeler →
/// renk dengesi (tekerlekler + ton) → LUT.
#[derive(Debug, Clone, Default, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Grade {
    pub exposure: f64,
    pub tint: f64,
    pub shadows: Wheel,
    pub midtones: Wheel,
    pub highlights: Wheel,
    pub lift: f64,
    pub gamma: f64,
    pub gain: f64,
    pub curve: Option<Vec<[f64; 2]>>,
    pub lut: Option<LutFile>,
}

const GRADE_WHEEL_SCALE: f64 = 0.3;
const GRADE_LEVEL_SCALE: f64 = 0.15;
const GRADE_TINT_SCALE: f64 = 0.15;

fn clamp_unit(v: f64) -> f64 {
    if v.is_finite() {
        v.clamp(-1.0, 1.0)
    } else {
        0.0
    }
}

/// Seviyeler eğrisi (arayüzdeki `levelPoints` ile aynı): artı lift siyahı kaldırır, eksi
/// lift koyuları siyaha çeker; artı gain parlakları beyaza çeker, eksi gain beyazı indirir.
fn level_points(lift: f64, gamma: f64, gain: f64) -> [[f64; 2]; 3] {
    let s = GRADE_LEVEL_SCALE;
    let low = if lift >= 0.0 {
        [0.0, s * lift]
    } else {
        [-s * lift, 0.0]
    };
    let high = if gain >= 0.0 {
        [1.0 - s * gain, 1.0]
    } else {
        [1.0, 1.0 + s * gain]
    };
    [low, [0.5, 0.5 + s * gamma], high]
}

/// Filtre sayısı: eksi sıfır yazılmaz.
fn signed(v: f64) -> String {
    number(if v == 0.0 { 0.0 } else { v })
}

fn curve_points(points: &[[f64; 2]]) -> String {
    points
        .iter()
        .map(|[x, y]| {
            format!(
                "{}/{}",
                number(x.clamp(0.0, 1.0)),
                number(y.clamp(0.0, 1.0))
            )
        })
        .collect::<Vec<_>>()
        .join(" ")
}

impl Grade {
    pub fn steps(&self) -> Vec<String> {
        let mut steps = Vec::new();
        let exposure = clamp_unit(self.exposure);
        if exposure.abs() > 1e-3 {
            steps.push(format!("exposure=exposure={}", number(2.0 * exposure)));
        }
        if let Some(curve) = self.curve.as_ref().filter(|c| c.len() >= 2) {
            steps.push(format!("curves=all='{}'", curve_points(curve)));
        }
        let (lift, gamma, gain) = (
            clamp_unit(self.lift),
            clamp_unit(self.gamma),
            clamp_unit(self.gain),
        );
        if lift.abs() > 1e-3 || gamma.abs() > 1e-3 || gain.abs() > 1e-3 {
            steps.push(format!(
                "curves=all='{}'",
                curve_points(&level_points(lift, gamma, gain))
            ));
        }
        let tint = -clamp_unit(self.tint) * GRADE_TINT_SCALE;
        let (s, m, h) = (
            self.shadows.rgb(),
            self.midtones.rgb(),
            self.highlights.rgb(),
        );
        let with_tint = |v: [f64; 3]| [v[0], v[1] + tint, v[2]];
        let (s, m, h) = (with_tint(s), with_tint(m), with_tint(h));
        if s.iter().chain(&m).chain(&h).any(|v| v.abs() > 1e-4) {
            steps.push(format!(
                "colorbalance=rs={}:gs={}:bs={}:rm={}:gm={}:bm={}:rh={}:gh={}:bh={}",
                signed(s[0]),
                signed(s[1]),
                signed(s[2]),
                signed(m[0]),
                signed(m[1]),
                signed(m[2]),
                signed(h[0]),
                signed(h[1]),
                signed(h[2])
            ));
        }
        if let Some(lut) = self
            .lut
            .as_ref()
            .filter(|l| l.path.to_ascii_lowercase().ends_with(".cube"))
        {
            steps.push(format!("lut3d=file='{}'", filter_path(&lut.path)));
        }
        steps
    }
}

/// Görünüm efektleri, her biri 0–1 şiddet (0 = kapalı). Zamanla değişenler arayüzdeki
/// önizlemeyle aynı formülü kullanır (`src/lib/lookFx.ts`); `t` parçanın çıktı saniyesi.
#[derive(Debug, Clone, Copy, Default, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LookFx {
    pub glitch: f64,
    pub rgb_split: f64,
    pub strobe: f64,
    pub grain: f64,
    pub light_leak: f64,
    pub vhs: f64,
    pub sharpen: f64,
}

impl LookFx {
    fn amount(v: f64) -> f64 {
        if v.is_finite() {
            v.clamp(0.0, 1.0)
        } else {
            0.0
        }
    }

    pub fn steps(&self) -> Vec<String> {
        let mut steps = Vec::new();
        let on = |v: f64| Self::amount(v) > 1e-3;
        let (glitch, vhs) = (Self::amount(self.glitch), Self::amount(self.vhs));
        if on(self.sharpen) {
            steps.push(format!(
                "unsharp=5:5:{}",
                number(0.5 + 1.5 * Self::amount(self.sharpen))
            ));
        }
        if on(glitch) {
            // Saniyede 7 kez, sürenin %15'inde: renk kayar ve görüntü yana titrer.
            steps.push(format!(
                "hue=h='if(lt(mod(t*7,1),0.15),{},0)'",
                number((90.0 * glitch).round())
            ));
            steps.push(format!(
                "crop=iw-16:ih:x='8-if(lt(mod(t*7,1),0.15),round(8*{}*sin(t*80)),0)':y=0,scale=iw+16:ih",
                number(glitch)
            ));
        }
        let split = Self::amount(self.rgb_split).max(vhs * 0.5);
        if split > 1e-3 {
            let px = (2.0 + 10.0 * split).round() as i32;
            steps.push(format!("rgbashift=rh=-{px}:bh={px}"));
        }
        if on(vhs) {
            steps.push(format!(
                "eq=saturation={}:contrast={}",
                number(1.0 + 0.3 * vhs),
                number(1.0 + 0.1 * vhs)
            ));
            steps.push(format!("gblur=sigma={}", number(0.6 * vhs)));
            steps.push(format!(
                "drawgrid=w=iw:h=4:t=1:c=black@{}",
                number(0.3 * vhs)
            ));
        }
        if on(self.strobe) {
            steps.push(format!(
                "eq=brightness='if(lt(mod(t*6,1),0.2),{},0)':eval=frame",
                number(0.5 * Self::amount(self.strobe))
            ));
        }
        if on(self.light_leak) {
            let l = Self::amount(self.light_leak);
            steps.push(format!(
                "colorbalance=rs={}:gs={}:bs={}",
                number(0.15 * l),
                number(0.05 * l),
                number(-0.1 * l)
            ));
            steps.push(format!(
                "eq=brightness='{}*(1+sin(t*1.3))/2':eval=frame",
                number(0.08 * l)
            ));
        }
        let grain = Self::amount(self.grain).max(vhs * 0.4);
        if grain > 1e-3 {
            steps.push(format!(
                "noise=alls={}:allf=t+u",
                (8.0 + 32.0 * grain).round() as u32
            ));
        }
        steps
    }
}

impl Look {
    fn value(v: f64) -> f64 {
        if v.is_finite() {
            v.clamp(-1.0, 1.0)
        } else {
            0.0
        }
    }

    pub fn is_default(&self) -> bool {
        self.steps().is_empty()
    }

    /// FFmpeg görüntü filtreleri (sırayla: hazır filtre, renk, sıcaklık, bulanıklık, aynalama, vinyet).
    pub fn steps(&self) -> Vec<String> {
        let mut steps: Vec<String> = Vec::new();
        match self.filter {
            FilterKind::None => {}
            FilterKind::Bw => steps.push("hue=s=0".into()),
            FilterKind::Sepia => steps
                .push("colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131".into()),
            FilterKind::Vivid => steps.push("eq=saturation=1.5:contrast=1.08".into()),
            FilterKind::Cool => steps.push("colorbalance=rs=-0.08:bs=0.1:rm=-0.05:bm=0.08".into()),
            FilterKind::Warm => steps.push("colorbalance=rs=0.1:bs=-0.08:rm=0.06:bm=-0.05".into()),
            FilterKind::Cinema => steps.push("eq=contrast=1.15:saturation=0.85".into()),
            FilterKind::Faded => {
                steps.push("eq=contrast=0.85:brightness=0.04:saturation=0.8".into())
            }
            FilterKind::TealOrange => steps.push(
                "colorbalance=rs=-0.1:bs=0.12:rh=0.1:bh=-0.1,eq=saturation=1.15:contrast=1.08"
                    .into(),
            ),
            FilterKind::Noir => steps.push("hue=s=0,eq=contrast=1.35:brightness=-0.03".into()),
            FilterKind::Vintage => steps.push("curves=preset=vintage".into()),
            FilterKind::Neon => steps.push("eq=saturation=1.8:contrast=1.1,hue=h=-8".into()),
            FilterKind::Pastel => steps.push(
                "eq=saturation=0.7:brightness=0.06:contrast=0.9,colorbalance=rh=0.04:bh=0.06"
                    .into(),
            ),
            FilterKind::Matrix => {
                steps.push("colorchannelmixer=rr=0.6:rg=0.2:gg=1.1:bb=0.6,eq=contrast=1.1".into())
            }
            FilterKind::Golden => {
                steps.push("colorbalance=rm=0.12:gm=0.05:bm=-0.12,eq=saturation=1.15".into())
            }
            FilterKind::Moody => steps.push(
                "eq=contrast=1.15:saturation=0.75:brightness=-0.05,colorbalance=bs=0.08".into(),
            ),
        }
        let (b, c, sat, temp) = (
            Look::value(self.brightness),
            Look::value(self.contrast),
            Look::value(self.saturation),
            Look::value(self.temperature),
        );
        if b.abs() > 1e-3 || c.abs() > 1e-3 || sat.abs() > 1e-3 {
            steps.push(format!(
                "eq=brightness={}:contrast={}:saturation={}",
                number(b * 0.25),
                number(1.0 + c * 0.6),
                number(1.0 + sat)
            ));
        }
        if temp.abs() > 1e-3 {
            steps.push(format!(
                "colorbalance=rs={}:bs={}:rm={}:bm={}",
                number(temp * 0.12),
                number(-temp * 0.12),
                number(temp * 0.06),
                number(-temp * 0.06)
            ));
        }
        let blur = if self.blur.is_finite() {
            self.blur.clamp(0.0, 1.0)
        } else {
            0.0
        };
        if blur > 1e-3 {
            steps.push(format!(
                "boxblur=lr={}:lp=1",
                (1.0 + blur * 19.0).round() as u32
            ));
        }
        if self.mirror {
            steps.push("hflip".into());
        }
        if self.vignette {
            steps.push("vignette=PI/5".into());
        }
        if let Some(grade) = &self.grade {
            steps.extend(grade.steps());
        }
        steps.extend(self.fx.steps());
        steps
    }
}

/// Ses onarım asistanı (arayüzdeki `lib/audioFx.ts`). Konuşma modunda rüzgâr süzgeci
/// daha yüksek frekanstan keser ve iyileştirme konuşma eşitleyicisi + sıkıştırıcıdır;
/// müzik modunda yalnızca hafif sıkıştırma.
#[derive(Debug, Clone, Copy, Default, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AudioFx {
    pub music: bool,
    /// 0–1: sürekli gürültü (fan, uğultu, cızırtı).
    pub noise: f64,
    pub wind: bool,
    /// 0–1: oda yankısı (sözcük aralarındaki kuyruk kısılır).
    pub echo: f64,
    pub enhance: bool,
    /// Eşitleyici kazançları (dB, −12…12): bas (120 Hz rafı), orta (1 kHz), tiz (8 kHz rafı).
    pub low: f64,
    pub mid: f64,
    pub high: f64,
    /// 0–1: sıkıştırıcı (sesli ve sessiz yerlerin farkını azaltır).
    pub compress: f64,
    /// Tepe sınırlayıcı: ses −1 dBFS'yi aşmaz (en sonda).
    pub limit: bool,
}

impl AudioFx {
    fn amount(v: f64) -> f64 {
        if v.is_finite() {
            v.clamp(0.0, 1.0)
        } else {
            0.0
        }
    }

    /// Eşitleyici kazancı: sınırlı, 0,5 dB'e yuvarlanmış.
    fn gain(v: f64) -> f64 {
        if v.is_finite() {
            (v.clamp(-12.0, 12.0) * 2.0).round() / 2.0
        } else {
            0.0
        }
    }

    pub fn steps(&self) -> Vec<String> {
        let mut steps = Vec::new();
        if self.wind {
            steps.push(format!("highpass=f={}", if self.music { 40 } else { 120 }));
        }
        let noise = Self::amount(self.noise);
        if noise > 1e-3 {
            steps.push(format!(
                "afftdn=nr={}:nf=-25",
                number((6.0 + 24.0 * noise).round())
            ));
        }
        let echo = Self::amount(self.echo);
        if echo > 1e-3 {
            steps.push(format!(
                "agate=threshold=0.02:ratio={}:attack=5:release={}",
                number(1.5 + 3.0 * echo),
                number((250.0 - 150.0 * echo).round())
            ));
        }
        if self.enhance {
            if self.music {
                steps.push("acompressor=threshold=0.2:ratio=2:attack=20:release=250".into());
            } else {
                steps.push("equalizer=f=200:t=q:w=1:g=-2".into());
                steps.push("equalizer=f=3500:t=q:w=1.2:g=3".into());
                steps.push(
                    "acompressor=threshold=0.1:ratio=3:attack=5:release=120:makeup=1.5".into(),
                );
            }
        }
        let (low, mid, high) = (
            Self::gain(self.low),
            Self::gain(self.mid),
            Self::gain(self.high),
        );
        if low != 0.0 {
            steps.push(format!("bass=g={}:f=120:t=q:w=0.7", number(low)));
        }
        if mid != 0.0 {
            steps.push(format!("equalizer=f=1000:t=q:w=1:g={}", number(mid)));
        }
        if high != 0.0 {
            steps.push(format!("treble=g={}:f=8000:t=q:w=0.7", number(high)));
        }
        let compress = Self::amount(self.compress);
        if compress > 1e-3 {
            // Hafiften (eşik −8 dB, 1,5:1) güçlüye (eşik −26 dB, 6:1); kayıp kazançla telafi.
            let threshold_db = -8.0 - 18.0 * compress;
            steps.push(format!(
                "acompressor=threshold={}:ratio={}:attack=10:release=150:makeup={}",
                number((10f64.powf(threshold_db / 20.0) * 1000.0).round() / 1000.0),
                number(((1.5 + 4.5 * compress) * 10.0).round() / 10.0),
                number(((1.0 + compress) * 10.0).round() / 10.0),
            ));
        }
        if self.limit {
            steps.push("alimiter=limit=0.891:attack=5:release=50:level=false".into());
        }
        steps
    }
}

/// Sosyal medya ses seviyesi: tek geçişli `loudnorm`, gerçek tepe −1,5 dBTP.
pub fn loudness_step(lufs: f64) -> String {
    format!(
        "loudnorm=I={}:TP=-1.5:LRA=11",
        number(lufs.clamp(-24.0, -9.0))
    )
}

/// Siyah parça, kaynağın bu kadarlık ilk diliminden üretilir (son kare uzatılır).
pub const BLACK_SOURCE_SECONDS: f64 = 0.5;

fn normal_speed() -> f64 {
    1.0
}

pub const MAX_VOLUME: f64 = 4.0;

pub const MIN_SPEED: f64 = 0.25;
pub const MAX_SPEED: f64 = 4.0;

/// Çıkış karesi yeniden (ör. dikey 9:16). Kırpmada `position` taşan eksende
/// kalan bölgenin yeri: 0 = sol/üst, 0.5 = orta, 1 = sağ/alt.
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub width: u32,
    pub height: u32,
    /// true: kırpmadan sığdır, boşluklar siyah bant.
    #[serde(default)]
    pub fit: bool,
    /// Sığdırırken boşluklar siyah yerine görüntünün bulanık hâliyle dolsun
    /// (dikey videolarda yaygın görünüm).
    #[serde(default)]
    pub blur: bool,
    #[serde(default = "center")]
    pub position: f64,
    /// Kamera + oyun: kaynaktaki iki bölge alt alta dizilir (yayın kaydından dikey video).
    #[serde(default)]
    pub split: Option<Split>,
    /// Sığdırırken boşluklar yukarıdan aşağı iki renkli geçişle dolsun.
    #[serde(default)]
    pub gradient: Option<[Color; 2]>,
    /// Kırpmada konum zamanla değişir (yüz takibi): [çıktı saniyesi, konum 0–1].
    #[serde(default)]
    pub track: Option<Vec<(f64, f64)>>,
}

/// En çok bu kadar anahtar kare (Windows komut satırı sınırı aşılmasın).
const MAX_TRACK_POINTS: usize = 200;

/// Anahtar karelerden parça parça doğrusal konum ifadesi (`t`: çıktı saniyesi).
fn track_expr(track: &[(f64, f64)]) -> Option<String> {
    let points: Vec<(f64, f64)> = track
        .iter()
        .filter(|(t, v)| t.is_finite() && v.is_finite())
        .map(|&(t, v)| (t.max(0.0), v.clamp(0.0, 1.0)))
        .take(MAX_TRACK_POINTS)
        .collect();
    let (first, last) = (points.first()?, points.last()?);
    if points.len() == 1 {
        return Some(number(first.1));
    }
    let mut terms = vec![format!("lt(t,{})*{}", number(first.0), number(first.1))];
    for pair in points.windows(2) {
        let ((t0, v0), (t1, v1)) = (pair[0], pair[1]);
        if t1 - t0 < 1e-4 {
            continue;
        }
        terms.push(format!(
            "gte(t,{a})*lt(t,{b})*({v0}+({dv})*(t-{a})/{dt})",
            a = number(t0),
            b = number(t1),
            v0 = number(v0),
            dv = number(v1 - v0),
            dt = number(t1 - t0),
        ));
    }
    terms.push(format!("gte(t,{})*{}", number(last.0), number(last.1)));
    Some(terms.join("+"))
}

/// "#rrggbb" rengi.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Color(pub [u8; 3]);

impl Color {
    pub fn parse(text: &str) -> Option<Color> {
        let hex = text.strip_prefix('#')?;
        if hex.len() != 6 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        let byte = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).ok();
        Some(Color([byte(0)?, byte(2)?, byte(4)?]))
    }
}

impl<'de> serde::Deserialize<'de> for Color {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let text = String::deserialize(d)?;
        Color::parse(&text).ok_or_else(|| serde::de::Error::custom("renk #rrggbb olmalı"))
    }
}

/// Kaynaktaki bir bölge (0–1, sol üstten).
#[derive(Debug, Clone, Copy, PartialEq, serde::Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    /// Kaynağın içine sığdırılmış hâli (en az %2).
    fn clamped(self) -> Rect {
        let fin = |v: f64, d: f64| if v.is_finite() { v } else { d };
        let w = fin(self.w, 1.0).clamp(0.02, 1.0);
        let h = fin(self.h, 1.0).clamp(0.02, 1.0);
        Rect {
            x: fin(self.x, 0.0).clamp(0.0, 1.0 - w),
            y: fin(self.y, 0.0).clamp(0.0, 1.0 - h),
            w,
            h,
        }
    }

    fn crop(self) -> String {
        let r = self.clamped();
        format!(
            "crop=iw*{}:ih*{}:iw*{}:ih*{}",
            number(r.w),
            number(r.h),
            number(r.x),
            number(r.y)
        )
    }
}

/// Kamera ve oyun bölgesi; kamera çıkışın `cam_share` kadarını kaplar.
#[derive(Debug, Clone, Copy, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Split {
    pub cam: Rect,
    pub game: Rect,
    pub cam_share: f64,
    #[serde(default = "yes")]
    pub cam_top: bool,
    /// Düzen: alt alta (varsayılan), daire kamera, köşede kamera, iki kamera + oyun.
    #[serde(default)]
    pub style: SplitStyle,
    /// İki kamera düzeninde ikinci kamera bölgesi (yoksa birinci kameranın yanı).
    #[serde(default)]
    pub cam2: Option<Rect>,
    /// Daire / köşe düzeninde kameranın çıkıştaki yeri ve genişlik payı.
    #[serde(default)]
    pub spot: Option<Spot>,
    /// Daire / köşe kamerasının çerçeve rengi (yoksa çerçevesiz).
    #[serde(default)]
    pub ring: Option<Color>,
    /// Alt alta düzenlerde kamera ile oyun arasında renkli şerit (logo, başlık için).
    #[serde(default)]
    pub band: Option<Band>,
}

/// Kamera ile oyun arasındaki şerit: çıkış yüksekliğindeki payı ve rengi.
#[derive(Debug, Clone, Copy, PartialEq, serde::Deserialize)]
pub struct Band {
    pub share: f64,
    pub color: Color,
}

#[derive(Debug, Clone, Copy, PartialEq, Default, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SplitStyle {
    #[default]
    Stack,
    /// İki kişilik podcast: alt alta iki kişi (yerleşim alt alta düzenle aynı).
    Podcast,
    Circle,
    Pip,
    Duo,
}

/// Çıkış karesinde merkez (0–1) ve genişliğin çıkış genişliğine oranı.
#[derive(Debug, Clone, Copy, PartialEq, serde::Deserialize)]
pub struct Spot {
    pub x: f64,
    pub y: f64,
    pub size: f64,
}

/// Yuvarlatılmış dikdörtgen maske (daire = yarıçap yarı kenar): kenarlar yumuşak,
/// `border` piksellik çerçeve `ring` renginde. Girdi `w`×`h` gbrap olmalı.
fn rounded_mask(w: u32, h: u32, radius: f64, border: f64, ring: Option<Color>) -> String {
    let hw = w as f64 / 2.0;
    let hh = h as f64 / 2.0;
    let rr = radius.clamp(0.0, hw.min(hh));
    let dist = format!(
        "st(0,abs(X-{hw}+0.5)-({hx}));st(1,abs(Y-{hh}+0.5)-({hy}));\
         st(2,hypot(max(ld(0),0),max(ld(1),0))+min(max(ld(0),ld(1)),0)-{rr})",
        hw = number(hw),
        hh = number(hh),
        hx = number(hw - rr),
        hy = number(hh - rr),
        rr = number(rr),
    );
    let channel = |name: &str, value: u8| match ring {
        Some(_) if border > 0.0 => format!(
            "{dist};st(3,clip(ld(2)+{b}+0.5,0,1));{name}(X,Y)*(1-ld(3))+{value}*ld(3)",
            b = number(border)
        ),
        _ => format!("{name}(X,Y)"),
    };
    let [cr, cg, cb] = ring.map(|c| c.0).unwrap_or([255, 255, 255]);
    format!(
        "format=gbrap,geq=r='{}':g='{}':b='{}':a='{dist};255*clip(0.5-ld(2),0,1)'",
        channel("r", cr),
        channel("g", cg),
        channel("b", cb),
    )
}

fn yes() -> bool {
    true
}

fn center() -> f64 {
    0.5
}

impl Frame {
    pub fn filter(&self) -> String {
        let even = |v: u32| v.clamp(16, 4096) & !1;
        let (w, h) = (even(self.width), even(self.height));
        if let Some(split) = self.split {
            // Her bölge kendi yuvasını kaplayacak kadar büyütülüp ortadan kırpılır.
            let stacked = matches!(
                split.style,
                SplitStyle::Stack | SplitStyle::Podcast | SplitStyle::Duo
            );
            let band = split
                .band
                .filter(|b| stacked && b.share.is_finite() && b.share > 0.0)
                .map(|b| (b.share.clamp(0.04, 0.25), b.color));
            let band_share = band.map(|(s, _)| s).unwrap_or(0.0);
            let share = if split.cam_share.is_finite() {
                split
                    .cam_share
                    .clamp(0.15, 0.7f64.min(1.0 - band_share - 0.3))
            } else {
                0.35
            };
            let cam_h = ((h as f64 * share).round() as u32) & !1;
            let band_h = ((h as f64 * band_share).round() as u32) & !1;
            let game_h = h - cam_h - band_h;
            // Şerit: görüntünün kendisinden türetilip boyanır (kare hızı ve süre aynı kalsın).
            let band_slot = band.filter(|_| band_h > 0).map(|(_, color)| {
                let [r, g, b] = color.0;
                format!("[sx]scale={w}:{band_h},drawbox=c=0x{r:02x}{g:02x}{b:02x}:t=fill,setsar=1[sband];")
            });
            let slot = |rect: Rect, slot_h: u32, out: &str| {
                format!(
                    "{},scale={w}:{slot_h}:force_original_aspect_ratio=increase,crop={w}:{slot_h},setsar=1{out}",
                    rect.crop()
                )
            };
            let (order, extra, inputs) = match &band_slot {
                Some(_) if split.cam_top => ("[scam][sband][sgame]", "[sx]", 3),
                Some(_) => ("[sgame][sband][scam]", "[sx]", 3),
                None if split.cam_top => ("[scam][sgame]", "", 2),
                None => ("[sgame][scam]", "", 2),
            };
            let band_chain = band_slot.clone().unwrap_or_default();
            match split.style {
                SplitStyle::Stack | SplitStyle::Podcast => {
                    return format!(
                        "split{}[sa][sb]{extra};[sa]{};[sb]{};{band_chain}{order}vstack=inputs={inputs},setsar=1",
                        if inputs == 3 { "=3" } else { "" },
                        slot(split.cam, cam_h, "[scam]"),
                        slot(split.game, game_h, "[sgame]"),
                    );
                }
                SplitStyle::Duo => {
                    // Üst yuva ikiye bölünür: iki kamera yan yana, oyun altta (ya da üstte).
                    let half = (w / 2) & !1;
                    let other = w - half;
                    let cam2 = split.cam2.unwrap_or(Rect {
                        x: (split.cam.x - split.cam.w).max(0.0),
                        ..split.cam
                    });
                    let cell = |rect: Rect, cw: u32, out: &str| {
                        format!(
                            "{},scale={cw}:{cam_h}:force_original_aspect_ratio=increase,crop={cw}:{cam_h},setsar=1{out}",
                            rect.crop()
                        )
                    };
                    return format!(
                        "split={}[sa][sb][sc]{extra};[sa]{};[sb]{};[sc1][sc2]hstack=inputs=2[scam];[sc]{};{band_chain}{order}vstack=inputs={inputs},setsar=1",
                        inputs + 1,
                        cell(split.cam, half, "[sc1]"),
                        cell(cam2, other, "[sc2]"),
                        slot(split.game, game_h, "[sgame]"),
                    );
                }
                SplitStyle::Circle | SplitStyle::Pip => {
                    // Oyun bütün kareyi kaplar; kamera daire ya da yuvarlatılmış köşeli kutu olarak üstte.
                    let fin = |v: f64, d: f64| if v.is_finite() { v } else { d };
                    let spot = split.spot.unwrap_or(Spot {
                        x: 0.5,
                        y: 0.78,
                        size: 0.42,
                    });
                    let size = fin(spot.size, 0.42).clamp(0.12, 0.8);
                    let cw = (((w as f64 * size).round() as u32).max(16)) & !1;
                    let (ch, radius) = if split.style == SplitStyle::Circle {
                        (cw, cw as f64 / 2.0)
                    } else {
                        let ch = (((cw as f64 * 0.75).round() as u32).max(16)) & !1;
                        (ch, ch as f64 * 0.12)
                    };
                    let border = if split.ring.is_some() {
                        (cw.min(ch) as f64 * 0.025).round().max(2.0)
                    } else {
                        0.0
                    };
                    let x = number(fin(spot.x, 0.5).clamp(0.0, 1.0));
                    let y = number(fin(spot.y, 0.78).clamp(0.0, 1.0));
                    return format!(
                        "split[sa][sb];[sb]{},scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},setsar=1[sbg];\
                         [sa]{},scale={cw}:{ch}:force_original_aspect_ratio=increase,crop={cw}:{ch},{}[scam];\
                         [sbg][scam]overlay=x='min(max(W*{x}-w/2,0),W-w)':y='min(max(H*{y}-h/2,0),H-h)',setsar=1",
                        split.game.crop(),
                        split.cam.crop(),
                        rounded_mask(cw, ch, radius, border, split.ring),
                    );
                }
            }
        }
        if self.fit && !self.blur {
            if let Some([from, to]) = self.gradient {
                // Arka plan: küçük bir resimde yukarıdan aşağı renk geçişi, kareye büyütülür
                // (kare hızı videoyla aynı kalsın diye görüntünün kendisinden türetilir).
                let channel = |i: usize| format!("{}+({}-{})*Y/63", from.0[i], to.0[i], from.0[i]);
                return format!(
                    "split[fa][fb];[fa]scale=8:64,format=gbrp,geq=r='{}':g='{}':b='{}',\
                     scale={w}:{h}:flags=bicubic,setsar=1[fbg];\
                     [fb]scale={w}:{h}:force_original_aspect_ratio=decrease[ffg];\
                     [fbg][ffg]overlay=(W-w)/2:(H-h)/2,setsar=1",
                    channel(0),
                    channel(1),
                    channel(2),
                );
            }
        }
        if self.fit && self.blur {
            // Arka plan: kareyi kaplayacak kadar büyütülüp bulanıklaştırılır ve biraz
            // karartılır; ön plan sığdırılıp ortaya konur.
            let radius = (h / 40).clamp(8, 120);
            format!(
                "split[fa][fb];[fa]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},\
                 boxblur=lr={radius}:lp=2,eq=brightness=-0.06[fbg];\
                 [fb]scale={w}:{h}:force_original_aspect_ratio=decrease[ffg];\
                 [fbg][ffg]overlay=(W-w)/2:(H-h)/2,setsar=1"
            )
        } else if self.fit {
            format!(
            "scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1"
        )
        } else {
            let p = number(if self.position.is_finite() {
                self.position.clamp(0.0, 1.0)
            } else {
                0.5
            });
            // Yüz takibi: konum zamanla değişen ifade (crop her karede yeniden hesaplar).
            let p = self
                .track
                .as_deref()
                .and_then(track_expr)
                .map(|e| format!("({e})"))
                .unwrap_or(p);
            format!(
            "scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h}:x='(iw-ow)*{p}':y='(ih-oh)*{p}',setsar=1"
        )
        }
    }
}

/// Görüntüye yazılacak yazı (başlık, alt yazı). Zamanlar çıktı saniyesi.
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextOverlay {
    pub text: String,
    /// Görüneceği aralıklar (boşluklar atlandığı için birden çok olabilir).
    pub ranges: Vec<(f64, f64)>,
    /// Merkezin konumu (0–1).
    pub x: f64,
    pub y: f64,
    /// Yükseklik: görüntünün kısa kenarının oranı (dikeyde de sığsın).
    pub size: f64,
    pub color: String,
    #[serde(rename = "box", default)]
    pub boxed: bool,
    #[serde(default)]
    pub bold: bool,
    /// Görünüm: klasik (kutu/gölge), kontur, neon, vurgu kutusu, çizgi roman.
    #[serde(default)]
    pub style: TextStyle,
    /// Giriş/çıkış animasyonu: solma, yukarı kayma, pop, zıplama, titreme.
    #[serde(default)]
    pub anim: TextAnim,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextStyle {
    #[default]
    Classic,
    Outline,
    Neon,
    Highlight,
    Comic,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextAnim {
    #[default]
    None,
    Fade,
    SlideUp,
    Pop,
    Bounce,
    Shake,
}

/// Yazı animasyonunun FFmpeg ifadeleri (arayüzdeki `lib/textFx.ts` ile aynı
/// formül): saydamlık, ölçek, yatay ve dikey kayma (karenin oranı).
/// `start`/`end`: yazının çıktıdaki ilk görünüşü ve son anı.
fn text_anim_exprs(anim: TextAnim, start: f64, end: f64) -> (String, String, String, String) {
    let k = format!("clip((t-{})/0.35,0,1)", number(start));
    let o = format!("clip(({}-t)/0.3,0,1)", number(end));
    let ease = |p: &str| format!("(({p})*({p})*(3-2*({p})))");
    let one = || "1".to_string();
    let zero = || "0".to_string();
    match anim {
        TextAnim::None => (one(), one(), zero(), zero()),
        TextAnim::Fade => (format!("min({k},{o})"), one(), zero(), zero()),
        TextAnim::SlideUp => (
            format!("min({k},{o})"),
            one(),
            zero(),
            format!("(1-{})*0.06", ease(&k)),
        ),
        TextAnim::Pop => {
            // backOut: hafifçe büyüyüp yerine oturur.
            let x = format!("({k}-1)");
            (
                format!("min(min({k}*3,1),{o})"),
                format!("(0.3+0.7*(1+2.70158*{x}*{x}*{x}+1.70158*{x}*{x}))"),
                zero(),
                zero(),
            )
        }
        TextAnim::Bounce => (
            format!("min(min({k}*2,1),{o})"),
            one(),
            zero(),
            format!("(-abs(sin(PI*2*{k}))*(1-{k})*0.08)"),
        ),
        TextAnim::Shake => (
            format!("min(min({k}*4,1),{o})"),
            one(),
            "(sin(t*40)*0.004)".into(),
            "(cos(t*33)*0.004)".into(),
        ),
    }
}

/// Açık renk üzerinde koyu, koyu renk üzerinde beyaz yazı (vurgu kutusu için).
fn contrast_text(color: &str) -> &'static str {
    let hex = color.trim_start_matches('#');
    let ch =
        |i: usize| u8::from_str_radix(hex.get(i..i + 2).unwrap_or("ff"), 16).unwrap_or(255) as f64;
    let luma = 0.299 * ch(0) + 0.587 * ch(2) + 0.114 * ch(4);
    if luma > 150.0 {
        "0x111111"
    } else {
        "0xffffff"
    }
}

/// Filtre değerindeki Windows yolu: `C:\a\b` → `C\:/a/b` (tek tırnak içinde kullanılır).
pub fn filter_path(path: &str) -> String {
    path.replace('\\', "/")
        .replace(':', "\\:")
        .replace('\'', "'\\''")
}

/// ASS altyazısını görüntüye basar (libass; Windows yazı tipleri DirectWrite ile bulunur).
pub fn subtitles_filter(ass_file: &str) -> String {
    format!("subtitles=filename='{}'", filter_path(ass_file))
}

fn hex_color(color: &str) -> String {
    let hex = color.trim_start_matches('#');
    if hex.len() == 6 && hex.chars().all(|c| c.is_ascii_hexdigit()) {
        format!("0x{hex}")
    } else {
        "0xffffff".into()
    }
}

/// Yazı dosyadan okunur (`textfile`, genişletme kapalı): Türkçe harfler, iki nokta,
/// yüzde ve tırnak işaretleri kaçış gerektirmez.
pub fn drawtext_filter(overlay: &TextOverlay, text_file: &str, font_file: &str) -> Option<String> {
    let ranges: Vec<String> = overlay
        .ranges
        .iter()
        .filter(|(a, b)| a.is_finite() && b.is_finite() && b > a)
        .map(|(a, b)| format!("between(t,{},{})", number(*a), number(*b)))
        .collect();
    if ranges.is_empty() {
        return None;
    }
    let clamp = |v: f64, lo: f64, hi: f64| if v.is_finite() { v.clamp(lo, hi) } else { lo };
    let size = number(clamp(overlay.size, 0.02, 0.25));
    let color = hex_color(&overlay.color);
    let (font_color, background) = match overlay.style {
        TextStyle::Classic if overlay.boxed => (
            color.clone(),
            r":box=1:boxcolor=black@0.55:boxborderw=min(w\,h)*0.012".to_string(),
        ),
        TextStyle::Classic => (
            color.clone(),
            ":shadowcolor=black@0.75:shadowx=2:shadowy=2".to_string(),
        ),
        TextStyle::Outline => (color.clone(), ":borderw=6:bordercolor=black".to_string()),
        TextStyle::Neon => (
            "0xffffff".to_string(),
            format!(":borderw=7:bordercolor={color}"),
        ),
        TextStyle::Highlight => (
            contrast_text(&overlay.color).to_string(),
            format!(r":box=1:boxcolor={color}@0.95:boxborderw=min(w\,h)*0.015"),
        ),
        TextStyle::Comic => (
            color.clone(),
            ":borderw=5:bordercolor=black:shadowcolor=black:shadowx=5:shadowy=5".to_string(),
        ),
    };
    let (x, y) = (
        number(clamp(overlay.x, 0.0, 1.0)),
        number(clamp(overlay.y, 0.0, 1.0)),
    );
    if overlay.anim != TextAnim::None {
        let start = overlay.ranges.first().map(|r| r.0).unwrap_or(0.0);
        let end = overlay.ranges.last().map(|r| r.1).unwrap_or(start);
        let (alpha, scale, dx, dy) = text_anim_exprs(overlay.anim, start, end);
        return Some(format!(
            "drawtext=fontfile='{}':textfile='{}':expansion=none:fontsize='min(w,h)*{size}*{scale}':\
             fontcolor={font_color}:alpha='{alpha}':x='w*{x}-text_w/2+w*{dx}':y='h*{y}-text_h/2+h*{dy}'\
             {background}:enable='{}'",
            filter_path(font_file),
            filter_path(text_file),
            ranges.join("+"),
        ));
    }
    Some(format!(
        "drawtext=fontfile='{}':textfile='{}':expansion=none:fontsize=min(w\\,h)*{size}:fontcolor={}:\
         x=w*{}-text_w/2:y=h*{}-text_h/2{background}:enable='{}'",
        filter_path(font_file),
        filter_path(text_file),
        font_color,
        x,
        y,
        ranges.join("+"),
    ))
}

/// Görüntünün üstüne bindirilen resim (logo, çıkartma). Zamanlar çıktı saniyesi.
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageOverlay {
    pub path: String,
    pub ranges: Vec<(f64, f64)>,
    /// Merkezin konumu (0–1).
    pub x: f64,
    pub y: f64,
    /// Genişlik: çıkış karesinin genişliğine oranı.
    pub size: f64,
    /// 0–1.
    #[serde(default = "full_opacity")]
    pub opacity: f64,
}

fn full_opacity() -> f64 {
    1.0
}

/// Gizlenecek bölge (isim, sohbet, e-posta…): belirtilen sürelerde bulanık ya da
/// pikselli olur. Konum ve boyut birleşmiş görüntünün (çerçeveden önceki) oranıdır.
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlurRegion {
    pub ranges: Vec<(f64, f64)>,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    /// 0–1: ne kadar güçlü.
    #[serde(default = "full_opacity")]
    pub strength: f64,
    /// true: bulanık yerine iri pikseller (mozaik).
    #[serde(default)]
    pub pixel: bool,
    /// Hareketli gizleme: (çıktı saniyesi, x, y) anahtarları; aralarında doğrusal geçiş.
    #[serde(default)]
    pub keys: Vec<(f64, f64, f64)>,
}

/// Anahtarlar arasında doğrusal geçen `t` ifadesi (ilkinden önce ilki, sonuncudan sonra
/// sonuncusu). `pick` anahtarın değerini seçer, değerler `lo..=hi` aralığına sıkıştırılır.
fn keyed_expr(
    keys: &[(f64, f64, f64)],
    pick: fn(&(f64, f64, f64)) -> f64,
    lo: f64,
    hi: f64,
) -> String {
    let value = |k: &(f64, f64, f64)| pick(k).clamp(lo, hi);
    let last = keys.last().expect("anahtar var");
    let mut expr = number(value(last));
    for pair in keys.windows(2).rev() {
        let (a, b) = (&pair[0], &pair[1]);
        let span = (b.0 - a.0).max(1e-3);
        let (va, vb) = (value(a), value(b));
        expr = format!(
            "if(lt(t,{}),{}+({})*(t-{})/{},{expr})",
            number(b.0),
            number(va),
            number(vb - va),
            number(a.0),
            number(span),
        );
    }
    let first = &keys[0];
    format!(
        "if(lt(t,{}),{},{expr})",
        number(first.0),
        number(value(first))
    )
}

impl BlurRegion {
    /// `{FROM}` akışında bölgeyi bulanıklaştırıp `{TO}`ya yazar; `k` etiketleri ayırır.
    fn filter(&self, k: usize) -> Option<String> {
        let ranges: Vec<String> = self
            .ranges
            .iter()
            .filter(|(a, b)| a.is_finite() && b.is_finite() && b > a)
            .map(|(a, b)| format!("between(t,{},{})", number(*a), number(*b)))
            .collect();
        if ranges.is_empty() {
            return None;
        }
        let fin = |v: f64, d: f64| if v.is_finite() { v } else { d };
        let w = fin(self.w, 0.2).clamp(0.02, 1.0);
        let h = fin(self.h, 0.2).clamp(0.02, 1.0);
        let x = fin(self.x, 0.0).clamp(0.0, 1.0 - w);
        let y = fin(self.y, 0.0).clamp(0.0, 1.0 - h);
        let strength = fin(self.strength, 1.0).clamp(0.0, 1.0);
        let effect = if self.pixel {
            // Yukarı yuvarlanır: geri büyütülen kare kırpılandan küçük kalmaz, kenarda
            // pikselsiz şerit kalmaz (taşan birkaç piksel karenin dışına düşer).
            let n = (8.0 + 24.0 * strength).round() as u32;
            format!(
                "scale='max(1,ceil(iw/{n}))':'max(1,ceil(ih/{n}))':flags=neighbor,\
                 scale=iw*{n}:ih*{n}:flags=neighbor"
            )
        } else {
            let div = number(10.0 - 6.0 * strength);
            format!("boxblur=lr='min(w,h)/{div}':lp=2:cr='min(cw,ch)/{div}':cp=2")
        };
        let keys: Vec<(f64, f64, f64)> = self
            .keys
            .iter()
            .copied()
            .filter(|(t, x, y)| t.is_finite() && x.is_finite() && y.is_finite())
            .collect();
        let (px, py) = if keys.is_empty() {
            (number(x), number(y))
        } else {
            (
                format!("({})", keyed_expr(&keys, |k| k.1, 0.0, 1.0 - w)),
                format!("({})", keyed_expr(&keys, |k| k.2, 0.0, 1.0 - h)),
            )
        };
        Some(format!(
            "{{FROM}}split[bz{k}a][bz{k}b];[bz{k}b]crop=w=iw*{}:h=ih*{}:x='iw*{px}':y='ih*{py}',{effect}[bz{k}c];\
             [bz{k}a][bz{k}c]overlay=x='main_w*{px}':y='main_h*{py}':enable='{}'{{TO}}",
            number(w),
            number(h),
            ranges.join("+")
        ))
    }
}

impl ImageOverlay {
    /// Hareketli başlık (saydam VP9 WebM) mi, durağan resim mi.
    fn is_video(&self) -> bool {
        self.path.to_ascii_lowercase().ends_with(".webm")
    }

    /// Giriş argümanları. Resim sonsuz tekrarlanır; video ilk göründüğü ana
    /// kaydırılır ve saydamlık için libvpx ile çözülür (yerleşik VP9 çözücü
    /// saydam katmanı atar).
    pub fn input_args(&self) -> Vec<String> {
        if self.is_video() {
            let start = self
                .ranges
                .iter()
                .map(|(a, _)| *a)
                .find(|a| a.is_finite())
                .unwrap_or(0.0)
                .max(0.0);
            vec![
                "-c:v".into(),
                "libvpx-vp9".into(),
                "-itsoffset".into(),
                seconds_arg(start),
                "-i".into(),
                self.path.clone(),
            ]
        } else {
            vec!["-loop".into(), "1".into(), "-i".into(), self.path.clone()]
        }
    }

    /// `input`: resmin giriş sırası; `base` çıkış karesinin boyutu.
    fn filter(
        &self,
        input: usize,
        k: usize,
        from: &str,
        to: &str,
        base: (u32, u32),
    ) -> Option<String> {
        let ranges: Vec<String> = self
            .ranges
            .iter()
            .filter(|(a, b)| a.is_finite() && b.is_finite() && b > a)
            .map(|(a, b)| format!("between(t,{},{})", number(*a), number(*b)))
            .collect();
        if ranges.is_empty() {
            return None;
        }
        let clamp = |v: f64, lo: f64, hi: f64| if v.is_finite() { v.clamp(lo, hi) } else { lo };
        let width = ((base.0 as f64 * clamp(self.size, 0.02, 1.0)).round() as u32).max(2) & !1;
        Some(format!(
            "[{input}:v]scale={width}:-2,format=rgba,colorchannelmixer=aa={}[ov{k}];{from}[ov{k}]overlay=x='W*{}-w/2':y='H*{}-h/2':{}:enable='{}'{to}",
            number(clamp(self.opacity, 0.05, 1.0)),
            number(clamp(self.x, 0.0, 1.0)),
            number(clamp(self.y, 0.0, 1.0)),
            // Video bitince ana görüntü sürer; resim zaten sonsuz.
            if self.is_video() { "eof_action=pass" } else { "shortest=1" },
            ranges.join("+"),
        ))
    }
}

/// Müzik ya da ses efekti izi: kaynak dosyadan bir dilim, çıktıda bir anda başlar.
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicTrack {
    pub path: String,
    /// Çıktıda başladığı an (saniye).
    pub start: f64,
    /// Kaynak dosyadaki başlangıç ve süre.
    pub src_start: f64,
    pub length: f64,
    /// 0–2.
    #[serde(default = "full_opacity")]
    pub volume: f64,
    #[serde(default)]
    pub fade_in: f64,
    #[serde(default)]
    pub fade_out: f64,
    /// Klipte ses (konuşma) varken müzik kendiliğinden kısılsın.
    #[serde(default)]
    pub duck: bool,
    /// Ses zarfı: [parçanın başından saniye, düzey çarpanı] noktaları; arası doğrusal.
    #[serde(default)]
    pub envelope: Vec<[f64; 2]>,
}

/// Zarf noktalarından `volume` ifadesi: noktalar arası doğrusal, uçlarda sabit.
fn envelope_expr(points: &[[f64; 2]]) -> Option<String> {
    let pts: Vec<[f64; 2]> = points
        .iter()
        .filter(|[t, v]| t.is_finite() && v.is_finite())
        .map(|[t, v]| [*t, v.clamp(0.0, MAX_VOLUME)])
        .collect();
    if pts.is_empty() || pts.iter().all(|[_, v]| (v - 1.0).abs() < 1e-3) {
        return None;
    }
    let last = pts[pts.len() - 1][1];
    let mut expr = number(last);
    for w in pts.windows(2).rev() {
        let ([t0, v0], [t1, v1]) = (w[0], w[1]);
        let span = (t1 - t0).max(1e-6);
        expr = format!(
            "if(lt(t,{}),{}+({})*(t-{})/{},{expr})",
            number(t1),
            number(v0),
            number(v1 - v0),
            number(t0),
            number(span)
        );
    }
    Some(format!(
        "if(lt(t,{}),{},{expr})",
        number(pts[0][0]),
        number(pts[0][1])
    ))
}

impl MusicTrack {
    fn input_args(&self) -> Vec<String> {
        vec![
            "-ss".into(),
            seconds_arg(self.src_start.max(0.0)),
            "-t".into(),
            seconds_arg(self.length.max(0.1)),
            "-i".into(),
            self.path.clone(),
        ]
    }

    /// Sesi 48 kHz stereoya çeker, düzeyi ve geçişleri uygular, başlangıcına kaydırır.
    fn filter(&self, input: usize, k: usize) -> String {
        let length = self.length.max(0.1);
        let half = length / 2.0;
        let clamp = |v: f64, hi: f64| if v.is_finite() { v.clamp(0.0, hi) } else { 0.0 };
        let mut steps = vec![
            "aresample=48000".to_string(),
            "aformat=channel_layouts=stereo".into(),
            format!("volume={}", number(clamp(self.volume, MAX_VOLUME))),
        ];
        if let Some(expr) = envelope_expr(&self.envelope) {
            steps.push(format!("volume='{expr}':eval=frame"));
        }
        let (fade_in, fade_out) = (clamp(self.fade_in, half), clamp(self.fade_out, half));
        if fade_in > 0.0 {
            steps.push(format!("afade=t=in:st=0:d={}", number(fade_in)));
        }
        if fade_out > 0.0 {
            steps.push(format!(
                "afade=t=out:st={}:d={}",
                number(length - fade_out),
                number(fade_out)
            ));
        }
        let delay = (clamp(self.start, 86_400.0) * 1000.0).round() as u64;
        if delay > 0 {
            steps.push(format!("adelay={delay}|{delay}"));
        }
        format!("[{input}:a:0]{}[m{k}]", steps.join(","))
    }
}

/// Birleştirilmiş görüntüye uygulanan son filtreler: çerçeve, sonra yazılar
/// (yazılar çıkış karesine göre konumlanır).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct VideoPost {
    pub frame: Option<Frame>,
    /// Hazır drawtext filtreleri.
    pub texts: Vec<String>,
    /// Kaynağın boyutu: klip hareketleri ve geçiş stilleri buna göre hesaplanır.
    pub fx_size: Option<(u32, u32)>,
    /// Kaynağın kare hızı: klipler arası geçişte parçalar buna çekilir (yoksa 30).
    pub fps: Option<u32>,
    /// Hedef boyut için görüntü bit hızı (kbps); yoksa kalite odaklı (CRF).
    pub video_kbps: Option<u32>,
    /// Ekran kartı kodlayıcısı: "nvenc" | "amf" | "qsv" (yoksa işlemci, x264).
    pub gpu: Option<String>,
    /// Üste bindirilecek resimler (logo, çıkartma).
    pub images: Vec<ImageOverlay>,
    /// Klip sesiyle karıştırılacak müzik izleri.
    pub music: Vec<MusicTrack>,
    /// Gizlenecek bölgeler (çerçeveden önce uygulanır).
    pub blurs: Vec<BlurRegion>,
    /// İlerleme çubuğu ve çıktının süresi (saniye): bant video boyunca soldan dolar.
    pub progress: Option<(ProgressBar, f64)>,
    /// Üst izden bindirilen klipler (resim içinde resim): çerçeve ve yazılardan önce.
    pub overlays: Vec<ClipOverlay>,
    /// Karışımın hedef ses seviyesi (LUFS, ör. −14); yoksa olduğu gibi.
    pub loudness: Option<f64>,
}

/// Üst izdeki dönüşümlü klip: kendi girişinden okunur, birleşik görüntünün üstüne
/// dönüşümüyle biner (alttaki görüntü görünür kalır); sesi klip sesine karışır.
#[derive(Debug, Clone, PartialEq)]
pub struct ClipOverlay {
    pub path: String,
    /// Kaynaktaki aralık, hız, ses, görünüm, hareket ve dönüşüm.
    pub clip: Clip,
    /// Çıktıdaki başlangıç saniyesi.
    pub at: f64,
    /// Kaynağın boyutu (tuvale sığdırmak için); bilinmiyorsa görüntüsü atlanır.
    pub size: Option<(u32, u32)>,
    pub has_audio: bool,
}

/// `size` boyutunu `canvas` içine en-boy oranını koruyarak sığdırır (çift sayılar).
fn fit_size(size: (u32, u32), canvas: (u32, u32)) -> (u32, u32) {
    let scale =
        (canvas.0 as f64 / size.0.max(1) as f64).min(canvas.1 as f64 / size.1.max(1) as f64);
    let even = |v: f64| ((v.round() as u32).max(2)) & !1;
    (even(size.0 as f64 * scale), even(size.1 as f64 * scale))
}

impl ClipOverlay {
    fn input_args(&self) -> Vec<String> {
        vec![
            "-ss".into(),
            seconds_arg(self.clip.input_range().0),
            "-t".into(),
            seconds_arg(self.clip.input_range().1),
            "-i".into(),
            self.path.clone(),
        ]
    }

    /// Görüntü zinciri: hız, görünüm, tuvale sığdırma, hareket, saydam açılma/kararma,
    /// dönüşüm ve çıktıdaki yerine kaydırma.
    fn video_chain(&self, input: usize, k: usize, canvas: (u32, u32), fps: u32) -> Option<String> {
        let size = self.size?;
        let (w, h) = fit_size(size, canvas);
        let c = &self.clip;
        let mut steps: Vec<String> = c.speed_steps();
        steps.extend(c.look.steps());
        steps.push(format!("scale={w}:{h},setsar=1,fps={fps}"));
        // Yakınlaştırma klibin kendi görüntüsünde (bindirmeden önce).
        if let Some(zoom) = &c.zoom {
            steps.extend(zoom.chain_steps(w, h));
        }
        let fx = c.fx();
        steps.extend(fx.steps(Some((w, h))));
        steps.push("format=yuva420p".into());
        let (fade_in, fade_out) = c.fades();
        if fade_in > 0.0 {
            steps.push(format!("fade=t=in:st=0:d={}:alpha=1", number(fade_in)));
        }
        if fade_out > 0.0 {
            let start = (c.output_duration() - fade_out).max(0.0);
            steps.push(format!(
                "fade=t=out:st={}:d={}:alpha=1",
                number(start),
                number(fade_out)
            ));
        }
        if let Some(tr) = &c.transform {
            steps.extend(tr.overlay_steps(w, h));
        }
        steps.push(format!("setpts=PTS-STARTPTS+{}/TB", number(self.at)));
        Some(format!("[{input}:v:0]{}[ov{k}]", steps.join(",")))
    }

    /// `{FROM}` görüntüsünün üstüne bindirme (`[ov{k}]` hazır olmalı).
    fn overlay_filter(&self, k: usize) -> String {
        let at = number(self.at);
        let end = number(self.at + self.clip.output_duration());
        let tr = self.clip.transform.clone().unwrap_or_default();
        let (x, y) = tr.overlay_xy(&format!("(t-{at})"));
        format!(
            "{{FROM}}[ov{k}]overlay=x='{x}':y='{y}':eval=frame:eof_action=pass:enable='between(t,{at},{end})'{{TO}}"
        )
    }

    /// Ses zinciri: hız, düzey, açılma/kararma, sonra çıktıdaki yerine gecikme.
    fn audio_chain(&self, input: usize, k: usize) -> String {
        let mut steps = vec!["aresample=48000".to_string()];
        steps.extend(self.clip.audio_steps());
        steps.push(format!(
            "adelay=delays={}:all=1",
            (self.at.max(0.0) * 1000.0).round() as u64
        ));
        format!("[{input}:a:0]{}[oa{k}]", steps.join(","))
    }
}

/// Bindirmeleri `from` görüntüsünün üstüne sırayla ekler; `inputs[k]` bindirmenin
/// giriş sırasıdır (görüntüsü olmayan atlanır). Son etiketi döner.
fn composite_overlays(
    filter: &mut String,
    from: &str,
    overlays: &[(usize, &ClipOverlay)],
    canvas: (u32, u32),
    fps: u32,
    to: &str,
) {
    let mut stages: Vec<String> = Vec::new();
    for (k, (input, overlay)) in overlays.iter().enumerate() {
        if let Some(chain) = overlay.video_chain(*input, k, canvas, fps) {
            filter.push(';');
            filter.push_str(&chain);
            stages.push(overlay.overlay_filter(k));
        }
    }
    if stages.is_empty() {
        filter.push_str(&format!(";{from}null{to}"));
    } else {
        link_stages(filter, &stages, from, "ovs", to);
    }
}

/// Videonun ne kadarının geçtiğini gösteren bant (üstte ya da altta).
#[derive(Debug, Clone, Copy, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressBar {
    pub color: Color,
    /// Yükseklik: çıkış yüksekliğinin oranı.
    #[serde(default = "progress_height")]
    pub height: f64,
    #[serde(default)]
    pub top: bool,
}

fn progress_height() -> f64 {
    0.012
}

impl ProgressBar {
    /// `{FROM}` üstüne `base` boyutunda bant; `duration` saniyede tamamen dolar.
    fn filter(&self, base: (u32, u32), duration: f64) -> Option<String> {
        if !duration.is_finite() || duration <= 0.0 {
            return None;
        }
        let h = (((base.1 as f64 * self.height.clamp(0.004, 0.06)).round() as u32).max(2)) & !1;
        let [r, g, b] = self.color.0;
        let y = if self.top {
            "0".to_string()
        } else {
            "main_h-overlay_h".to_string()
        };
        Some(format!(
            "color=c=0x{r:02x}{g:02x}{b:02x}:s={}x{h}:r=30[pbar];\
             {{FROM}}[pbar]overlay=x='-W+W*min(t/{},1)':y={y}:shortest=1{{TO}}",
            base.0.max(2) & !1,
            number(duration),
        ))
    }
}

impl VideoPost {
    #[cfg(test)]
    pub fn framed(frame: Frame) -> VideoPost {
        VideoPost {
            frame: Some(frame),
            ..VideoPost::default()
        }
    }

    /// Görüntüye dokunan bir şey yok: tek klip kopyalanarak kesilebilir. Hedef
    /// boyut verildiyse yeniden kodlamak gerekir.
    pub fn is_empty(&self) -> bool {
        self.frame.is_none()
            && self.texts.is_empty()
            && self.video_kbps.is_none()
            && self.images.is_empty()
            && self.music.is_empty()
            && self.blurs.is_empty()
            && self.progress.is_none()
            && self.overlays.is_empty()
            && self.loudness.is_none()
    }

    fn chain(&self) -> Option<String> {
        let mut steps: Vec<String> = self.frame.iter().map(Frame::filter).collect();
        steps.extend(self.texts.iter().cloned());
        (!steps.is_empty()).then(|| steps.join(","))
    }

    /// Birleşik görüntüye sırayla uygulanacak aşamalar (`{FROM}` → `{TO}`): gizleme
    /// bölgeleri (kaynak karesinde), çerçeve ve yazılar, sonra resimler. `image_input`:
    /// ilk resmin giriş sırası; `base`: çıkış karesinin boyutu (bilinmiyorsa resim yok).
    fn stages(&self, image_input: usize, base: Option<(u32, u32)>) -> Vec<String> {
        let mut stages: Vec<String> = self
            .blurs
            .iter()
            .enumerate()
            .filter_map(|(k, b)| b.filter(k))
            .collect();
        if let Some(chain) = self.chain() {
            stages.push(format!("{{FROM}}{chain}{{TO}}"));
        }
        if let Some(base) = base {
            stages.extend(
                self.images.iter().enumerate().filter_map(|(k, image)| {
                    image.filter(image_input + k, k, "{FROM}", "{TO}", base)
                }),
            );
            // İlerleme çubuğu en üstte.
            if let Some((bar, duration)) = self.progress {
                stages.extend(bar.filter(base, duration));
            }
        }
        stages
    }
}

/// Aşamaları `from` etiketinden başlayıp `last` etiketine bağlar; son etiketi döner.
fn link_stages(
    filter: &mut String,
    stages: &[String],
    from: &str,
    prefix: &str,
    last: &str,
) -> String {
    let mut from = from.to_string();
    for (i, step) in stages.iter().enumerate() {
        let to = if i + 1 == stages.len() {
            last.to_string()
        } else {
            format!("[{prefix}{i}]")
        };
        filter.push(';');
        filter.push_str(&step.replace("{FROM}", &from).replace("{TO}", &to));
        from = to;
    }
    from
}

impl Clip {
    /// Efektsiz klip (normal hız, özgün ses, geçiş yok).
    #[cfg(test)]
    pub fn new(start: f64, end: f64) -> Clip {
        Clip {
            source: 0,
            start,
            end,
            speed: 1.0,
            volume: 1.0,
            fade_in: 0.0,
            fade_out: 0.0,
            look: Look::default(),
            fade_white: false,
            black: false,
            motion: Motion::None,
            motion_strength: 0.0,
            motion_offset: 0.0,
            motion_total: 0.0,
            transition: Transition::Fade,
            xfade: None,
            denoise: false,
            audio_fx: None,
            motion_blur: false,
            freeze_at: None,
            reverse: false,
            transform: None,
            zoom: None,
            pad_head: 0.0,
            pad_tail: 0.0,
        }
    }

    /// `seconds` sürelik siyah boşluk.
    #[cfg(test)]
    pub fn black(seconds: f64) -> Clip {
        Clip {
            black: true,
            ..Clip::new(0.0, seconds.max(0.0))
        }
    }

    /// Kaynaktaki uzunluk.
    pub fn duration(&self) -> f64 {
        (self.end - self.start).max(0.0)
    }

    /// Girişin kaynaktan okunacak aralığı (`-ss`, `-t`): siyah boşluk ve dondurulmuş
    /// kare küçük bir dilimden üretilir.
    pub fn input_range(&self) -> (f64, f64) {
        if self.black {
            (0.0, BLACK_SOURCE_SECONDS)
        } else if let Some(at) = self.freeze_at {
            (at.max(0.0), BLACK_SOURCE_SECONDS)
        } else {
            (self.start, self.duration())
        }
    }

    pub fn speed(&self) -> f64 {
        if self.black {
            return 1.0;
        }
        if self.freeze_at.is_some() {
            // Dondurulmuş karede hız yalnızca süreyi belirler (setpts uygulanmaz).
            return if self.speed.is_finite() && self.speed > 0.0 {
                self.speed
            } else {
                1.0
            };
        }
        if self.speed.is_finite() {
            self.speed.clamp(MIN_SPEED, MAX_SPEED)
        } else {
            1.0
        }
    }

    pub fn is_normal_speed(&self) -> bool {
        (self.speed() - 1.0).abs() < 1e-6
    }

    /// Hız (`setpts`) ve istenirse hareket bulanıklığı: hız 1'den büyükse atlanan
    /// kareler de karışsın diye kare karıştırma hızdan sonra, en fazla 5 kare.
    fn speed_steps(&self) -> Vec<String> {
        let mut steps = Vec::new();
        if self.freeze_at.is_some() {
            // İlk kare süre boyunca uzatılır; görünüm ve dönüşüm ardından uygulanır.
            let d = number(self.output_duration());
            return vec![
                "trim=end_frame=1".into(),
                format!("tpad=stop_mode=clone:stop_duration={d}"),
                format!("trim=duration={d}"),
                "setpts=PTS-STARTPTS".into(),
            ];
        }
        if self.reverse {
            steps.push("reverse".into());
        }
        if !self.is_normal_speed() {
            steps.push(format!("setpts=PTS/{}", number(self.speed())));
        }
        if self.motion_blur {
            let frames = (self.speed().ceil() as u32 + 1).clamp(2, 5);
            let weights = vec!["1"; frames as usize].join(" ");
            steps.push(format!("tmix=frames={frames}:weights='{weights}'"));
        }
        steps
    }

    /// Çıktıdaki uzunluk (hız uygulanmış).
    pub fn output_duration(&self) -> f64 {
        self.duration() / self.speed()
    }

    /// Geçiş payları dahil uzunluk: birleştirmeye giren akışın süresi.
    pub fn joined_duration(&self) -> f64 {
        self.output_duration() + self.pad_head + self.pad_tail
    }

    /// Sonraki parçaya geçişin süresi (yoksa 0).
    pub fn xfade_seconds(&self) -> f64 {
        self.xfade.map(|x| x.seconds()).unwrap_or(0.0)
    }

    pub fn volume(&self) -> f64 {
        if self.volume.is_finite() {
            self.volume.clamp(0.0, MAX_VOLUME)
        } else {
            1.0
        }
    }

    /// Geçiş süreleri; ikisi toplam çıktı süresini aşamaz.
    pub fn fades(&self) -> (f64, f64) {
        let half = self.output_duration() / 2.0;
        let clamp = |v: f64| {
            if v.is_finite() {
                v.clamp(0.0, half)
            } else {
                0.0
            }
        };
        (clamp(self.fade_in), clamp(self.fade_out))
    }

    /// Kopyalayarak kesilemez: hız, ses düzeyi ya da geçiş var.
    pub fn has_effects(&self) -> bool {
        let (fade_in, fade_out) = self.fades();
        self.black
            || !self.look.is_default()
            || !self.is_normal_speed()
            || (self.volume() - 1.0).abs() > 1e-6
            || fade_in > 0.0
            || fade_out > 0.0
            || self.motion != Motion::None
            || self.xfade.is_some()
            || self.denoise
            || self
                .audio_fx
                .as_ref()
                .is_some_and(|f| !f.steps().is_empty())
            || self.motion_blur
            || self.freeze_at.is_some()
            || self.reverse
            || self.transform.as_ref().is_some_and(|t| !t.is_identity())
            || self.zoom.as_ref().is_some_and(|t| !t.is_identity())
    }

    fn fx(&self) -> FxInput {
        let (fade_in, fade_out) = self.fades();
        FxInput {
            motion: self.motion,
            strength: self.motion_strength,
            offset: self.motion_offset,
            total: self.motion_total,
            transition: self.transition,
            duration: self.output_duration(),
            fade_in,
            fade_out,
        }
    }

    /// Görüntü filtreleri: hız, görünüm, hareket, sonra geçişler (çıktı zamanında).
    /// `size`: kaynağın boyutu (hareket ve geçiş stilleri için gerekir).
    fn video_steps(&self, size: Option<(u32, u32)>) -> Vec<String> {
        let mut steps = self.content_video_steps(size);
        // Geçiş payı kaynakta yoksa uçtaki kare dondurulur.
        if self.pad_head > 0.0 {
            steps.push(format!(
                "tpad=start_mode=clone:start_duration={}",
                number(self.pad_head)
            ));
        }
        if self.pad_tail > 0.0 {
            steps.push(format!(
                "tpad=stop_mode=clone:stop_duration={}",
                number(self.pad_tail)
            ));
        }
        steps
    }

    fn content_video_steps(&self, size: Option<(u32, u32)>) -> Vec<String> {
        if self.black {
            // Kaynaktan alınan küçük dilimin son karesi boşluk boyunca uzatılır ve
            // siyaha boyanır: çözünürlük ve biçim diğer parçalarla aynı kalır.
            let d = number(self.output_duration());
            return vec![
                format!("tpad=stop_mode=clone:stop_duration={d}"),
                format!("trim=duration={d}"),
                "setpts=PTS-STARTPTS".into(),
                "drawbox=c=black:t=fill".into(),
            ];
        }
        let mut steps = self.speed_steps();
        steps.extend(self.look.steps());
        // Dönüşüm klibin kendi karesinde (siyah zemin), hareket ve geçişten önce.
        if let Some((w, h)) = size {
            for tr in [&self.transform, &self.zoom].into_iter().flatten() {
                steps.extend(tr.chain_steps(w, h));
            }
        }
        let fx = self.fx();
        steps.extend(fx.steps(size));
        if !fx.wants_fade() {
            return steps;
        }
        let (fade_in, fade_out) = self.fades();
        let color = if self.fade_white { ":c=white" } else { "" };
        if fade_in > 0.0 {
            steps.push(format!("fade=t=in:st=0:d={}{color}", number(fade_in)));
        }
        if fade_out > 0.0 {
            let start = (self.output_duration() - fade_out).max(0.0);
            steps.push(format!(
                "fade=t=out:st={}:d={}{color}",
                number(start),
                number(fade_out)
            ));
        }
        steps
    }

    /// Ses filtreleri: hız, düzey, geçişler.
    fn audio_steps(&self) -> Vec<String> {
        if self.black {
            let d = number(self.output_duration());
            return vec![
                "volume=0".into(),
                format!("apad=whole_dur={d}"),
                format!("atrim=duration={d}"),
                "asetpts=PTS-STARTPTS".into(),
            ];
        }
        if self.freeze_at.is_some() {
            let d = number(self.output_duration());
            return vec![
                "volume=0".into(),
                format!("apad=whole_dur={d}"),
                format!("atrim=duration={d}"),
                "asetpts=PTS-STARTPTS".into(),
            ];
        }
        let mut steps = Vec::new();
        if self.reverse {
            steps.push("areverse".into());
        }
        if !self.is_normal_speed() {
            steps.push(atempo_chain(self.speed()));
        }
        if let Some(fx) = self.audio_fx.as_ref().filter(|f| !f.steps().is_empty()) {
            steps.extend(fx.steps());
        } else if self.denoise {
            // Gürültü tabanı -25 dB: konuşmayı bozmadan fan ve uğultu sesini bastırır.
            steps.push("afftdn=nf=-25".into());
        }
        if (self.volume() - 1.0).abs() > 1e-6 {
            steps.push(format!("volume={}", number(self.volume())));
        }
        let (fade_in, fade_out) = self.fades();
        if fade_in > 0.0 {
            steps.push(format!("afade=t=in:st=0:d={}", number(fade_in)));
        }
        if fade_out > 0.0 {
            let start = (self.output_duration() - fade_out).max(0.0);
            steps.push(format!(
                "afade=t=out:st={}:d={}",
                number(start),
                number(fade_out)
            ));
        }
        // Görüntüde dondurulan pay seste sessizlikle doldurulur.
        if self.pad_head > 0.0 {
            steps.push(format!(
                "adelay=delays={}:all=1",
                (self.pad_head * 1000.0).round() as u64
            ));
        }
        if self.pad_tail > 0.0 {
            steps.push(format!("apad=pad_dur={}", number(self.pad_tail)));
        }
        steps
    }
}

/// Klipler arası geçişleri hazırlar: geçerli olmayanları (son parça, siyah
/// boşluk, çok kısa) kaldırır; geçerli olanlarda kesimin iki yanına süre/2 kadar
/// kaynak payı ekler. Böylece zaman çizelgesindeki toplam süre değişmez, yazı ve
/// müzik zamanları kaymaz. Kaynakta yeterli kare yoksa eksik pay uçtaki kareyle
/// dondurulur (`pad_head`/`pad_tail`). `limit`: klibin kaynağının süresi.
/// Kesimin iki yanındaki açılma/kararma kapanır (geçiş onların yerini alır).
pub fn apply_xfade_handles(clips: &mut [Clip], limit: impl Fn(&Clip) -> f64) {
    let n = clips.len();
    let mut seconds = vec![0.0_f64; n];
    for i in 0..n.saturating_sub(1) {
        let (a, b) = (&clips[i], &clips[i + 1]);
        if a.black || b.black {
            continue;
        }
        let d = a
            .xfade_seconds()
            .min(a.output_duration())
            .min(b.output_duration());
        if d >= xfade::MIN_SECONDS {
            seconds[i] = d;
        }
    }
    for i in 0..n {
        let max = limit(&clips[i]).max(0.0);
        let c = &mut clips[i];
        let speed = c.speed();
        c.pad_head = 0.0;
        c.pad_tail = 0.0;
        if seconds[i] > 0.0 {
            let half = seconds[i] / 2.0;
            let take = ((max - c.end).max(0.0) / speed).min(half);
            c.end += take * speed;
            c.pad_tail = half - take;
            c.fade_out = 0.0;
            c.xfade = c.xfade.map(|x| Xfade {
                duration: seconds[i],
                ..x
            });
        } else {
            c.xfade = None;
        }
        if i > 0 && seconds[i - 1] > 0.0 {
            let half = seconds[i - 1] / 2.0;
            let take = (c.start.max(0.0) / speed).min(half);
            c.start -= take * speed;
            c.pad_head = half - take;
            c.fade_in = 0.0;
        }
    }
}

/// Birleşmiş çıktının süresi: payları dahil parçalar, eksi geçişlerin örtüşmesi.
pub fn joined_seconds(clips: &[Clip]) -> f64 {
    let total: f64 = clips.iter().map(Clip::joined_duration).sum();
    let overlap: f64 = clips
        .iter()
        .take(clips.len().saturating_sub(1))
        .map(Clip::xfade_seconds)
        .sum();
    (total - overlap).max(0.0)
}

fn number(value: f64) -> String {
    let text = format!("{value:.4}");
    text.trim_end_matches('0').trim_end_matches('.').to_string()
}

/// Sesi hızlandırır/yavaşlatır. `atempo` tek adımda 0,5–2 arasını kabul ettiği
/// için 4× gibi değerler zincirlenir (2 × 2).
pub fn atempo_chain(speed: f64) -> String {
    let mut rest = speed.clamp(MIN_SPEED, MAX_SPEED);
    let mut parts = Vec::new();
    while rest > 2.0 + 1e-9 {
        parts.push("atempo=2".to_string());
        rest /= 2.0;
    }
    while rest < 0.5 - 1e-9 {
        parts.push("atempo=0.5".to_string());
        rest /= 0.5;
    }
    parts.push(format!("atempo={}", number(rest)));
    parts.join(",")
}

/// Yalnızca ses dışa aktarımında desteklenen biçimler.
pub const AUDIO_FORMATS: [&str; 4] = ["mp3", "m4a", "wav", "flac"];

/// Ses biçimine göre kodlayıcı argümanları. Bilinmeyen biçim m4a (AAC) sayılır.
pub fn audio_codec_args(format: &str, bitrate_kbps: u32) -> Vec<String> {
    let bitrate = format!("{}k", bitrate_kbps.clamp(64, 320));
    match format {
        "mp3" => vec!["-c:a".into(), "libmp3lame".into(), "-b:a".into(), bitrate],
        "wav" => vec!["-c:a".into(), "pcm_s16le".into()],
        "flac" => vec!["-c:a".into(), "flac".into()],
        _ => vec!["-c:a".into(), "aac".into(), "-b:a".into(), bitrate],
    }
}

/// Yeniden kodlama argümanları; WebM için VP9/Opus, diğerleri için H.264/AAC.
/// `post.video_kbps`: hedef boyut için sabit bit hızı (ör. Discord 10 MB);
/// `post.gpu`: ekran kartının kodlayıcısı (hızlı dışa aktarma).
fn video_encode_args(container: &str, post: &VideoPost) -> Vec<String> {
    let kbps = post.video_kbps.map(|k| k.clamp(150, 200_000));
    let rate = |args: &mut Vec<String>, k: u32| {
        args.extend([
            "-b:v".into(),
            format!("{k}k"),
            "-maxrate".into(),
            format!("{}k", k * 6 / 5),
            "-bufsize".into(),
            format!("{}k", k * 2),
        ]);
    };
    let mut args: Vec<String> = Vec::new();
    if container == "webm" {
        args.extend(["-c:v", "libvpx-vp9"].map(String::from));
        match kbps {
            Some(k) => rate(&mut args, k),
            None => args.extend(["-b:v", "0", "-crf", "32"].map(String::from)),
        }
        args.extend(
            [
                "-deadline",
                "realtime",
                "-cpu-used",
                "8",
                "-row-mt",
                "1",
                "-c:a",
                "libopus",
                "-b:a",
                "160k",
            ]
            .map(String::from),
        );
        return args;
    }
    match post.gpu.as_deref() {
        Some("nvenc") => {
            args.extend(["-c:v", "h264_nvenc", "-preset", "p4"].map(String::from));
            match kbps {
                Some(k) => rate(&mut args, k),
                None => args.extend(["-rc", "vbr", "-cq", "21", "-b:v", "0"].map(String::from)),
            }
        }
        Some("amf") => {
            args.extend(["-c:v", "h264_amf", "-quality", "balanced"].map(String::from));
            match kbps {
                Some(k) => rate(&mut args, k),
                None => args.extend(
                    ["-rc", "cqp", "-qp_i", "20", "-qp_p", "22", "-qp_b", "24"].map(String::from),
                ),
            }
        }
        Some("qsv") => {
            args.extend(["-c:v", "h264_qsv", "-preset", "medium"].map(String::from));
            match kbps {
                Some(k) => rate(&mut args, k),
                None => args.extend(["-global_quality", "22"].map(String::from)),
            }
        }
        _ => {
            args.extend(["-c:v", "libx264", "-preset", "veryfast"].map(String::from));
            match kbps {
                Some(k) => rate(&mut args, k),
                None => args.extend(["-crf", "20"].map(String::from)),
            }
        }
    }
    args.extend(["-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a"].map(String::from));
    // Hedef boyutta ses de küçülür ki toplam sığsın.
    args.push(if kbps.is_some() { "128k" } else { "192k" }.into());
    if matches!(container, "mp4" | "mov" | "m4v") {
        args.extend(["-movflags", "+faststart"].map(String::from));
    }
    args
}

fn progress_args(output: &str) -> Vec<String> {
    vec![
        "-progress".into(),
        "pipe:1".into(),
        "-nostats".into(),
        output.into(),
    ]
}

/// Kaynaktaki akışlar: birleştirme filtresi hangi akışları bağlayacağını buna göre kurar.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Streams {
    pub video: bool,
    pub audio: bool,
}

/// Birden çok klibi sırayla tek dosyada birleştirir (yeniden kodlar).
///
/// Her klip, girişten önce `-ss`/`-t` ile ayrı bir giriş olarak açılır: FFmpeg
/// 1 saatlik dosyada bile doğrudan o sahneye atlar, baştan çözmek gerekmez.
/// `audio_format` verilirse yalnızca ses çıkar.
pub fn merge_args(
    input: &str,
    output: &str,
    clips: &[Clip],
    streams: Streams,
    audio_format: Option<(&str, u32)>,
    post: &VideoPost,
) -> Vec<String> {
    let inputs: Vec<MergeInput> = clips
        .iter()
        .map(|c| MergeInput {
            path: input,
            // Siyah boşluk kaynağın başından küçük bir dilimle üretilir.
            range: Some(c.input_range()),
            clip: c.clone(),
        })
        .collect();
    merge_inputs_args(&inputs, output, streams, None, false, audio_format, post)
}

/// Birleştirilecek tek giriş: dosya, isteğe bağlı başlangıç/süre ve klibin
/// efektleri (hız, ses düzeyi, geçişler).
#[derive(Debug, Clone, PartialEq)]
pub struct MergeInput<'a> {
    pub path: &'a str,
    /// Verilirse giriş bu andan açılır (`-ss`) ve bu kadar okunur (`-t`).
    pub range: Option<(f64, f64)>,
    /// Efektler ve süre (geçişin nerede başlayacağı için) buradan okunur.
    pub clip: Clip,
}

/// Bir akışa filtre zinciri uygular; zincir boşsa akış olduğu gibi kullanılır.
fn chain(filter: &mut String, input: &str, steps: &[String], output: &str) -> String {
    if steps.is_empty() {
        input.to_string()
    } else {
        filter.push_str(&format!("{input}{}{output};", steps.join(",")));
        output.to_string()
    }
}

/// `merge_args`'ın genel hâli: girişler farklı dosyalar olabilir (ör. linkten
/// indirilmiş bölümler). Hızı 1 olmayan girişlerde görüntü `setpts`, ses `atempo`
/// ile hızlandırılır.
///
/// `normalize_video`: farklı kaynaklar birleştirilirken her giriş önce bu
/// boyuta sığdırılır (en-boy korunur, kalanı siyah bant) ve ortak kare
/// hızı/piksel biçimine çekilir; yoksa `concat` farklı boyutlarda çöker.
/// `normalize_audio`: her ses girişi 48 kHz stereoya çekilir.
pub fn merge_inputs_args(
    inputs: &[MergeInput],
    output: &str,
    streams: Streams,
    normalize_video: Option<(u32, u32)>,
    normalize_audio: bool,
    audio_format: Option<(&str, u32)>,
    post: &VideoPost,
) -> Vec<String> {
    let video = streams.video && audio_format.is_none();
    let audio = streams.audio;
    let mut args: Vec<String> = vec!["-y".into()];
    for input in inputs {
        if let Some((start, duration)) = input.range {
            args.extend([
                "-ss".into(),
                seconds_arg(start),
                "-t".into(),
                seconds_arg(duration),
            ]);
        }
        args.extend(["-i".into(), input.path.into()]);
    }
    // Bindirilecek resimler kliplerin ardından ayrı giriş olarak açılır.
    let images: &[ImageOverlay] = if video { &post.images } else { &[] };
    for image in images {
        args.extend(image.input_args());
    }
    // Müzik izleri en sonda; çıktı görüntüyle (ya da klip sesiyle) aynı sürede biter.
    let music = &post.music;
    for track in music {
        args.extend(track.input_args());
    }
    let music_base = inputs.len() + images.len();
    // Bindirilen klipler en sonda: görüntüsü (tuval biliniyorsa) ya da sesi kullanılacaksa.
    let canvas = normalize_video.or(post.fx_size);
    let mut video_overlays: Vec<(usize, &ClipOverlay)> = Vec::new();
    let mut audio_overlays: Vec<(usize, &ClipOverlay)> = Vec::new();
    let mut next_input = music_base + music.len();
    for overlay in &post.overlays {
        let shows = video && canvas.is_some() && overlay.size.is_some();
        let sounds = audio && overlay.has_audio;
        if !shows && !sounds {
            continue;
        }
        args.extend(overlay.input_args());
        if shows {
            video_overlays.push((next_input, overlay));
        }
        if sounds {
            audio_overlays.push((next_input, overlay));
        }
        next_input += 1;
    }

    // Klipler arası geçiş varsa parçalar concat yerine ikişer ikişer xfade /
    // acrossfade ile bağlanır (son parçanın geçişi yok sayılır).
    let joins: Vec<f64> = inputs
        .iter()
        .take(inputs.len().saturating_sub(1))
        .map(|i| i.clip.xfade_seconds())
        .collect();
    let crossfaded = joins.iter().any(|d| *d > 0.0);
    let fps = if normalize_video.is_some() {
        30
    } else {
        post.fps.unwrap_or(30)
    };

    let mut filter = String::new();
    let mut labels = String::new();
    let mut video_labels: Vec<String> = Vec::new();
    let mut audio_labels: Vec<String> = Vec::new();
    for (index, input) in inputs.iter().enumerate() {
        if video {
            let mut steps: Vec<String> = Vec::new();
            if let Some((w, h)) = normalize_video {
                steps.push(format!(
                    "scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30,format=yuv420p"
                ));
            }
            steps.extend(input.clip.video_steps(normalize_video.or(post.fx_size)));
            if crossfaded {
                steps.push(xfade::normalize_step(fps));
            }
            let label = chain(
                &mut filter,
                &format!("[{index}:v:0]"),
                &steps,
                &format!("[v{index}]"),
            );
            labels.push_str(&label);
            video_labels.push(label);
        }
        if audio {
            let mut steps: Vec<String> = Vec::new();
            if normalize_audio {
                steps.push("aresample=48000,aformat=channel_layouts=stereo".into());
            }
            steps.extend(input.clip.audio_steps());
            let label = chain(
                &mut filter,
                &format!("[{index}:a:0]"),
                &steps,
                &format!("[a{index}]"),
            );
            labels.push_str(&label);
            audio_labels.push(label);
        }
    }
    if !crossfaded {
        filter.push_str(&labels);
        filter.push_str(&format!(
            "concat=n={}:v={}:a={}",
            inputs.len(),
            u8::from(video),
            u8::from(audio)
        ));
    }
    // Resimler çıkış karesine göre ölçeklenir: çerçeve, ortak boyut ya da kaynak.
    let base = post
        .frame
        .as_ref()
        .map(|f| (f.width, f.height))
        .or(normalize_video)
        .or(post.fx_size);
    // Sıra: gizleme bölgeleri (kaynak karesinde), çerçeve ve yazılar, sonra resimler.
    let stages: Vec<String> = if video {
        post.stages(inputs.len(), base)
    } else {
        Vec::new()
    };
    let staged = !stages.is_empty();
    let video_final = if staged { "[vc]" } else { "[v]" };
    let audio_final = if music.is_empty() { "[a]" } else { "[ac]" };
    // Bindirme varsa birleşik akış önce ara etikete yazılır.
    let video_out = if video_overlays.is_empty() {
        video_final
    } else {
        "[vb]"
    };
    let audio_out = if audio_overlays.is_empty() {
        audio_final
    } else {
        "[ab]"
    };
    if crossfaded {
        // Her geçiş, o ana kadarki birleşik akışın sonundan süresi kadar önce başlar.
        let mut parts: Vec<String> = Vec::new();
        if video {
            let mut from = video_labels[0].clone();
            let mut length = inputs[0].clip.joined_duration();
            for k in 1..inputs.len() {
                let d = joins[k - 1];
                let to = if k + 1 == inputs.len() {
                    video_out.to_string()
                } else {
                    format!("[xv{k}]")
                };
                let kind = inputs[k - 1].clip.xfade.map(|x| x.kind).filter(|_| d > 0.0);
                parts.push(xfade::video_join(
                    &from,
                    &video_labels[k],
                    kind.map(|kind| (kind, d)),
                    length - d,
                    &to,
                ));
                length += inputs[k].clip.joined_duration() - if kind.is_some() { d } else { 0.0 };
                from = to;
            }
        }
        if audio {
            let mut from = audio_labels[0].clone();
            for k in 1..inputs.len() {
                let d = joins[k - 1];
                let to = if k + 1 == inputs.len() {
                    audio_out.to_string()
                } else {
                    format!("[xa{k}]")
                };
                parts.push(xfade::audio_join(
                    &from,
                    &audio_labels[k],
                    (d > 0.0).then_some(d),
                    &to,
                ));
                from = to;
            }
        }
        filter.push_str(&parts.join(";"));
    } else {
        if video {
            filter.push_str(video_out);
        }
        if audio {
            filter.push_str(audio_out);
        }
    }
    if let (false, Some(canvas)) = (video_overlays.is_empty(), canvas) {
        composite_overlays(
            &mut filter,
            "[vb]",
            &video_overlays,
            canvas,
            fps,
            video_final,
        );
    }
    if !audio_overlays.is_empty() {
        let mut mix = "[ab]".to_string();
        for (k, (input, overlay)) in audio_overlays.iter().enumerate() {
            filter.push(';');
            filter.push_str(&overlay.audio_chain(*input, k));
            mix.push_str(&format!("[oa{k}]"));
        }
        filter.push_str(&format!(
            ";{mix}amix=inputs={}:duration=first:normalize=0{audio_final}",
            audio_overlays.len() + 1
        ));
    }
    if !music.is_empty() {
        let mut mix = String::new();
        for (k, track) in music.iter().enumerate() {
            filter.push(';');
            filter.push_str(&track.filter(music_base + k, k));
            mix.push_str(&format!("[m{k}]"));
        }
        if audio {
            // Kısılacak müzikler klip sesini tetik olarak dinler (sidechaincompress):
            // konuşma başlayınca müzik yumuşakça iner, bitince geri çıkar.
            let ducked: Vec<usize> = (0..music.len()).filter(|k| music[*k].duck).collect();
            let mut clip = "[ac]".to_string();
            if !ducked.is_empty() {
                let mut outs = "[acm]".to_string();
                for k in &ducked {
                    outs.push_str(&format!("[acs{k}]"));
                }
                filter.push_str(&format!(";[ac]asplit={}{outs}", ducked.len() + 1));
                clip = "[acm]".into();
                for k in &ducked {
                    filter.push_str(&format!(
                        ";[m{k}][acs{k}]sidechaincompress=threshold=0.03:ratio=8:attack=30:release=600[md{k}]"
                    ));
                    mix = mix.replace(&format!("[m{k}]"), &format!("[md{k}]"));
                }
            }
            // Klip sesi baştadır: karışım onun süresi kadar sürer.
            filter.push_str(&format!(
                ";{clip}{mix}amix=inputs={}:duration=first:normalize=0[a]",
                music.len() + 1
            ));
        } else if music.len() == 1 {
            filter.push_str(";[m0]anull[a]");
        } else {
            filter.push_str(&format!(
                ";{mix}amix=inputs={}:duration=longest:normalize=0[a]",
                music.len()
            ));
        }
    }
    if staged {
        link_stages(&mut filter, &stages, "[vc]", "vo", "[v]");
    }
    // Hedef ses seviyesi bütün karışıma en sonda uygulanır.
    let mut audio_label = "[a]";
    if let (true, Some(lufs)) = (audio || !music.is_empty(), post.loudness) {
        filter.push_str(&format!(";[a]{},aresample=48000[aln]", loudness_step(lufs)));
        audio_label = "[aln]";
    }
    args.extend(["-filter_complex".into(), filter]);
    if video {
        args.extend(["-map".into(), "[v]".into()]);
    }
    if audio || !music.is_empty() {
        args.extend(["-map".into(), audio_label.into()]);
    }
    // Kaynakta ses yokken müzik görüntüden uzun olabilir: görüntü bitince durulur.
    if !audio && !music.is_empty() && video {
        args.push("-shortest".into());
    }

    let container = output
        .rsplit('.')
        .next()
        .unwrap_or("mp4")
        .to_ascii_lowercase();
    match audio_format {
        Some((format, kbps)) => args.extend(audio_codec_args(format, kbps)),
        None if video => args.extend(video_encode_args(&container, post)),
        // Görüntüsüz kaynak "video" olarak birleştirilirse AAC'ye kodlanır.
        None => args.extend(audio_codec_args("m4a", 192)),
    }
    args.extend(progress_args(output));
    args
}

/// Hareketli GIF ayarları. GIF'te ses olmaz.
#[derive(Debug, Clone, Copy, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GifOptions {
    pub fps: u32,
    /// En fazla bu genişlik; kaynak daha darsa büyütülmez.
    pub width: u32,
}

impl GifOptions {
    fn fps(&self) -> u32 {
        self.fps.clamp(5, 30)
    }

    fn width(&self) -> u32 {
        self.width.clamp(120, 1280)
    }
}

/// Parçaları hızlarıyla uç uca ekleyip GIF yapar. Renk paleti klibin kendisinden
/// çıkarılır (`palettegen`), yoksa GIF'in 256 rengi bantlı ve soluk görünür.
pub fn gif_args(
    inputs: &[MergeInput],
    output: &str,
    gif: GifOptions,
    post: &VideoPost,
) -> Vec<String> {
    let mut args: Vec<String> = vec!["-y".into()];
    for input in inputs {
        if let Some((start, duration)) = input.range {
            args.extend([
                "-ss".into(),
                seconds_arg(start),
                "-t".into(),
                seconds_arg(duration),
            ]);
        }
        args.extend(["-i".into(), input.path.into()]);
    }
    for image in &post.images {
        args.extend(image.input_args());
    }
    // Bindirilen klipler resimlerden sonra (GIF'te yalnız görüntüleri).
    let mut overlays: Vec<(usize, &ClipOverlay)> = Vec::new();
    if post.fx_size.is_some() {
        for overlay in post.overlays.iter().filter(|o| o.size.is_some()) {
            args.extend(overlay.input_args());
            overlays.push((inputs.len() + post.images.len() + overlays.len(), overlay));
        }
    }

    let mut filter = String::new();
    let mut labels = String::new();
    for (index, input) in inputs.iter().enumerate() {
        let label = chain(
            &mut filter,
            &format!("[{index}:v:0]"),
            &input.clip.video_steps(post.fx_size),
            &format!("[v{index}]"),
        );
        labels.push_str(&label);
    }
    let base = post
        .frame
        .as_ref()
        .map(|f| (f.width, f.height))
        .or(post.fx_size);
    let stages = post.stages(inputs.len(), base);
    filter.push_str(&format!("{labels}concat=n={}:v=1:a=0[gc]", inputs.len()));
    let mut joined = "[gc]";
    if let (false, Some(canvas)) = (overlays.is_empty(), post.fx_size) {
        composite_overlays(
            &mut filter,
            "[gc]",
            &overlays,
            canvas,
            post.fps.unwrap_or(30),
            "[gco]",
        );
        joined = "[gco]";
    }
    let from = link_stages(&mut filter, &stages, joined, "gs", "[gf]");
    filter.push_str(&format!(
        ";{from}fps={},scale=w='min({},iw)':h=-1:flags=lanczos,\
         split[s0][s1];[s0]palettegen=stats_mode=diff[p];\
         [s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle[v]",
        gif.fps(),
        gif.width()
    ));
    args.extend([
        "-filter_complex".into(),
        filter,
        "-map".into(),
        "[v]".into(),
        "-an".into(),
        "-loop".into(),
        "0".into(),
    ]);
    args.extend(progress_args(output));
    args
}

/// Tek klipten yalnızca sesi çıkarır.
pub fn extract_audio_args(
    input: &str,
    output: &str,
    clip: Clip,
    format: &str,
    bitrate_kbps: u32,
) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-y".into(),
        "-ss".into(),
        seconds_arg(clip.start),
        "-i".into(),
        input.into(),
        "-t".into(),
        seconds_arg(clip.duration()),
        "-map".into(),
        "0:a:0".into(),
        "-vn".into(),
    ];
    args.extend(audio_codec_args(format, bitrate_kbps));
    args.extend(progress_args(output));
    args
}

/// Kare şeridi için tek kare (JPEG, stdout'a). `headers` internetteki akış için
/// yt-dlp'nin verdiği istek başlıklarıdır.
pub fn thumbnail_args(
    input: &str,
    headers: &[(String, String)],
    seconds: f64,
    height: u32,
) -> Vec<String> {
    let mut args: Vec<String> = vec!["-v".into(), "error".into()];
    args.extend(http_input_args(input, headers));
    args.extend([
        "-ss".into(),
        seconds_arg(seconds),
        "-i".into(),
        input.into(),
        "-frames:v".into(),
        "1".into(),
        "-an".into(),
        "-vf".into(),
        format!("scale=-2:{}", height.clamp(32, 360)),
        "-f".into(),
        "image2pipe".into(),
        "-c:v".into(),
        "mjpeg".into(),
        "-q:v".into(),
        "6".into(),
        "pipe:1".into(),
    ]);
    args
}

/// Dalga formu için sesin tamamı düşük örnekleme hızında, tek kanal 16 bit ham
/// PCM olarak stdout'a akıtılır; tepe değerleri akarken hesaplanır.
pub const WAVEFORM_SAMPLE_RATE: u32 = 4000;

/// Oynatma imlecindeki kareyi tam çözünürlükte PNG dosyasına yazar.
/// `-ss` girişten önce: uzak akışta aralık isteğiyle hızlıca o ana iner.
pub fn frame_file_args(
    input: &str,
    headers: &[(String, String)],
    seconds: f64,
    output: &str,
) -> Vec<String> {
    let mut args: Vec<String> = vec!["-v".into(), "error".into(), "-y".into()];
    args.extend(http_input_args(input, headers));
    args.extend([
        "-ss".into(),
        seconds_arg(seconds),
        "-i".into(),
        input.into(),
        "-frames:v".into(),
        "1".into(),
        "-an".into(),
        output.into(),
    ]);
    args
}

/// Kapak görseli: `seconds` anındaki kare, dışa aktarmanın çerçevesi ve başlık
/// yazısıyla (ASS) tek JPEG olarak.
pub fn cover_args(input: &str, seconds: f64, filter: Option<&str>, output: &str) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-v".into(),
        "error".into(),
        "-y".into(),
        "-ss".into(),
        seconds_arg(seconds.max(0.0)),
        "-i".into(),
        input.into(),
    ];
    if let Some(filter) = filter.filter(|f| !f.is_empty()) {
        args.extend([
            "-filter_complex".into(),
            format!("[0:v]{filter}[v]"),
            "-map".into(),
            "[v]".into(),
        ]);
    }
    args.extend([
        "-frames:v".into(),
        "1".into(),
        "-an".into(),
        "-q:v".into(),
        "2".into(),
        output.into(),
    ]);
    args
}

pub fn waveform_args(input: &str, headers: &[(String, String)]) -> Vec<String> {
    let mut args: Vec<String> = vec!["-v".into(), "error".into()];
    args.extend(http_input_args(input, headers));
    args.extend([
        "-i".into(),
        input.into(),
        "-map".into(),
        "0:a:0".into(),
        "-vn".into(),
        "-ac".into(),
        "1".into(),
        "-ar".into(),
        WAVEFORM_SAMPLE_RATE.to_string(),
        "-f".into(),
        "s16le".into(),
        "-c:a".into(),
        "pcm_s16le".into(),
        "pipe:1".into(),
    ]);
    args
}

/// İnternetteki girişler için zaman aşımı ve yt-dlp'nin verdiği istek başlıkları.
/// Başlık değerindeki satır sonları atlanır (başlık enjeksiyonu olmasın).
fn http_input_args(input: &str, headers: &[(String, String)]) -> Vec<String> {
    let mut args = Vec::new();
    if input.starts_with("http://") || input.starts_with("https://") {
        // Yanıt vermeyen sunucuda sonsuza kadar beklemesin (mikrosaniye).
        args.extend(["-rw_timeout".into(), "15000000".into()]);
        if !headers.is_empty() {
            let joined: String = headers
                .iter()
                .filter(|(k, v)| !k.contains(['\r', '\n']) && !v.contains(['\r', '\n']))
                .map(|(k, v)| format!("{k}: {v}\r\n"))
                .collect();
            args.extend(["-headers".into(), joined]);
        }
    }
    args
}

/// Tepe değerlerini `buckets` kovaya toplar (0..1). Akış halinde beslenir.
pub struct PeakCollector {
    samples_per_bucket: f64,
    peaks: Vec<f32>,
    sample_index: u64,
    pending: Option<u8>,
}

impl PeakCollector {
    pub fn new(duration_seconds: f64, buckets: usize) -> Self {
        let total = (duration_seconds.max(0.1) * f64::from(WAVEFORM_SAMPLE_RATE)).max(1.0);
        let buckets = buckets.max(1);
        Self {
            samples_per_bucket: (total / buckets as f64).max(1.0),
            peaks: vec![0.0; buckets],
            sample_index: 0,
            pending: None,
        }
    }

    pub fn feed(&mut self, bytes: &[u8]) {
        let mut rest = bytes;
        if let Some(low) = self.pending.take() {
            if let Some((&high, tail)) = rest.split_first() {
                self.push(i16::from_le_bytes([low, high]));
                rest = tail;
            } else {
                self.pending = Some(low);
                return;
            }
        }
        let (pairs, remainder) = rest.as_chunks::<2>();
        for pair in pairs {
            self.push(i16::from_le_bytes(*pair));
        }
        if let [last] = remainder {
            self.pending = Some(*last);
        }
    }

    fn push(&mut self, sample: i16) {
        let bucket = ((self.sample_index as f64 / self.samples_per_bucket) as usize)
            .min(self.peaks.len() - 1);
        let value = f32::from(sample).abs() / 32768.0;
        if value > self.peaks[bucket] {
            self.peaks[bucket] = value;
        }
        self.sample_index += 1;
    }

    pub fn finish(self) -> Vec<f32> {
        self.peaks
    }
}

/// Tarayıcının oynatamadığı dosyalar (ör. AVI, HEVC) için hafif önizleme kopyası:
/// 480p H.264 / AAC. Yalnızca düzenleyicide izlemek içindir; dışa aktarım her
/// zaman özgün dosyadan yapılır.
pub fn preview_copy_args(input: &str, output: &str, has_video: bool) -> Vec<String> {
    let mut args: Vec<String> = vec!["-y".into(), "-i".into(), input.into()];
    if has_video {
        args.extend(
            [
                "-map",
                "0:v:0",
                "-map",
                "0:a:0?",
                "-vf",
                "scale=-2:'min(480,ih)'",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-crf",
                "28",
                "-pix_fmt",
                "yuv420p",
                "-g",
                "30",
            ]
            .map(String::from),
        );
    } else {
        args.extend(["-map".into(), "0:a:0".into(), "-vn".into()]);
    }
    args.extend(
        [
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-ac",
            "2",
            "-movflags",
            "+faststart",
        ]
        .map(String::from),
    );
    args.extend(progress_args(output));
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ass_altyazisi_turkce_ve_bosluklu_yolla_kurulur() {
        let filter = subtitles_filter(r"C:\Users\Ali\AppData\Local\klasör adı\alt yazı.ass");
        assert_eq!(
            filter,
            r"subtitles=filename='C\:/Users/Ali/AppData/Local/klasör adı/alt yazı.ass'"
        );
    }

    const AV: Streams = Streams {
        video: true,
        audio: true,
    };

    fn clips() -> Vec<Clip> {
        vec![Clip::new(600.0, 615.5), Clip::new(30.0, 40.0)]
    }

    #[test]
    fn gorunum_filtre_renk_ve_efektleri_ffmpeg_filtresine_doner() {
        let clip = Clip {
            look: Look {
                filter: FilterKind::Bw,
                brightness: 0.4,
                temperature: 1.0,
                blur: 0.5,
                mirror: true,
                vignette: true,
                ..Look::default()
            },
            fade_in: 1.0,
            fade_white: true,
            ..Clip::new(0.0, 10.0)
        };
        let steps = clip.video_steps(None).join(",");
        assert!(steps.starts_with("hue=s=0,eq=brightness=0.1:contrast=1:saturation=1"));
        assert!(steps.contains("colorbalance=rs=0.12:bs=-0.12"));
        assert!(steps.contains("boxblur=lr=11:lp=1,hflip,vignette=PI/5"));
        assert!(steps.ends_with("fade=t=in:st=0:d=1:c=white"));
        assert!(clip.has_effects());
        assert!(Look::default().is_default());
    }

    #[test]
    fn bosluk_siyah_goruntu_ve_sessizlik_olur() {
        let clips = [
            Clip::new(0.0, 5.0),
            Clip::black(90.0),
            Clip::new(20.0, 31.0),
        ];
        let args = merge_args(
            "a.mp4",
            "b.mp4",
            &clips,
            Streams {
                video: true,
                audio: true,
            },
            None,
            &VideoPost::default(),
        );
        let joined = args.join(" ");
        // Boşluk kaynağın başından yarım saniyelik dilimle açılır.
        assert!(joined.contains("-ss 0 -t 0.5 -i a.mp4"));
        assert!(joined.contains("tpad=stop_mode=clone:stop_duration=90,trim=duration=90"));
        assert!(joined.contains("drawbox=c=black:t=fill"));
        assert!(joined.contains("volume=0,apad=whole_dur=90,atrim=duration=90"));
        assert!(joined.contains("concat=n=3:v=1:a=1"));
        assert!(Clip::black(1.0).has_effects());
        assert!((Clip::black(90.0).output_duration() - 90.0).abs() < 1e-9);
    }

    #[test]
    fn birlestirmede_her_klip_kendi_girisiyle_aranir() {
        let args = merge_args(
            "in.mkv",
            "out.mp4",
            &clips(),
            AV,
            None,
            &VideoPost::default(),
        )
        .join(" ");
        assert!(args.contains("-ss 600 -t 15.5 -i in.mkv -ss 30 -t 10 -i in.mkv"));
        assert!(args.contains("[0:v:0][0:a:0][1:v:0][1:a:0]concat=n=2:v=1:a=1[v][a]"));
        assert!(args.contains("-map [v] -map [a]"));
        assert!(args.contains("libx264") && args.ends_with("out.mp4"));
    }

    #[test]
    fn sessiz_videoda_ses_akisi_baglanmaz() {
        let silent = Streams {
            video: true,
            audio: false,
        };
        let args = merge_args(
            "in.mp4",
            "out.mp4",
            &clips(),
            silent,
            None,
            &VideoPost::default(),
        )
        .join(" ");
        assert!(args.contains("[0:v:0][1:v:0]concat=n=2:v=1:a=0[v]"));
        assert!(!args.contains("[a]"));
    }

    #[test]
    fn yalniz_ses_birlestirme_goruntuyu_atlar() {
        let args = merge_args(
            "in.mp4",
            "out.mp3",
            &clips(),
            AV,
            Some(("mp3", 192)),
            &VideoPost::default(),
        )
        .join(" ");
        assert!(args.contains("[0:a:0][1:a:0]concat=n=2:v=0:a=1[a]"));
        assert!(args.contains("libmp3lame -b:a 192k"));
        assert!(!args.contains("libx264") && !args.contains("[v]"));
    }

    #[test]
    fn ses_kodlayicisi_bicime_gore_secilir() {
        assert_eq!(audio_codec_args("wav", 192), ["-c:a", "pcm_s16le"]);
        assert_eq!(audio_codec_args("flac", 192), ["-c:a", "flac"]);
        assert_eq!(audio_codec_args("m4a", 999)[3], "320k", "üst sınır");
        assert_eq!(audio_codec_args("bilinmeyen", 128)[1], "aac");
    }

    #[test]
    fn tek_kliptan_ses_cikarilir() {
        let clip = Clip::new(5.0, 7.25);
        let args = extract_audio_args("a.mp4", "a.m4a", clip, "m4a", 160).join(" ");
        assert!(args.contains("-ss 5 -i a.mp4 -t 2.25 -map 0:a:0 -vn -c:a aac -b:a 160k"));
    }

    #[test]
    fn uzak_kare_istegi_basliklarla_yapilir() {
        let headers = vec![("User-Agent".to_string(), "Mozilla".to_string())];
        let args = thumbnail_args("https://x.com/v.m3u8", &headers, 61.5, 90);
        let joined = args.join(" ");
        assert!(joined.contains("-rw_timeout"));
        assert!(args.contains(&"User-Agent: Mozilla\r\n".to_string()));
        assert!(joined.contains("-ss 61.5 -i https://x.com/v.m3u8 -frames:v 1"));
        let local = thumbnail_args("C:\\v.mp4", &headers, 1.0, 90).join(" ");
        assert!(!local.contains("-headers") && !local.contains("-rw_timeout"));
    }

    #[test]
    fn baslik_satiri_enjeksiyonu_engellenir() {
        let headers = vec![("X".to_string(), "a\r\nEvil: 1".to_string())];
        let args = thumbnail_args("https://x.com/v.mp4", &headers, 0.0, 90);
        assert!(!args.iter().any(|a| a.contains("Evil")));
    }

    #[test]
    fn kare_tam_cozunurlukte_dosyaya_yazilir() {
        let args = frame_file_args("C:\\v.mp4", &[], 12.5, "C:\\out\\kare.png");
        let joined = args.join(" ");
        assert!(joined.contains("-ss 12.5 -i C:\\v.mp4 -frames:v 1 -an C:\\out\\kare.png"));
        // Ölçekleme yok: kaynak çözünürlüğü korunur; PNG uzantıdan anlaşılır.
        assert!(!joined.contains("scale") && !joined.contains("image2pipe"));
        // Uzak aktarıcı adresinde zaman aşımı eklenir.
        let remote = frame_file_args("http://127.0.0.1:9/p/t?u=x", &[], 0.0, "o.png").join(" ");
        assert!(remote.contains("-rw_timeout"));
    }

    #[test]
    fn tepe_degerleri_kovalara_toplanir() {
        // 1 sn = 4000 örnek; 4 kova → her kova 1000 örnek.
        let mut collector = PeakCollector::new(1.0, 4);
        let mut bytes = Vec::new();
        for i in 0..4000 {
            let value: i16 = if i == 2500 { -16384 } else { 100 };
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        // Parçalar tek bayt sınırında bölünse de örnekler kaymamalı.
        let (a, b) = bytes.split_at(3001);
        collector.feed(a);
        collector.feed(b);
        let peaks = collector.finish();
        assert_eq!(peaks.len(), 4);
        assert!((peaks[2] - 0.5).abs() < 0.001);
        assert!(peaks[0] < 0.01 && peaks[3] < 0.01);
    }

    #[test]
    fn hizli_kliplerde_goruntu_ve_ses_birlikte_hizlanir() {
        let clips = [
            Clip {
                speed: 2.0,
                ..Clip::new(10.0, 20.0)
            },
            Clip::new(30.0, 32.0),
        ];
        let args =
            merge_args("in.mp4", "out.mp4", &clips, AV, None, &VideoPost::default()).join(" ");
        assert!(args.contains("[0:v:0]setpts=PTS/2[v0];[0:a:0]atempo=2[a0];"));
        assert!(args.contains("[v0][a0][1:v:0][1:a:0]concat=n=2:v=1:a=1[v][a]"));
    }

    #[test]
    fn atempo_sinir_disinda_zincirlenir() {
        assert_eq!(atempo_chain(4.0), "atempo=2,atempo=2");
        assert_eq!(atempo_chain(0.25), "atempo=0.5,atempo=0.5");
        assert_eq!(atempo_chain(1.5), "atempo=1.5");
        assert_eq!(atempo_chain(9.0), "atempo=2,atempo=2");
    }

    #[test]
    fn indirilmis_bolumler_hizlandirilarak_birlestirilir() {
        let inputs = [
            MergeInput {
                path: "a.webm",
                range: None,
                clip: Clip {
                    speed: 0.5,
                    ..Clip::new(0.0, 1.0)
                },
            },
            MergeInput {
                path: "b.webm",
                range: None,
                clip: Clip::new(0.0, 1.0),
            },
        ];
        let args = merge_inputs_args(
            &inputs,
            "out.webm",
            AV,
            None,
            false,
            None,
            &VideoPost::default(),
        )
        .join(" ");
        assert!(args.starts_with("-y -i a.webm -i b.webm"));
        assert!(args.contains("setpts=PTS/0.5") && args.contains("libvpx-vp9"));
        assert!(!args.contains("+faststart"));
    }

    #[test]
    fn farkli_kaynaklar_ortak_boyut_ve_sese_cekilir() {
        let inputs = [
            MergeInput {
                path: "a.mp4",
                range: Some((5.0, 10.0)),
                clip: Clip::new(5.0, 15.0),
            },
            MergeInput {
                path: "b.mkv",
                range: None,
                clip: Clip::new(0.0, 8.0),
            },
        ];
        let args = merge_inputs_args(
            &inputs,
            "out.mp4",
            AV,
            Some((1920, 1080)),
            true,
            None,
            &VideoPost::default(),
        )
        .join(" ");
        // Her girişin zinciri ortak boyut + kare hızıyla başlar.
        let normalize = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30,format=yuv420p";
        assert!(args.contains(&format!("[0:v:0]{normalize}[v0];")));
        assert!(args.contains(&format!("[1:v:0]{normalize}[v1];")));
        // Ses girişleri 48 kHz stereoya çekilir.
        assert!(args.contains("[0:a:0]aresample=48000,aformat=channel_layouts=stereo[a0];"));
        // Boyut istenmezse zincirler eskisi gibi kalır.
        let plain = merge_inputs_args(
            &inputs,
            "out.mp4",
            AV,
            None,
            false,
            None,
            &VideoPost::default(),
        )
        .join(" ");
        assert!(!plain.contains("force_original_aspect_ratio"));
        assert!(!plain.contains("aresample"));
    }

    #[test]
    fn ses_zarfi_dogrusal_ifade() {
        assert_eq!(envelope_expr(&[]), None);
        assert_eq!(envelope_expr(&[[0.0, 1.0], [3.0, 1.0]]), None);
        assert_eq!(
            envelope_expr(&[[1.0, 1.0], [2.0, 0.2], [4.0, 1.0]]).unwrap(),
            "if(lt(t,1),1,if(lt(t,2),1+(-0.8)*(t-1)/1,if(lt(t,4),0.2+(0.8)*(t-2)/2,1)))"
        );
    }

    #[test]
    fn ses_onarimi_konusma_ve_muzik() {
        assert!(AudioFx::default().steps().is_empty());
        let speech = AudioFx {
            noise: 0.5,
            wind: true,
            echo: 0.5,
            enhance: true,
            ..AudioFx::default()
        };
        assert_eq!(
            speech.steps(),
            vec![
                "highpass=f=120",
                "afftdn=nr=18:nf=-25",
                "agate=threshold=0.02:ratio=3:attack=5:release=175",
                "equalizer=f=200:t=q:w=1:g=-2",
                "equalizer=f=3500:t=q:w=1.2:g=3",
                "acompressor=threshold=0.1:ratio=3:attack=5:release=120:makeup=1.5",
            ]
        );
        let music = AudioFx {
            music: true,
            wind: true,
            enhance: true,
            ..AudioFx::default()
        };
        assert_eq!(
            music.steps(),
            vec![
                "highpass=f=40",
                "acompressor=threshold=0.2:ratio=2:attack=20:release=250"
            ]
        );
        // Ses onarımı varsa eski gürültü azaltma yerine o uygulanır.
        let clip = Clip {
            denoise: true,
            audio_fx: Some(AudioFx {
                wind: true,
                ..AudioFx::default()
            }),
            ..Clip::new(0.0, 2.0)
        };
        assert_eq!(clip.audio_steps(), vec!["highpass=f=120"]);
    }

    #[test]
    fn esitleyici_sikistirici_ve_sinirlayici() {
        let fx = AudioFx {
            low: 4.0,
            mid: -2.26,
            high: 30.0,
            compress: 0.5,
            limit: true,
            ..AudioFx::default()
        };
        assert_eq!(
            fx.steps(),
            vec![
                "bass=g=4:f=120:t=q:w=0.7",
                "equalizer=f=1000:t=q:w=1:g=-2.5",
                "treble=g=12:f=8000:t=q:w=0.7",
                "acompressor=threshold=0.141:ratio=3.8:attack=10:release=150:makeup=1.5",
                "alimiter=limit=0.891:attack=5:release=50:level=false",
            ]
        );
        // Sıfır kazanç ve bozuk değerler adım üretmez.
        let none = AudioFx {
            low: 0.0,
            mid: f64::NAN,
            compress: -1.0,
            ..AudioFx::default()
        };
        assert!(none.steps().is_empty());
    }

    #[test]
    fn hedef_ses_seviyesi_karisimin_sonunda() {
        let post = VideoPost {
            loudness: Some(-14.0),
            ..VideoPost::default()
        };
        let args = merge_args(
            "in.mp4",
            "out.mp4",
            &[Clip::new(0.0, 5.0), Clip::new(10.0, 12.0)],
            AV,
            None,
            &post,
        );
        let joined = args.join(" ");
        assert!(
            joined.contains(";[a]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aln]"),
            "{joined}"
        );
        let map = args
            .iter()
            .position(|a| a == "[aln]")
            .expect("ses [aln] ile eşlenir");
        assert_eq!(args[map - 1], "-map");
    }

    #[test]
    fn renk_duzeltme_zinciri() {
        let grade = Grade {
            exposure: 0.25,
            tint: 0.5,
            midtones: Wheel { x: 1.0, y: 0.0 },
            lift: -1.0,
            gain: 1.0,
            curve: Some(vec![[0.0, 0.0], [0.5, 0.6], [1.0, 1.0]]),
            lut: Some(LutFile {
                path: "C:\\Renk\\film.cube".into(),
            }),
            ..Grade::default()
        };
        assert_eq!(
            grade.steps(),
            vec![
                "exposure=exposure=0.5",
                "curves=all='0/0 0.5/0.6 1/1'",
                "curves=all='0.15/0 0.5/0.5 0.85/1'",
                "colorbalance=rs=0:gs=-0.075:bs=0:rm=0.3:gm=-0.225:bm=-0.15:rh=0:gh=-0.075:bh=0",
                "lut3d=file='C\\:/Renk/film.cube'",
            ]
        );
        assert!(Grade::default().steps().is_empty());
        let look: Look = serde_json::from_str(r#"{"grade":{"exposure":0.5}}"#).unwrap();
        assert_eq!(look.steps(), vec!["exposure=exposure=1"]);
    }

    #[test]
    fn gorunum_efektleri_filtreye_cevrilir() {
        assert!(LookFx::default().steps().is_empty());
        let look = Look {
            fx: LookFx {
                glitch: 1.0,
                rgb_split: 0.5,
                strobe: 0.4,
                grain: 0.5,
                light_leak: 0.5,
                vhs: 0.0,
                sharpen: 1.0,
            },
            ..Look::default()
        };
        assert!(!look.is_default());
        let steps = look.steps();
        assert_eq!(steps[0], "unsharp=5:5:2");
        assert_eq!(steps[1], "hue=h='if(lt(mod(t*7,1),0.15),90,0)'");
        assert!(
            steps[2].starts_with("crop=iw-16:ih:x='8-if(") && steps[2].ends_with("scale=iw+16:ih")
        );
        assert_eq!(steps[3], "rgbashift=rh=-7:bh=7");
        assert_eq!(
            steps[4],
            "eq=brightness='if(lt(mod(t*6,1),0.2),0.2,0)':eval=frame"
        );
        assert_eq!(steps.last().unwrap(), "noise=alls=24:allf=t+u");
        // VHS: ayrışma, renk, yumuşaklık, tarama çizgileri ve gren birlikte.
        let vhs = LookFx {
            vhs: 1.0,
            ..LookFx::default()
        }
        .steps();
        assert_eq!(
            vhs,
            vec![
                "rgbashift=rh=-7:bh=7",
                "eq=saturation=1.3:contrast=1.1",
                "gblur=sigma=0.6",
                "drawgrid=w=iw:h=4:t=1:c=black@0.3",
                "noise=alls=21:allf=t+u",
            ]
        );
    }

    #[test]
    fn dondurulmus_kare_kucuk_dilimden_uzatilir_sessizdir() {
        let freeze = Clip {
            freeze_at: Some(12.5),
            look: Look::default(),
            ..Clip::new(12.5, 15.5)
        };
        assert!(freeze.has_effects());
        assert_eq!(freeze.input_range(), (12.5, BLACK_SOURCE_SECONDS));
        assert_eq!(
            freeze.speed_steps(),
            vec![
                "trim=end_frame=1",
                "tpad=stop_mode=clone:stop_duration=3",
                "trim=duration=3",
                "setpts=PTS-STARTPTS"
            ]
        );
        assert_eq!(freeze.audio_steps()[0], "volume=0");
        let args = merge_args(
            "in.mp4",
            "out.mp4",
            std::slice::from_ref(&freeze),
            AV,
            None,
            &VideoPost::default(),
        )
        .join(" ");
        assert!(args.contains("-ss 12.5 -t 0.5 -i in.mp4"), "{args}");
    }

    #[test]
    fn ters_oynatma_goruntu_ve_sesi_hizdan_once_cevirir() {
        let clip = Clip {
            reverse: true,
            speed: 2.0,
            ..Clip::new(0.0, 6.0)
        };
        assert!(clip.has_effects());
        assert_eq!(clip.speed_steps(), vec!["reverse", "setpts=PTS/2"]);
        assert_eq!(
            clip.audio_steps()[..2],
            ["areverse".to_string(), "atempo=2".to_string()]
        );
        assert_eq!(clip.input_range(), (0.0, 6.0));
    }

    #[test]
    fn hareket_bulanikligi_hizdan_sonra_kareleri_karistirir() {
        let fast = Clip {
            speed: 3.0,
            motion_blur: true,
            ..Clip::new(0.0, 9.0)
        };
        assert_eq!(
            fast.speed_steps(),
            vec!["setpts=PTS/3", "tmix=frames=4:weights='1 1 1 1'"]
        );
        let normal = Clip {
            motion_blur: true,
            ..Clip::new(0.0, 4.0)
        };
        assert!(normal.has_effects());
        assert_eq!(normal.speed_steps(), vec!["tmix=frames=2:weights='1 1'"]);
        assert!(Clip::new(0.0, 4.0).speed_steps().is_empty());
    }

    #[test]
    fn ses_duzeyi_ve_gecisler_filtreye_eklenir() {
        let clip = Clip {
            volume: 0.5,
            fade_in: 1.0,
            fade_out: 2.0,
            speed: 2.0,
            ..Clip::new(10.0, 30.0)
        };
        // Çıktı 10 sn: kararma 8. saniyede başlar.
        let args = merge_args(
            "in.mp4",
            "out.mp4",
            std::slice::from_ref(&clip),
            AV,
            None,
            &VideoPost::default(),
        )
        .join(" ");
        assert!(args.contains("[0:v:0]setpts=PTS/2,fade=t=in:st=0:d=1,fade=t=out:st=8:d=2[v0];"));
        assert!(args
            .contains("[0:a:0]atempo=2,volume=0.5,afade=t=in:st=0:d=1,afade=t=out:st=8:d=2[a0];"));
        assert!(clip.has_effects());
        assert!(!Clip::new(0.0, 5.0).has_effects());
        // Gürültü azaltma ses düzeyinden önce uygulanır.
        let clean = Clip {
            denoise: true,
            volume: 0.5,
            ..Clip::new(0.0, 4.0)
        };
        assert!(clean.has_effects());
        assert_eq!(clean.audio_steps(), vec!["afftdn=nf=-25", "volume=0.5"]);
        // Sessize alınmış klip de efekt sayılır; geçişler süreyi aşamaz.
        let muted = Clip {
            volume: 0.0,
            fade_in: 9.0,
            ..Clip::new(0.0, 4.0)
        };
        assert!(muted.has_effects());
        assert_eq!(muted.fades(), (2.0, 0.0));
    }

    #[test]
    fn klipler_arasi_gecis_kaynaktan_pay_alir_ve_xfade_ile_baglanir() {
        use super::super::xfade::XfadeKind;
        let slide = Some(Xfade {
            kind: XfadeKind::SlideLeft,
            duration: 1.0,
        });
        // 10–20 ve 40–45: kesimin iki yanından 0,5 sn kaynak payı alınır.
        let mut clips = vec![
            Clip {
                xfade: slide,
                fade_out: 2.0,
                ..Clip::new(10.0, 20.0)
            },
            Clip {
                fade_in: 1.0,
                xfade: slide,
                ..Clip::new(40.0, 45.0)
            },
        ];
        apply_xfade_handles(&mut clips, |_| 100.0);
        assert_eq!((clips[0].start, clips[0].end), (10.0, 20.5));
        assert_eq!((clips[1].start, clips[1].end), (39.5, 45.0));
        // Kesimdeki kararma/açılma geçişe bırakılır; son parçanın geçişi düşer.
        assert_eq!((clips[0].fade_out, clips[1].fade_in), (0.0, 0.0));
        assert!(clips[1].xfade.is_none());
        // Toplam süre değişmez: 10 + 5.
        assert!((joined_seconds(&clips) - 15.0).abs() < 1e-9);

        let post = VideoPost {
            fps: Some(60),
            ..VideoPost::default()
        };
        let args = merge_args("in.mp4", "out.mp4", &clips, AV, None, &post).join(" ");
        assert!(
            args.contains("-ss 10 -t 10.5 -i in.mp4 -ss 39.5 -t 5.5 -i in.mp4"),
            "{args}"
        );
        assert!(
            args.contains("[0:v:0]fps=60,format=yuv420p,settb=AVTB[v0];"),
            "{args}"
        );
        assert!(
            args.contains("[v0][v1]xfade=transition=slideleft:duration=1:offset=9.5[v]"),
            "{args}"
        );
        assert!(
            args.contains("[0:a:0][1:a:0]acrossfade=d=1:c1=tri:c2=tri[a]"),
            "{args}"
        );
        assert!(!args.contains("concat="));
    }

    #[test]
    fn gecis_payi_kaynakta_yoksa_kare_dondurulur() {
        use super::super::xfade::XfadeKind;
        let fade = Some(Xfade {
            kind: XfadeKind::Fade,
            duration: 2.0,
        });
        // İlk klip kaynağın sonunda biter, ikincisi kaynağın başından başlar.
        let mut clips = vec![
            Clip {
                xfade: fade,
                ..Clip::new(5.0, 10.0)
            },
            Clip::new(0.0, 4.0),
            Clip::new(6.0, 8.0),
        ];
        apply_xfade_handles(&mut clips, |_| 10.0);
        assert_eq!((clips[0].end, clips[0].pad_tail), (10.0, 1.0));
        assert_eq!((clips[1].start, clips[1].pad_head), (0.0, 1.0));
        let args =
            merge_args("in.mp4", "out.mp4", &clips, AV, None, &VideoPost::default()).join(" ");
        assert!(
            args.contains("tpad=stop_mode=clone:stop_duration=1,fps=30"),
            "{args}"
        );
        assert!(
            args.contains("tpad=start_mode=clone:start_duration=1,fps=30"),
            "{args}"
        );
        assert!(args.contains("apad=pad_dur=1"), "{args}");
        assert!(args.contains("adelay=delays=1000:all=1"), "{args}");
        // İkinci kesimde geçiş yok: düz eklenir.
        assert!(args.contains("[xv1][v2]concat=n=2:v=1:a=0[v]"), "{args}");
        assert!(args.contains("[xa1][2:a:0]concat=n=2:v=0:a=1[a]"), "{args}");
        // Siyah boşluğa geçiş uygulanmaz.
        let mut gap = vec![
            Clip {
                xfade: fade,
                ..Clip::new(0.0, 5.0)
            },
            Clip::black(2.0),
        ];
        apply_xfade_handles(&mut gap, |_| 10.0);
        assert!(gap[0].xfade.is_none());
        assert_eq!(gap[0].end, 5.0);
    }

    #[test]
    fn dikey_cerceve_birlesimden_sonra_kirpar_ya_da_sigdirir() {
        let frame = Frame {
            width: 1080,
            height: 1920,
            fit: false,
            blur: false,
            position: 0.25,
            split: None,
            gradient: None,
            track: None,
        };
        let args = merge_args(
            "in.mp4",
            "out.mp4",
            &clips(),
            AV,
            None,
            &VideoPost::framed(frame.clone()),
        )
        .join(" ");
        assert!(args.contains("concat=n=2:v=1:a=1[vc][a];[vc]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:x='(iw-ow)*0.25':y='(ih-oh)*0.25',setsar=1[v]"));
        let fit = Frame {
            fit: true,
            ..frame.clone()
        }
        .filter();
        assert!(fit.contains("force_original_aspect_ratio=decrease,pad=1080:1920"));
        let blur = Frame {
            fit: true,
            blur: true,
            ..frame.clone()
        }
        .filter();
        assert!(blur
            .starts_with("split[fa][fb];[fa]scale=1080:1920:force_original_aspect_ratio=increase"));
        assert!(blur.ends_with("[fbg][ffg]overlay=(W-w)/2:(H-h)/2,setsar=1"));
        assert!(!blur.contains(char::is_whitespace));
        // Yalnızca ses çıkışında çerçeve yok sayılır.
        let audio = merge_args(
            "in.mp4",
            "out.m4a",
            &clips(),
            AV,
            Some(("m4a", 192)),
            &VideoPost::framed(frame),
        )
        .join(" ");
        assert!(!audio.contains("crop="));
    }

    #[test]
    fn gizleme_bolgesi_cerceveden_once_uygulanir() {
        let region = BlurRegion {
            ranges: vec![(1.0, 3.0), (5.0, 6.0)],
            x: 0.1,
            y: 0.8,
            w: 0.3,
            h: 0.5,
            strength: 1.0,
            pixel: false,
            keys: vec![],
        };
        let post = VideoPost {
            blurs: vec![region.clone()],
            frame: Some(Frame {
                width: 1080,
                height: 1920,
                fit: false,
                blur: false,
                position: 0.5,
                split: None,
                gradient: None,
                track: None,
            }),
            ..VideoPost::default()
        };
        let args = merge_args("in.mp4", "out.mp4", &clips(), AV, None, &post).join(" ");
        // Bölge kaynağın içine çekilir (y 0.5'e iner) ve iki süre aralığında açıktır.
        assert!(args.contains(";[vc]split[bz0a][bz0b];[bz0b]crop=w=iw*0.3:h=ih*0.5:x='iw*0.1':y='ih*0.5',boxblur="), "{args}");
        assert!(
            args.contains("enable='between(t,1,3)+between(t,5,6)'[vo0];[vo0]scale=1080:1920"),
            "{args}"
        );
        let pixel = BlurRegion {
            pixel: true,
            ..region
        }
        .filter(0)
        .unwrap();
        assert!(
            pixel.contains(
                "scale='max(1,ceil(iw/32))':'max(1,ceil(ih/32))':flags=neighbor,scale=iw*32:ih*32"
            ),
            "{pixel}"
        );
        // Hareketli kutu: konum anahtarlar arasında doğrusal ilerler, kırpma ve bindirme aynı yerde.
        let moving = BlurRegion {
            keys: vec![(1.0, 0.0, 0.5), (3.0, 0.6, 0.5)],
            ..pixel_region()
        }
        .filter(0)
        .unwrap();
        let x = "if(lt(t,1),0,if(lt(t,3),0+(0.5)*(t-1)/2,0.5))";
        assert!(moving.contains(&format!("x='iw*({x})'")), "{moving}");
        assert!(
            moving.contains(&format!("overlay=x='main_w*({x})'")),
            "{moving}"
        );
        assert!(BlurRegion {
            ranges: vec![],
            ..BlurRegion {
                pixel: false,
                ..pixel_region()
            }
        }
        .filter(0)
        .is_none());
    }

    fn pixel_region() -> BlurRegion {
        BlurRegion {
            ranges: vec![(0.0, 1.0)],
            x: 0.0,
            y: 0.0,
            w: 0.5,
            h: 0.5,
            strength: 0.5,
            pixel: true,
            keys: vec![],
        }
    }

    fn layout_frame(style: SplitStyle, ring: Option<&str>) -> Frame {
        Frame {
            width: 1080,
            height: 1920,
            fit: false,
            blur: false,
            position: 0.5,
            split: Some(Split {
                cam: Rect {
                    x: 0.75,
                    y: 0.05,
                    w: 0.2,
                    h: 0.3,
                },
                game: Rect {
                    x: 0.2,
                    y: 0.0,
                    w: 0.6,
                    h: 1.0,
                },
                cam_share: 0.35,
                cam_top: true,
                style,
                cam2: Some(Rect {
                    x: 0.05,
                    y: 0.05,
                    w: 0.2,
                    h: 0.3,
                }),
                spot: Some(Spot {
                    x: 0.5,
                    y: 0.8,
                    size: 0.4,
                }),
                ring: ring.and_then(Color::parse),
                band: None,
            }),
            gradient: None,
            track: None,
        }
    }

    #[test]
    fn orta_serit_kamera_ile_oyun_arasinda() {
        let mut frame = layout_frame(SplitStyle::Stack, None);
        if let Some(split) = frame.split.as_mut() {
            split.band = Some(Band {
                share: 0.1,
                color: Color([0x11, 0x22, 0x33]),
            });
        }
        let f = frame.filter();
        // 1920 × 0.35 = 672 kamera, 192 şerit, 1056 oyun.
        assert!(f.starts_with("split=3[sa][sb][sx];"), "{f}");
        assert!(f.contains("scale=1080:672:"), "{f}");
        assert!(f.contains("scale=1080:1056:"), "{f}");
        assert!(
            f.contains("[sx]scale=1080:192,drawbox=c=0x112233:t=fill,setsar=1[sband];[scam][sband][sgame]vstack=inputs=3"),
            "{f}"
        );
        if let Some(split) = frame.split.as_mut() {
            split.cam_top = false;
            split.style = SplitStyle::Duo;
        }
        let f = frame.filter();
        assert!(f.starts_with("split=4[sa][sb][sc][sx];"), "{f}");
        assert!(f.contains("[sgame][sband][scam]vstack=inputs=3"), "{f}");
        // Daire kamerada şerit yok sayılır.
        if let Some(split) = frame.split.as_mut() {
            split.style = SplitStyle::Circle;
        }
        assert!(!frame.filter().contains("sband"));
    }

    #[test]
    fn daire_kamera_oyunun_ustunde_halkayla() {
        let f = layout_frame(SplitStyle::Circle, Some("#ffd43b")).filter();
        // Oyun bütün kareyi kaplar; kamera 1080*0.4 = 432 px kare, daire maskeli.
        assert!(
            f.contains("[sb]crop=iw*0.6:ih*1:iw*0.2:ih*0,scale=1080:1920:"),
            "{f}"
        );
        assert!(
            f.contains(
                "scale=432:432:force_original_aspect_ratio=increase,crop=432:432,format=gbrap,geq="
            ),
            "{f}"
        );
        // Halka rengi (255, 212, 59) ve yumuşak kenar.
        assert!(
            f.contains("+255*ld(3)") && f.contains("+212*ld(3)") && f.contains("+59*ld(3)"),
            "{f}"
        );
        assert!(f.contains("a='st(0,abs(X-216+0.5)-(0))"), "{f}");
        assert!(
            f.ends_with(
                "overlay=x='min(max(W*0.5-w/2,0),W-w)':y='min(max(H*0.8-h/2,0),H-h)',setsar=1"
            ),
            "{f}"
        );
        // Çerçevesiz: renk kanalları olduğu gibi.
        let plain = layout_frame(SplitStyle::Circle, None).filter();
        assert!(
            plain.contains("geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)'"),
            "{plain}"
        );
    }

    #[test]
    fn kosede_kamera_yuvarlak_koseli_kutu() {
        let f = layout_frame(SplitStyle::Pip, None).filter();
        // 432 × 324 (4:3), köşe yarıçapı 324*0.12.
        assert!(
            f.contains("scale=432:324:force_original_aspect_ratio=increase,crop=432:324,"),
            "{f}"
        );
        assert!(f.contains("-38.88)"), "{f}");
    }

    #[test]
    fn podcast_iki_kisi_alt_alta_ve_json_okunur() {
        let f = layout_frame(SplitStyle::Podcast, None).filter();
        assert!(
            f.starts_with("split[sa][sb];[sa]crop=iw*0.2:ih*0.3:iw*0.75:ih*0.05,scale=1080:672:"),
            "{f}"
        );
        assert!(f.ends_with("[scam][sgame]vstack=inputs=2,setsar=1"), "{f}");
        let split: Split = serde_json::from_str(
            r##"{"cam":{"x":0,"y":0,"w":0.4,"h":0.8},"game":{"x":0.5,"y":0,"w":0.4,"h":0.8},"camShare":0.5,"camTop":true,"style":"podcast","ring":null}"##,
        )
        .unwrap();
        assert_eq!(split.style, SplitStyle::Podcast);
        assert_eq!(split.ring, None);
        let circle: Split = serde_json::from_str(
            r##"{"cam":{"x":0,"y":0,"w":0.4,"h":0.8},"game":{"x":0.5,"y":0,"w":0.4,"h":0.8},"camShare":0.35,"style":"circle","spot":{"x":0.5,"y":0.8,"size":0.4},"ring":"#ffd43b"}"##,
        )
        .unwrap();
        assert_eq!(circle.ring, Color::parse("#ffd43b"));
        assert!(serde_json::from_str::<Split>(r##"{"cam":{"x":0,"y":0,"w":1,"h":1},"game":{"x":0,"y":0,"w":1,"h":1},"camShare":0.3,"ring":"kırmızı"}"##).is_err());
    }

    #[test]
    fn iki_kamera_yan_yana_oyun_altta() {
        let f = layout_frame(SplitStyle::Duo, None).filter();
        assert!(
            f.starts_with(
                "split=3[sa][sb][sc];[sa]crop=iw*0.2:ih*0.3:iw*0.75:ih*0.05,scale=540:672:"
            ),
            "{f}"
        );
        assert!(
            f.contains("[sb]crop=iw*0.2:ih*0.3:iw*0.05:ih*0.05,scale=540:672:"),
            "{f}"
        );
        assert!(
            f.contains(
                "[sc1][sc2]hstack=inputs=2[scam];[sc]crop=iw*0.6:ih*1:iw*0.2:ih*0,scale=1080:1248:"
            ),
            "{f}"
        );
        assert!(f.ends_with("[scam][sgame]vstack=inputs=2,setsar=1"), "{f}");
    }

    #[test]
    fn gradyan_arka_plan_videonun_kendisinden() {
        let frame = Frame {
            width: 1080,
            height: 1920,
            fit: true,
            blur: false,
            position: 0.5,
            split: None,
            gradient: Some([
                Color::parse("#1e3a8a").unwrap(),
                Color::parse("#9333ea").unwrap(),
            ]),
            track: None,
        };
        let f = frame.filter();
        assert!(f.starts_with("split[fa][fb];[fa]scale=8:64,format=gbrp,geq=r='30+(147-30)*Y/63':g='58+(51-58)*Y/63':b='138+(234-138)*Y/63',"), "{f}");
        assert!(
            f.ends_with("[fbg][ffg]overlay=(W-w)/2:(H-h)/2,setsar=1"),
            "{f}"
        );
        // Bulanık seçiliyse gradyan yok sayılır.
        assert!(Frame {
            blur: true,
            ..frame.clone()
        }
        .filter()
        .contains("boxblur"));
        assert_eq!(Color::parse("#12345"), None);
        assert_eq!(Color::parse("123456"), None);
    }

    #[test]
    fn yuz_takibinde_kirpma_konumu_zamanla_degisir() {
        let frame = Frame {
            width: 1080,
            height: 1920,
            fit: false,
            blur: false,
            position: 0.5,
            split: None,
            gradient: None,
            track: Some(vec![
                (0.0, 0.2),
                (2.0, 0.2),
                (3.0, 0.8),
                (3.0, 0.3),
                (10.0, 0.3),
            ]),
        };
        let f = frame.filter();
        let expr = "(lt(t,0)*0.2+gte(t,0)*lt(t,2)*(0.2+(0)*(t-0)/2)+gte(t,2)*lt(t,3)*(0.2+(0.6)*(t-2)/1)+gte(t,3)*lt(t,10)*(0.3+(0)*(t-3)/7)+gte(t,10)*0.3)";
        assert!(
            f.contains(&format!(
                "crop=1080:1920:x='(iw-ow)*{expr}':y='(ih-oh)*{expr}'"
            )),
            "{f}"
        );
        // İz yoksa sabit konum.
        let still = Frame {
            track: None,
            ..frame.clone()
        }
        .filter();
        assert!(
            still.contains("crop=1080:1920:x='(iw-ow)*0.5':y='(ih-oh)*0.5'"),
            "{still}"
        );
        assert_eq!(track_expr(&[]), None);
        assert_eq!(track_expr(&[(1.0, 2.0)]).as_deref(), Some("1"));
    }

    #[test]
    fn ilerleme_cubugu_video_boyunca_dolar() {
        let bar = ProgressBar {
            color: Color::parse("#ffd43b").unwrap(),
            height: 0.01,
            top: false,
        };
        let f = bar.filter((1080, 1920), 30.0).unwrap();
        assert_eq!(
            f,
            "color=c=0xffd43b:s=1080x18:r=30[pbar];{FROM}[pbar]overlay=x='-W+W*min(t/30,1)':y=main_h-overlay_h:shortest=1{TO}"
        );
        let top = ProgressBar { top: true, ..bar }
            .filter((1080, 1920), 30.0)
            .unwrap();
        assert!(top.contains(":y=0:"));
        assert!(bar.filter((1080, 1920), 0.0).is_none());
        let post = VideoPost {
            progress: Some((bar, 12.5)),
            ..VideoPost::default()
        };
        assert!(!post.is_empty());
        let stages = post.stages(1, Some((1080, 1920)));
        assert_eq!(stages.len(), 1);
        assert!(stages[0].contains("min(t/12.5,1)"));
        let parsed: ProgressBar =
            serde_json::from_str(r##"{"color":"#ff0000","top":true}"##).unwrap();
        assert_eq!(parsed.height, 0.012);
    }

    #[test]
    fn kapak_kareyi_cerceve_ve_yaziyla_cikarir() {
        let a = cover_args(
            "C:/v.mp4",
            12.5,
            Some("scale=1080:1920,subtitles=filename='x.ass'"),
            "kapak.jpg",
        )
        .join(" ");
        assert_eq!(
            a,
            "-v error -y -ss 12.5 -i C:/v.mp4 -filter_complex [0:v]scale=1080:1920,subtitles=filename='x.ass'[v] -map [v] -frames:v 1 -an -q:v 2 kapak.jpg"
        );
        let plain = cover_args("C:/v.mp4", -1.0, None, "k.jpg").join(" ");
        assert_eq!(
            plain,
            "-v error -y -ss 0 -i C:/v.mp4 -frames:v 1 -an -q:v 2 k.jpg"
        );
    }

    /// Elle çalıştırılır: düzen filtrelerini yazdırır (gerçek FFmpeg denemesi için).
    #[test]
    #[ignore]
    fn duzen_filtrelerini_yazdir() {
        for style in [SplitStyle::Circle, SplitStyle::Pip, SplitStyle::Duo] {
            println!(
                "{:?}\t{}",
                style,
                layout_frame(style, Some("#ffd43b")).filter()
            );
        }
    }

    #[test]
    fn kamera_ve_oyun_alt_alta_dizilir() {
        let frame = Frame {
            width: 1080,
            height: 1920,
            fit: false,
            blur: false,
            position: 0.5,
            split: Some(Split {
                cam: Rect {
                    x: 0.7,
                    y: 0.05,
                    w: 0.25,
                    h: 0.3,
                },
                game: Rect {
                    x: 0.2,
                    y: 0.0,
                    w: 0.6,
                    h: 1.2,
                },
                cam_share: 0.35,
                cam_top: true,
                style: SplitStyle::Stack,
                cam2: None,
                spot: None,
                ring: None,
                band: None,
            }),
            gradient: None,
            track: None,
        };
        let f = frame.filter();
        // Kamera 1920*0.35 = 672 px; oyun bölgesi kaynağın içine sığdırılır (h 1).
        assert!(
            f.starts_with("split[sa][sb];[sa]crop=iw*0.25:ih*0.3:iw*0.7:ih*0.05,scale=1080:672:"),
            "{f}"
        );
        assert!(
            f.contains("[sb]crop=iw*0.6:ih*1:iw*0.2:ih*0,scale=1080:1248:"),
            "{f}"
        );
        assert!(f.ends_with("[scam][sgame]vstack=inputs=2,setsar=1"), "{f}");
        let below = Frame {
            split: frame.split.map(|s| Split {
                cam_top: false,
                ..s
            }),
            ..frame
        };
        assert!(below.filter().contains("[sgame][scam]vstack"));
    }

    #[test]
    fn yazi_dosyadan_okunur_zaman_araliklarinda_gorunur() {
        let overlay = TextOverlay {
            text: "Merhaba".into(),
            ranges: vec![(1.0, 3.5), (8.0, 9.0)],
            x: 0.5,
            y: 0.82,
            size: 0.07,
            color: "#FFD43B".into(),
            boxed: true,
            bold: true,
            style: TextStyle::Classic,
            anim: TextAnim::None,
        };
        let filter = drawtext_filter(
            &overlay,
            r"C:\Users\a'b\t.txt",
            r"C:\Windows\Fonts\segoeuib.ttf",
        )
        .unwrap();
        assert!(filter.contains(r"fontfile='C\:/Windows/Fonts/segoeuib.ttf'"));
        assert!(filter.contains(r"textfile='C\:/Users/a'\''b/t.txt':expansion=none"));
        assert!(filter.contains(
            r"fontsize=min(w\,h)*0.07:fontcolor=0xFFD43B:x=w*0.5-text_w/2:y=h*0.82-text_h/2"
        ));
        assert!(
            filter.contains("box=1") && filter.contains("enable='between(t,1,3.5)+between(t,8,9)'")
        );
        let empty = TextOverlay {
            ranges: vec![],
            ..overlay
        };
        assert!(drawtext_filter(&empty, "t", "f").is_none());
    }

    #[test]
    fn yazi_stili_ve_animasyonu_ifadeye_doner() {
        let overlay = TextOverlay {
            text: "A".into(),
            ranges: vec![(2.0, 5.0)],
            x: 0.5,
            y: 0.5,
            size: 0.1,
            color: "#ffd43b".into(),
            boxed: false,
            bold: true,
            style: TextStyle::Highlight,
            anim: TextAnim::Pop,
        };
        let f = drawtext_filter(&overlay, "t", "f").unwrap();
        // Açık sarı kutuda koyu yazı.
        assert!(f.contains("fontcolor=0x111111") && f.contains("boxcolor=0xffd43b@0.95"));
        assert!(f.contains("fontsize='min(w,h)*0.1*(0.3+0.7*"));
        assert!(f.contains("alpha='min(min(clip((t-2)/0.35,0,1)*3,1),clip((5-t)/0.3,0,1))'"));
        let neon = TextOverlay {
            style: TextStyle::Neon,
            anim: TextAnim::None,
            ..overlay
        };
        let neon = drawtext_filter(&neon, "t", "f").unwrap();
        assert!(neon.contains("fontcolor=0xffffff") && neon.contains("bordercolor=0xffd43b"));
    }

    #[test]
    fn muzik_klip_sesiyle_karistirilir() {
        let post = VideoPost {
            music: vec![MusicTrack {
                path: "sarki.mp3".into(),
                start: 2.5,
                src_start: 10.0,
                length: 20.0,
                volume: 0.6,
                fade_in: 1.0,
                fade_out: 2.0,
                duck: false,
                envelope: Vec::new(),
            }],
            ..VideoPost::default()
        };
        let args = merge_args("in.mp4", "out.mp4", &clips(), AV, None, &post).join(" ");
        assert!(
            args.contains("-ss 10 -t 20 -i sarki.mp3")
                || args.contains("-ss 10.000 -t 20.000 -i sarki.mp3")
        );
        assert!(args.contains("[2:a:0]aresample=48000,aformat=channel_layouts=stereo,volume=0.6,afade=t=in:st=0:d=1,afade=t=out:st=18:d=2,adelay=2500|2500[m0]"));
        assert!(args.contains("[ac][m0]amix=inputs=2:duration=first:normalize=0[a]"));
    }

    #[test]
    fn kisilan_muzik_klip_sesini_dinler() {
        let track = |duck| MusicTrack {
            path: "sarki.mp3".into(),
            start: 0.0,
            src_start: 0.0,
            length: 20.0,
            volume: 0.6,
            fade_in: 0.0,
            fade_out: 0.0,
            duck,
            envelope: Vec::new(),
        };
        let post = VideoPost {
            music: vec![track(true), track(false)],
            ..VideoPost::default()
        };
        let args = merge_args("in.mp4", "out.mp4", &clips(), AV, None, &post).join(" ");
        assert!(args.contains(";[ac]asplit=2[acm][acs0]"), "{args}");
        assert!(args.contains("[m0][acs0]sidechaincompress="), "{args}");
        assert!(
            args.contains("[acm][md0][m1]amix=inputs=3:duration=first:normalize=0[a]"),
            "{args}"
        );
    }

    #[test]
    fn resimler_yazilardan_sonra_bindirilir() {
        let post = VideoPost {
            texts: vec!["drawtext=YAZI".into()],
            fx_size: Some((1920, 1080)),
            images: vec![ImageOverlay {
                path: "logo.png".into(),
                ranges: vec![(0.0, 4.0)],
                x: 0.9,
                y: 0.1,
                size: 0.15,
                opacity: 0.8,
            }],
            ..VideoPost::default()
        };
        let args = merge_args("in.mp4", "out.mp4", &clips(), AV, None, &post).join(" ");
        assert!(args.contains("-loop 1 -i logo.png"));
        assert!(args.contains("[vc]drawtext=YAZI[vo0];[2:v]scale=288:-2,format=rgba,colorchannelmixer=aa=0.8[ov0];[vo0][ov0]overlay="));
        assert!(args.contains(":shortest=1:enable='between(t,0,4)'[v]"));
    }

    #[test]
    fn hareketli_baslik_videosu_kaydirilip_saydam_bindirilir() {
        let post = VideoPost {
            fx_size: Some((1920, 1080)),
            images: vec![ImageOverlay {
                path: "baslik.webm".into(),
                ranges: vec![(2.5, 8.5)],
                x: 0.5,
                y: 0.5,
                size: 1.0,
                opacity: 1.0,
            }],
            ..VideoPost::default()
        };
        let args = merge_args("in.mp4", "out.mp4", &clips(), AV, None, &post).join(" ");
        assert!(args.contains("-c:v libvpx-vp9 -itsoffset 2.5"), "{args}");
        assert!(args.contains("-i baslik.webm"), "{args}");
        assert!(!args.contains("-loop 1 -i baslik.webm"), "{args}");
        assert!(
            args.contains(":eof_action=pass:enable='between(t,2.5,8.5)'[v]"),
            "{args}"
        );
    }

    #[test]
    fn yazilar_cerceveden_sonra_uygulanir() {
        let post = VideoPost {
            frame: Some(Frame {
                width: 1080,
                height: 1920,
                fit: false,
                blur: false,
                position: 0.5,
                split: None,
                gradient: None,
                track: None,
            }),
            texts: vec!["drawtext=YAZI".into()],
            ..VideoPost::default()
        };
        let args = merge_args("in.mp4", "out.mp4", &clips(), AV, None, &post).join(" ");
        assert!(args
            .contains("crop=1080:1920:x='(iw-ow)*0.5':y='(ih-oh)*0.5',setsar=1,drawtext=YAZI[v]"));
    }

    #[test]
    fn gif_paletle_ve_hizla_uretilir() {
        let inputs = [
            MergeInput {
                path: "in.mp4",
                range: Some((5.0, 3.0)),
                clip: Clip {
                    speed: 2.0,
                    ..Clip::new(0.0, 3.0)
                },
            },
            MergeInput {
                path: "in.mp4",
                range: Some((20.0, 1.5)),
                clip: Clip::new(0.0, 1.5),
            },
        ];
        let gif = GifOptions {
            fps: 60,
            width: 480,
        };
        let args = gif_args(&inputs, "out.gif", gif, &VideoPost::default()).join(" ");
        assert!(args.starts_with("-y -ss 5 -t 3 -i in.mp4 -ss 20 -t 1.5 -i in.mp4"));
        assert!(
            args.contains("[0:v:0]setpts=PTS/2[v0];[v0][1:v:0]concat=n=2:v=1:a=0[gc];[gc]fps=30,")
        );
        assert!(args.contains("scale=w='min(480,iw)'") && args.contains("palettegen"));
        assert!(args.contains("-an -loop 0") && args.ends_with("out.gif"));

        // Gizleme bölgesi ve logo GIF'e de uygulanır (gizlenen bilgi açığa çıkmasın).
        let post = VideoPost {
            frame: Some(Frame {
                width: 1080,
                height: 1920,
                fit: false,
                blur: false,
                position: 0.5,
                split: None,
                gradient: None,
                track: None,
            }),
            blurs: vec![pixel_region()],
            images: vec![ImageOverlay {
                path: "logo.png".into(),
                ranges: vec![(0.0, 2.0)],
                x: 0.9,
                y: 0.1,
                size: 0.2,
                opacity: 1.0,
            }],
            ..VideoPost::default()
        };
        let args = gif_args(&inputs, "out.gif", gif, &post).join(" ");
        assert!(args.contains("-i in.mp4 -loop 1 -i logo.png"), "{args}");
        assert!(
            args.contains("concat=n=2:v=1:a=0[gc];[gc]split[bz0a][bz0b]"),
            "{args}"
        );
        assert!(args.contains("[2:v]scale=216:-2"), "{args}");
        assert!(args.contains("[gf]fps=30,"), "{args}");
    }

    fn cam_overlay() -> ClipOverlay {
        ClipOverlay {
            path: "cam.mp4".into(),
            clip: Clip {
                fade_in: 0.5,
                transform: Some(crate::ffmpeg::transform::Transform {
                    x: 0.3,
                    y: -0.25,
                    scale: 0.4,
                    ..Default::default()
                }),
                ..Clip::new(0.5, 2.5)
            },
            at: 1.0,
            size: Some((320, 240)),
            has_audio: true,
        }
    }

    #[test]
    fn ust_izdeki_klip_saydam_bindirilir_ve_sesi_karisir() {
        let post = VideoPost {
            fx_size: Some((640, 360)),
            overlays: vec![cam_overlay()],
            ..VideoPost::default()
        };
        assert!(!post.is_empty());
        let args =
            merge_args("in.mp4", "out.mp4", &[Clip::new(0.0, 4.0)], AV, None, &post).join(" ");
        assert!(args.contains("-i in.mp4 -ss 0.5 -t 2 -i cam.mp4"), "{args}");
        assert!(args.contains("concat=n=1:v=1:a=1[vb][ab]"), "{args}");
        assert!(
            args.contains(concat!(
                "[1:v:0]scale=480:360,setsar=1,fps=30,format=yuva420p,fade=t=in:st=0:d=0.5:alpha=1,",
                "scale=w='2*ceil(iw*(0.4)/2)':h='2*ceil(ih*(0.4)/2)':eval=frame,",
                "pad=w=192:h=144:x='(ow-iw)/2':y='(oh-ih)/2':color=black@0:eval=frame,",
                "setpts=PTS-STARTPTS+1/TB[ov0]"
            )),
            "{args}"
        );
        assert!(
            args.contains("[vb][ov0]overlay=x='W/2+(0.3)*W-w/2':y='H/2+(-0.25)*H-h/2':eval=frame:eof_action=pass:enable='between(t,1,3)'[v]"),
            "{args}"
        );
        assert!(
            args.contains("[1:a:0]aresample=48000,afade=t=in:st=0:d=0.5,adelay=delays=1000:all=1[oa0];[ab][oa0]amix=inputs=2:duration=first:normalize=0[a]"),
            "{args}"
        );
        // Sessiz kaynakta yalnız görüntü; tuval bilinmezse yalnız ses.
        let silent = VideoPost {
            fx_size: Some((640, 360)),
            overlays: vec![ClipOverlay {
                has_audio: false,
                ..cam_overlay()
            }],
            ..VideoPost::default()
        };
        let args = merge_args(
            "in.mp4",
            "out.mp4",
            &[Clip::new(0.0, 4.0)],
            AV,
            None,
            &silent,
        )
        .join(" ");
        assert!(
            args.contains("concat=n=1:v=1:a=1[vb][a]") && !args.contains("amix"),
            "{args}"
        );
        let blind = VideoPost {
            overlays: vec![cam_overlay()],
            ..VideoPost::default()
        };
        let args = merge_args(
            "in.mp4",
            "out.mp4",
            &[Clip::new(0.0, 4.0)],
            AV,
            None,
            &blind,
        )
        .join(" ");
        assert!(
            args.contains("concat=n=1:v=1:a=1[v][ab]") && !args.contains("overlay="),
            "{args}"
        );
    }

    #[test]
    fn ana_izdeki_donusum_klibin_zincirinde_ve_gifte_bindirme() {
        let clip = Clip {
            transform: Some(crate::ffmpeg::transform::Transform {
                scale: 1.5,
                ..Default::default()
            }),
            ..Clip::new(0.0, 4.0)
        };
        assert!(clip.has_effects());
        let steps = clip.video_steps(Some((640, 360))).join(",");
        assert!(steps.starts_with("scale=w='2*ceil(iw*(1.5)/2)'"), "{steps}");
        assert!(steps.contains("crop=640:360:x='160-(0)*640'"), "{steps}");
        let inputs = [MergeInput {
            path: "in.mp4",
            range: Some((0.0, 4.0)),
            clip: Clip::new(0.0, 4.0),
        }];
        let post = VideoPost {
            fx_size: Some((640, 360)),
            overlays: vec![cam_overlay()],
            ..VideoPost::default()
        };
        let args = gif_args(
            &inputs,
            "out.gif",
            GifOptions {
                fps: 10,
                width: 320,
            },
            &post,
        )
        .join(" ");
        assert!(args.contains("-i in.mp4 -ss 0.5 -t 2 -i cam.mp4"), "{args}");
        assert!(args.contains("concat=n=1:v=1:a=0[gc];[1:v:0]"), "{args}");
        assert!(
            args.contains("[gc][ov0]overlay=") && args.contains("[gco];[gco]fps=10"),
            "{args}"
        );
    }

    #[test]
    fn onizleme_kopyasi_hafif_h264_uretir() {
        let args = preview_copy_args("in.avi", "p.mp4", true).join(" ");
        assert!(args.contains("ultrafast") && args.contains("min(480,ih)"));
        let audio = preview_copy_args("in.wma", "p.m4a", false).join(" ");
        assert!(audio.contains("-vn") && !audio.contains("libx264"));
    }
}

#[cfg(test)]
mod live_args {
    use super::*;

    /// Elle FFmpeg denemesi: `DOWNKIT_LIVE_DIR=… cargo test canli_komut -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn canli_komut() {
        let dir = std::env::var("DOWNKIT_LIVE_DIR").unwrap();
        let src = format!("{dir}/src.mp4");
        let clip = Clip {
            motion: Motion::ZoomIn,
            motion_total: 4.0,
            fade_in: 0.5,
            transition: Transition::Zoom,
            ..Clip::new(1.0, 5.0)
        };
        let post = VideoPost {
            frame: Some(Frame {
                width: 1080,
                height: 1920,
                fit: true,
                blur: true,
                position: 0.5,
                split: None,
                gradient: None,
                track: None,
            }),
            fx_size: Some((1280, 720)),
            images: vec![ImageOverlay {
                path: format!("{dir}/logo.png"),
                ranges: vec![(0.0, 4.0)],
                x: 0.85,
                y: 0.1,
                size: 0.2,
                opacity: 0.9,
            }],
            music: vec![MusicTrack {
                path: format!("{dir}/music.mp3"),
                start: 1.0,
                src_start: 3.0,
                length: 10.0,
                volume: 0.5,
                fade_in: 0.5,
                fade_out: 1.0,
                duck: false,
                envelope: Vec::new(),
            }],
            ..VideoPost::default()
        };
        let streams = Streams {
            video: true,
            audio: true,
        };
        let args = merge_args(
            &src,
            &format!("{dir}/out.mp4"),
            &[clip],
            streams,
            None,
            &post,
        );
        println!("ARGS\u{1}{}", args.join("\u{1}"));
    }
}

#[cfg(test)]
mod live_transform {
    use super::*;
    use crate::ffmpeg::transform::{Curve, Key, Keys, Transform};

    /// Elle FFmpeg denemesi: `DOWNKIT_LIVE_DIR=… cargo test canli_donusum -- --ignored --nocapture`
    /// Ana klipte 1. saniyede yumuşak yakınlaşma, üst izde dönen ve saydamlaşan kamera.
    #[test]
    #[ignore]
    fn canli_donusum() {
        let dir = std::env::var("DOWNKIT_LIVE_DIR").unwrap();
        let key = |t: f64, v: f64, ease: Curve| Key { t, v, ease };
        let base = Clip {
            transform: Some(Transform {
                keys: Keys {
                    scale: vec![key(1.0, 1.0, Curve::Ease), key(1.5, 1.4, Curve::Linear)],
                    x: vec![key(1.0, 0.0, Curve::Ease), key(1.5, 0.1, Curve::Linear)],
                    ..Keys::default()
                },
                ..Transform::default()
            }),
            ..Clip::new(0.0, 4.0)
        };
        let overlay = ClipOverlay {
            path: format!("{dir}/cam.mp4"),
            clip: Clip {
                fade_in: 0.3,
                transform: Some(Transform {
                    x: 0.3,
                    y: 0.25,
                    scale: 0.35,
                    keys: Keys {
                        rotation: vec![
                            key(0.0, -20.0, Curve::Linear),
                            key(2.0, 20.0, Curve::Linear),
                        ],
                        opacity: vec![key(0.0, 1.0, Curve::Linear), key(2.0, 0.4, Curve::Linear)],
                        ..Keys::default()
                    },
                    ..Transform::default()
                }),
                ..Clip::new(0.0, 2.0)
            },
            at: 1.0,
            size: Some((320, 240)),
            has_audio: true,
        };
        let post = VideoPost {
            fx_size: Some((640, 360)),
            overlays: vec![overlay],
            frame: Some(Frame {
                width: 360,
                height: 640,
                fit: true,
                blur: false,
                position: 0.5,
                split: None,
                gradient: None,
                track: None,
            }),
            ..VideoPost::default()
        };
        let streams = Streams {
            video: true,
            audio: true,
        };
        let args = merge_args(
            &format!("{dir}/src.mp4"),
            &format!("{dir}/out3.mp4"),
            &[base],
            streams,
            None,
            &post,
        );
        println!("ARGS\u{1}{}", args.join("\u{1}"));
    }
}

#[cfg(test)]
mod band_print {
    use super::*;

    /// Elle: `cargo test serit_yazdir -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn serit_yazdir() {
        let frame = Frame {
            width: 360,
            height: 640,
            fit: false,
            blur: false,
            position: 0.5,
            split: Some(Split {
                cam: Rect {
                    x: 0.7,
                    y: 0.05,
                    w: 0.28,
                    h: 0.35,
                },
                game: Rect {
                    x: 0.1,
                    y: 0.0,
                    w: 0.6,
                    h: 1.0,
                },
                cam_share: 0.3,
                cam_top: true,
                style: SplitStyle::Stack,
                cam2: None,
                spot: None,
                ring: None,
                band: Some(Band {
                    share: 0.12,
                    color: Color([0xff, 0xd4, 0x3b]),
                }),
            }),
            gradient: None,
            track: None,
        };
        println!("VF {}", frame.filter());
    }
}

#[cfg(test)]
mod gif_print {
    use super::*;

    /// Elle çalıştırılır: gizleme + logo içeren GIF argümanlarını yazdırır.
    #[test]
    #[ignore]
    fn gif_argumanlarini_yazdir() {
        let inputs = [MergeInput {
            path: "IN",
            range: Some((0.0, 2.0)),
            clip: Clip::new(0.0, 2.0),
        }];
        let post = VideoPost {
            blurs: vec![BlurRegion {
                ranges: vec![(0.0, 2.0)],
                x: 0.1,
                y: 0.1,
                w: 0.4,
                h: 0.4,
                strength: 1.0,
                pixel: true,
                keys: vec![],
            }],
            images: vec![ImageOverlay {
                path: "LOGO".into(),
                ranges: vec![(0.0, 2.0)],
                x: 0.85,
                y: 0.15,
                size: 0.2,
                opacity: 1.0,
            }],
            fx_size: Some((640, 360)),
            ..VideoPost::default()
        };
        for a in gif_args(
            &inputs,
            "OUT",
            GifOptions {
                fps: 10,
                width: 320,
            },
            &post,
        ) {
            println!("ARG\t{a}");
        }
    }
}
