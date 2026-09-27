//! Klip Düzenleyici için FFmpeg argümanları: kare şeridi, dalga formu, önizleme
//! kopyası ve klipleri tek dosyada birleştirme. Hepsi saf fonksiyon; süreç
//! yönetimi `commands::editor` ve `commands::edit` içinde.

use super::trim::seconds_arg;

/// Kaynaktan alınacak tek parça (saniye), oynatma hızı, ses düzeyi ve geçişler.
#[derive(Debug, Clone, Copy, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
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
    /// Görünüm: filtre, renk ayarları, efektler (Clipchamp'taki sağ araçlar).
    #[serde(default)]
    pub look: Look,
    /// Açılma/kararma siyah yerine beyazdan ("Beyaza aç" geçişi).
    #[serde(default)]
    pub fade_white: bool,
    /// Zaman çizelgesindeki boşluk: bu süre boyunca siyah görüntü ve sessizlik
    /// (`end - start` kadar). Kaynaktan bir şey okunmaz, indirilmez.
    #[serde(default)]
    pub black: bool,
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
}

/// Klibin görünümü. Renk değerleri −1…1 (0 = olduğu gibi), bulanıklık 0…1.
#[derive(Debug, Clone, Copy, Default, PartialEq, serde::Deserialize)]
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
        steps
    }
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
#[derive(Debug, Clone, Copy, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub width: u32,
    pub height: u32,
    /// true: kırpmadan sığdır, boşluklar siyah bant.
    #[serde(default)]
    pub fit: bool,
    #[serde(default = "center")]
    pub position: f64,
}

fn center() -> f64 {
    0.5
}

impl Frame {
    pub fn filter(&self) -> String {
        let even = |v: u32| v.clamp(16, 4096) & !1;
        let (w, h) = (even(self.width), even(self.height));
        if self.fit {
            format!(
            "scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1"
        )
        } else {
            let p = number(if self.position.is_finite() {
                self.position.clamp(0.0, 1.0)
            } else {
                0.5
            });
            format!(
            "scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h}:(iw-ow)*{p}:(ih-oh)*{p},setsar=1"
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
}

/// Filtre değerindeki Windows yolu: `C:\a\b` → `C\:/a/b` (tek tırnak içinde kullanılır).
pub fn filter_path(path: &str) -> String {
    path.replace('\\', "/")
        .replace(':', "\\:")
        .replace('\'', "'\\''")
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
    let background = if overlay.boxed {
        r":box=1:boxcolor=black@0.55:boxborderw=min(w\,h)*0.012"
    } else {
        ":shadowcolor=black@0.75:shadowx=2:shadowy=2"
    };
    Some(format!(
        "drawtext=fontfile='{}':textfile='{}':expansion=none:fontsize=min(w\\,h)*{size}:fontcolor={}:\
         x=w*{}-text_w/2:y=h*{}-text_h/2{background}:enable='{}'",
        filter_path(font_file),
        filter_path(text_file),
        hex_color(&overlay.color),
        number(clamp(overlay.x, 0.0, 1.0)),
        number(clamp(overlay.y, 0.0, 1.0)),
        ranges.join("+"),
    ))
}

/// Birleştirilmiş görüntüye uygulanan son filtreler: çerçeve, sonra yazılar
/// (yazılar çıkış karesine göre konumlanır).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct VideoPost {
    pub frame: Option<Frame>,
    /// Hazır drawtext filtreleri.
    pub texts: Vec<String>,
}

impl VideoPost {
    #[cfg(test)]
    pub fn framed(frame: Frame) -> VideoPost {
        VideoPost {
            frame: Some(frame),
            texts: Vec::new(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.frame.is_none() && self.texts.is_empty()
    }

    fn chain(&self) -> Option<String> {
        let mut steps: Vec<String> = self.frame.iter().map(Frame::filter).collect();
        steps.extend(self.texts.iter().cloned());
        (!steps.is_empty()).then(|| steps.join(","))
    }
}

impl Clip {
    /// Efektsiz klip (normal hız, özgün ses, geçiş yok).
    #[cfg(test)]
    pub fn new(start: f64, end: f64) -> Clip {
        Clip {
            start,
            end,
            speed: 1.0,
            volume: 1.0,
            fade_in: 0.0,
            fade_out: 0.0,
            look: Look::default(),
            fade_white: false,
            black: false,
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

    pub fn speed(&self) -> f64 {
        if self.black {
            return 1.0;
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

    /// Çıktıdaki uzunluk (hız uygulanmış).
    pub fn output_duration(&self) -> f64 {
        self.duration() / self.speed()
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
    }

    /// Görüntü filtreleri: hız, sonra geçişler (çıktı zamanında).
    fn video_steps(&self) -> Vec<String> {
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
        let mut steps = Vec::new();
        if !self.is_normal_speed() {
            steps.push(format!("setpts=PTS/{}", number(self.speed())));
        }
        steps.extend(self.look.steps());
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
        let mut steps = Vec::new();
        if !self.is_normal_speed() {
            steps.push(atempo_chain(self.speed()));
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
        steps
    }
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
fn video_encode_args(container: &str) -> Vec<String> {
    let mut args: Vec<&str> = if container == "webm" {
        vec![
            "-c:v",
            "libvpx-vp9",
            "-b:v",
            "0",
            "-crf",
            "32",
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
    } else {
        vec![
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a",
            "aac", "-b:a", "192k",
        ]
    };
    if matches!(container, "mp4" | "mov" | "m4v") {
        args.extend(["-movflags", "+faststart"]);
    }
    args.into_iter().map(String::from).collect()
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
            range: Some(if c.black {
                (0.0, BLACK_SOURCE_SECONDS)
            } else {
                (c.start, c.duration())
            }),
            clip: *c,
        })
        .collect();
    merge_inputs_args(&inputs, output, streams, audio_format, post)
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
pub fn merge_inputs_args(
    inputs: &[MergeInput],
    output: &str,
    streams: Streams,
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

    let mut filter = String::new();
    let mut labels = String::new();
    for (index, input) in inputs.iter().enumerate() {
        if video {
            let label = chain(
                &mut filter,
                &format!("[{index}:v:0]"),
                &input.clip.video_steps(),
                &format!("[v{index}]"),
            );
            labels.push_str(&label);
        }
        if audio {
            let label = chain(
                &mut filter,
                &format!("[{index}:a:0]"),
                &input.clip.audio_steps(),
                &format!("[a{index}]"),
            );
            labels.push_str(&label);
        }
    }
    filter.push_str(&labels);
    filter.push_str(&format!(
        "concat=n={}:v={}:a={}",
        inputs.len(),
        u8::from(video),
        u8::from(audio)
    ));
    // Çerçeve (ör. dikey) ve yazılar birleştirilmiş görüntüye uygulanır.
    let finish = post.chain().filter(|_| video);
    if video {
        filter.push_str(if finish.is_some() { "[vc]" } else { "[v]" });
    }
    if audio {
        filter.push_str("[a]");
    }
    if let Some(chain) = finish {
        filter.push_str(&format!(";[vc]{chain}[v]"));
    }
    args.extend(["-filter_complex".into(), filter]);
    if video {
        args.extend(["-map".into(), "[v]".into()]);
    }
    if audio {
        args.extend(["-map".into(), "[a]".into()]);
    }

    let container = output
        .rsplit('.')
        .next()
        .unwrap_or("mp4")
        .to_ascii_lowercase();
    match audio_format {
        Some((format, kbps)) => args.extend(audio_codec_args(format, kbps)),
        None if video => args.extend(video_encode_args(&container)),
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

    let mut filter = String::new();
    let mut labels = String::new();
    for (index, input) in inputs.iter().enumerate() {
        let label = chain(
            &mut filter,
            &format!("[{index}:v:0]"),
            &input.clip.video_steps(),
            &format!("[v{index}]"),
        );
        labels.push_str(&label);
    }
    let framed = post.chain().map(|c| format!("{c},")).unwrap_or_default();
    filter.push_str(&format!(
        "{labels}concat=n={}:v=1:a=0,{framed}fps={},scale=w='min({},iw)':h=-1:flags=lanczos,\
         split[s0][s1];[s0]palettegen=stats_mode=diff[p];\
         [s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle[v]",
        inputs.len(),
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

/// İndirilen bölüm dosyalarını (aynı biçimde oldukları için) yeniden kodlamadan
/// uç uca ekler. Liste dosyası `concat_list` ile yazılır.
pub fn concat_copy_args(list_path: &str, output: &str) -> Vec<String> {
    let mut args: Vec<String> = [
        "-y", "-f", "concat", "-safe", "0", "-i", list_path, "-map", "0:v?", "-map", "0:a?", "-c",
        "copy",
    ]
    .map(String::from)
    .to_vec();
    let lower = output.to_ascii_lowercase();
    if [".mp4", ".m4a", ".mov"].iter().any(|e| lower.ends_with(e)) {
        args.extend(["-movflags".into(), "+faststart".into()]);
    }
    args.extend(progress_args(output));
    args
}

/// FFmpeg concat demuxer liste dosyası. Yoldaki tek tırnak `'\''` ile kaçırılır.
pub fn concat_list(paths: &[String]) -> String {
    paths
        .iter()
        .map(|p| format!("file '{}'\n", p.replace('\'', "'\\''")))
        .collect()
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
        let steps = clip.video_steps().join(",");
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
    fn birlestirme_listesi_tirnaklari_kacirir() {
        let list = concat_list(&["C:\\a\\1.mp4".into(), "C:\\b\\Ali'nin.mp4".into()]);
        assert_eq!(list, "file 'C:\\a\\1.mp4'\nfile 'C:\\b\\Ali'\\''nin.mp4'\n");
        let args = concat_copy_args("list.txt", "out.mp4").join(" ");
        assert!(args.contains("-f concat -safe 0 -i list.txt"));
        assert!(args.contains("-c copy -movflags +faststart"));
        assert!(!concat_copy_args("l.txt", "o.mkv").contains(&"+faststart".to_string()));
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
        let args =
            merge_inputs_args(&inputs, "out.webm", AV, None, &VideoPost::default()).join(" ");
        assert!(args.starts_with("-y -i a.webm -i b.webm"));
        assert!(args.contains("setpts=PTS/0.5") && args.contains("libvpx-vp9"));
        assert!(!args.contains("+faststart"));
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
            &[clip],
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
    fn dikey_cerceve_birlesimden_sonra_kirpar_ya_da_sigdirir() {
        let frame = Frame {
            width: 1080,
            height: 1920,
            fit: false,
            position: 0.25,
        };
        let args = merge_args(
            "in.mp4",
            "out.mp4",
            &clips(),
            AV,
            None,
            &VideoPost::framed(frame),
        )
        .join(" ");
        assert!(args.contains("concat=n=2:v=1:a=1[vc][a];[vc]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(iw-ow)*0.25:(ih-oh)*0.25,setsar=1[v]"));
        let fit = Frame { fit: true, ..frame }.filter();
        assert!(fit.contains("force_original_aspect_ratio=decrease,pad=1080:1920"));
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
    fn yazilar_cerceveden_sonra_uygulanir() {
        let post = VideoPost {
            frame: Some(Frame {
                width: 1080,
                height: 1920,
                fit: false,
                position: 0.5,
            }),
            texts: vec!["drawtext=YAZI".into()],
        };
        let args = merge_args("in.mp4", "out.mp4", &clips(), AV, None, &post).join(" ");
        assert!(args.contains("crop=1080:1920:(iw-ow)*0.5:(ih-oh)*0.5,setsar=1,drawtext=YAZI[v]"));
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
        assert!(args.contains("[0:v:0]setpts=PTS/2[v0];[v0][1:v:0]concat=n=2:v=1:a=0,fps=30,"));
        assert!(args.contains("scale=w='min(480,iw)'") && args.contains("palettegen"));
        assert!(args.contains("-an -loop 0") && args.ends_with("out.gif"));
    }

    #[test]
    fn onizleme_kopyasi_hafif_h264_uretir() {
        let args = preview_copy_args("in.avi", "p.mp4", true).join(" ");
        assert!(args.contains("ultrafast") && args.contains("min(480,ih)"));
        let audio = preview_copy_args("in.wma", "p.m4a", false).join(" ");
        assert!(audio.contains("-vn") && !audio.contains("libx264"));
    }
}
