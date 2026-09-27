//! Ekran kaydı için FFmpeg argümanları (saf fonksiyonlar).
//!
//! - Monitör `ddagrab` ile yakalanır (Desktop Duplication): ekran durağanken de
//!   kareyi tekrarlayıp sabit kare hızı verir.
//! - Pencere ya da ddagrab'ın erişemediği monitör (ör. ikinci ekran kartındaki)
//!   `gfxcapture` (Windows.Graphics.Capture) ile yakalanır; yalnızca içerik
//!   değişince kare üretir, çıktıda `-fps_mode cfr` boşlukları doldurur.
//! - Kareler ekran kartında kalır; NVENC/AMF bunları doğrudan kodlar. QSV ve
//!   işlemci kodlayıcısı için kareler belleğe indirilir.

use serde::{Deserialize, Serialize};

/// Geriye dönük kayıtta bir parçanın süresi (saniye); anahtar kare aralığı da bu.
pub const SEGMENT_SECONDS: u32 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Encoder {
    Nvenc,
    Amf,
    Qsv,
    X264,
}

impl Encoder {
    /// Denenme sırası: donanım kodlayıcıları işlemciyi neredeyse hiç yormaz.
    pub const ALL: [Encoder; 4] = [Encoder::Nvenc, Encoder::Amf, Encoder::Qsv, Encoder::X264];

    pub fn label(self) -> &'static str {
        match self {
            Encoder::Nvenc => "NVIDIA NVENC",
            Encoder::Amf => "AMD AMF",
            Encoder::Qsv => "Intel Quick Sync",
            Encoder::X264 => "x264",
        }
    }

    pub fn is_hardware(self) -> bool {
        self != Encoder::X264
    }

    /// Ekran kartındaki (D3D11) kareyi indirmeden alabilir mi?
    fn takes_gpu_frames(self) -> bool {
        matches!(self, Encoder::Nvenc | Encoder::Amf)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Quality {
    High,
    Balanced,
    Small,
}

impl Quality {
    fn level(self) -> usize {
        match self {
            Quality::High => 0,
            Quality::Balanced => 1,
            Quality::Small => 2,
        }
    }
}

/// Neyin kaydedileceği. Tutamaçlar (HMONITOR/HWND) listeden gelir.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CaptureTarget {
    #[serde(rename_all = "camelCase")]
    Monitor {
        hmonitor: u64,
        /// ddagrab'ın çıkış sırası; monitör başka ekran kartındaysa yok.
        dda_index: Option<u32>,
        width: u32,
        height: u32,
    },
    #[serde(rename_all = "camelCase")]
    Window { hwnd: u64, width: u32, height: u32 },
}

impl CaptureTarget {
    fn uses_dda(&self) -> bool {
        matches!(
            self,
            CaptureTarget::Monitor {
                dda_index: Some(_),
                ..
            }
        )
    }

    fn size(&self) -> (u32, u32) {
        match *self {
            CaptureTarget::Monitor { width, height, .. } => (width, height),
            CaptureTarget::Window { width, height, .. } => (width, height),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoOptions {
    pub fps: u32,
    /// Bundan yüksekse küçültülür (ör. 1440p ekran 1080p kaydedilir). Yoksa özgün.
    pub max_height: Option<u32>,
    pub quality: Quality,
    #[serde(default = "yes")]
    pub cursor: bool,
    /// Verilirse kalite ön ayarı yerine bu bit hızı (kbps) hedeflenir.
    #[serde(default)]
    pub bitrate_kbps: Option<u32>,
}

fn yes() -> bool {
    true
}

impl VideoOptions {
    fn fps(&self) -> u32 {
        self.fps.clamp(10, 120)
    }
}

/// Çıktı boyutu: en fazla `max_height`, en-boy korunur, iki boyut da çift sayı.
pub fn output_size(source: (u32, u32), max_height: Option<u32>) -> Option<(u32, u32)> {
    let (w, h) = source;
    let limit = max_height?;
    if h <= limit || w == 0 || h == 0 {
        return None;
    }
    let width = ((w as u64 * limit as u64 / h as u64) as u32) & !1;
    Some((width.max(2), limit & !1))
}

fn bool01(value: bool) -> u8 {
    u8::from(value)
}

/// Yakalama girişi (`-f lavfi -i …`).
fn capture_input(target: &CaptureTarget, video: &VideoOptions) -> Vec<String> {
    let fps = video.fps();
    let cursor = bool01(video.cursor);
    let source = match *target {
        CaptureTarget::Monitor {
            dda_index: Some(index),
            ..
        } => format!("ddagrab=output_idx={index}:framerate={fps}:draw_mouse={cursor}"),
        CaptureTarget::Monitor { hmonitor, .. } => {
            gfx_source(&format!("hmonitor={hmonitor}"), target, video)
        }
        CaptureTarget::Window { hwnd, .. } => gfx_source(&format!("hwnd={hwnd}"), target, video),
    };
    ["-fpsprobesize", "0", "-f", "lavfi", "-i", source.as_str()]
        .map(String::from)
        .to_vec()
}

fn gfx_source(handle: &str, target: &CaptureTarget, video: &VideoOptions) -> String {
    let fps = video.fps();
    let cursor = bool01(video.cursor);
    // Küçültme yakalamanın içinde (ekran kartında) yapılır; -2: çift sayıya yuvarla
    // (pencerelerin boyutu tek sayı olabilir, H.264 çift ister).
    let size = match output_size(target.size(), video.max_height) {
        Some((w, h)) => format!(":width={w}:height={h}:resize_mode=scale_aspect"),
        None => ":width=-2:height=-2".to_string(),
    };
    format!("gfxcapture={handle}:max_framerate={fps}:capture_cursor={cursor}{size}")
}

/// Kodlayıcıdan önceki filtreler (gerekmiyorsa yok).
fn video_filter(target: &CaptureTarget, video: &VideoOptions, encoder: Encoder) -> Option<String> {
    let scale = if target.uses_dda() {
        output_size(target.size(), video.max_height)
    } else {
        None
    };
    let mut steps: Vec<String> = Vec::new();
    if scale.is_some() || !encoder.takes_gpu_frames() {
        steps.push("hwdownload".into());
        steps.push("format=bgra".into());
    }
    if let Some((w, h)) = scale {
        steps.push(format!("scale={w}:{h}:flags=bilinear"));
    }
    match encoder {
        Encoder::Qsv => steps.push("format=nv12".into()),
        Encoder::X264 => steps.push("format=yuv420p".into()),
        _ => {}
    }
    (!steps.is_empty()).then(|| steps.join(","))
}

/// Özel bit hızı sabittir (CBR): kullanıcının seçtiği değer dosyaya gerçekten
/// yansısın (VBR durağan ekranda hedefin çok altında kalıyordu). Arabellek 2 kat.
const MIN_BITRATE_KBPS: u32 = 1_000;
const MAX_BITRATE_KBPS: u32 = 100_000;

fn bitrate_args(encoder: Encoder, kbps: u32) -> Vec<String> {
    let k = kbps.clamp(MIN_BITRATE_KBPS, MAX_BITRATE_KBPS);
    let rate = |v: u32| format!("{v}k");
    let (target, peak, buffer) = (rate(k), rate(k), rate(k * 2));
    let head: &[&str] = match encoder {
        Encoder::Nvenc => &[
            "-c:v",
            "h264_nvenc",
            "-preset",
            "p4",
            "-rc",
            "cbr",
            "-spatial-aq",
            "1",
        ],
        Encoder::Amf => &[
            "-c:v",
            "h264_amf",
            "-usage",
            "transcoding",
            "-quality",
            "balanced",
            "-rc",
            "cbr",
        ],
        Encoder::Qsv => &["-c:v", "h264_qsv", "-preset", "veryfast"],
        Encoder::X264 => &["-c:v", "libx264", "-preset", "veryfast"],
    };
    head.iter()
        .map(|s| s.to_string())
        .chain([
            "-b:v".into(),
            target,
            "-maxrate".into(),
            peak,
            "-bufsize".into(),
            buffer,
        ])
        .collect()
}

fn encoder_args(encoder: Encoder, video: &VideoOptions) -> Vec<String> {
    let q = video.quality.level();
    let gop = (video.fps() * SEGMENT_SECONDS).to_string();
    let args: Vec<String> = match (encoder, video.bitrate_kbps) {
        (_, Some(kbps)) => bitrate_args(encoder, kbps),
        _ => match encoder {
            Encoder::Nvenc => {
                let cq = ["19", "23", "28"][q];
                [
                    "-c:v",
                    "h264_nvenc",
                    "-preset",
                    "p4",
                    "-rc",
                    "vbr",
                    "-cq",
                    cq,
                    "-b:v",
                    "0",
                    "-spatial-aq",
                    "1",
                ]
                .map(String::from)
                .to_vec()
            }
            Encoder::Amf => {
                let (i, p) = [("18", "20"), ("22", "24"), ("27", "29")][q];
                [
                    "-c:v",
                    "h264_amf",
                    "-usage",
                    "transcoding",
                    "-quality",
                    "balanced",
                    "-rc",
                    "cqp",
                    "-qp_i",
                    i,
                    "-qp_p",
                    p,
                ]
                .map(String::from)
                .to_vec()
            }
            Encoder::Qsv => {
                let gq = ["20", "24", "28"][q];
                [
                    "-c:v",
                    "h264_qsv",
                    "-preset",
                    "veryfast",
                    "-global_quality",
                    gq,
                ]
                .map(String::from)
                .to_vec()
            }
            Encoder::X264 => {
                let crf = ["19", "23", "27"][q];
                // 60 fps'te veryfast çoğu işlemciye ağır gelir.
                let preset = if video.fps() > 30 {
                    "superfast"
                } else {
                    "veryfast"
                };
                ["-c:v", "libx264", "-preset", preset, "-crf", crf]
                    .map(String::from)
                    .to_vec()
            }
        },
    };
    let mut args = args;
    args.extend(["-g".into(), gop]);
    args
}

/// Sesin geldiği boru (Rust tarafındaki karıştırıcı yazar): 48 kHz, stereo, f32.
fn audio_input(pipe: &str) -> Vec<String> {
    ["-f", "f32le", "-ar", "48000", "-ac", "2", "-i", pipe]
        .map(String::from)
        .to_vec()
}

/// Kayıt ve geriye dönük kaydın ortak kısmı: girişler, eşleme, kodlama, ilerleme.
fn common(
    target: &CaptureTarget,
    video: &VideoOptions,
    encoder: Encoder,
    audio_pipe: Option<&str>,
    keyframes_every_segment: bool,
) -> Vec<String> {
    let mut args: Vec<String> = ["-hide_banner", "-loglevel", "warning", "-y"]
        .map(String::from)
        .to_vec();
    args.extend(capture_input(target, video));
    if let Some(pipe) = audio_pipe {
        args.extend(audio_input(pipe));
    }
    args.extend(["-map".into(), "0:v".into()]);
    if audio_pipe.is_some() {
        args.extend(["-map".into(), "1:a".into()]);
    }
    if let Some(filter) = video_filter(target, video, encoder) {
        args.extend(["-vf".into(), filter]);
    }
    args.extend([
        "-fps_mode".into(),
        "cfr".into(),
        "-r".into(),
        video.fps().to_string(),
    ]);
    args.extend(encoder_args(encoder, video));
    if keyframes_every_segment {
        args.extend([
            "-force_key_frames".into(),
            format!("expr:gte(t,n_forced*{SEGMENT_SECONDS})"),
        ]);
    }
    if audio_pipe.is_some() {
        args.extend(["-c:a".into(), "aac".into(), "-b:a".into(), "160k".into()]);
    }
    args.extend(["-progress", "pipe:1", "-stats_period", "0.5", "-nostats"].map(String::from));
    args
}

/// Normal kayıt: önce MKV'ye yazılır (program çökse de dosya oynatılabilir),
/// durdurunca MP4'e aktarılır.
pub fn recording_args(
    target: &CaptureTarget,
    video: &VideoOptions,
    encoder: Encoder,
    audio_pipe: Option<&str>,
    output_mkv: &str,
) -> Vec<String> {
    let mut args = common(target, video, encoder, audio_pipe, false);
    args.extend(["-f".into(), "matroska".into(), output_mkv.into()]);
    args
}

/// Geriye dönük kayıt: 2 saniyelik parçalar halka hâlinde yazılır (en eskinin
/// üzerine), liste dosyası son parçaları sırasıyla tutar.
pub fn replay_args(
    target: &CaptureTarget,
    video: &VideoOptions,
    encoder: Encoder,
    audio_pipe: Option<&str>,
    dir: &str,
    wrap: u32,
) -> Vec<String> {
    let mut args = common(target, video, encoder, audio_pipe, true);
    let sep = if dir.ends_with(['\\', '/']) { "" } else { "\\" };
    args.extend([
        "-f".into(),
        "segment".into(),
        "-segment_time".into(),
        SEGMENT_SECONDS.to_string(),
        "-segment_format".into(),
        "mpegts".into(),
        "-segment_wrap".into(),
        wrap.to_string(),
        "-segment_list".into(),
        format!("{dir}{sep}list.csv"),
        "-segment_list_type".into(),
        "csv".into(),
        // Liste halkadan bir eksik: yazılmakta olan (üzerine yazılan) parça listede olmaz.
        "-segment_list_size".into(),
        wrap.saturating_sub(1).max(1).to_string(),
        "-reset_timestamps".into(),
        "1".into(),
        format!("{dir}{sep}seg%04d.ts"),
    ]);
    args
}

/// Bu yakalama + kodlayıcı bu bilgisayarda çalışıyor mu? (birkaç kare, çıktı yok)
pub fn probe_args(target: &CaptureTarget, encoder: Encoder) -> Vec<String> {
    let video = VideoOptions {
        fps: 30,
        max_height: None,
        quality: Quality::Balanced,
        cursor: false,
        bitrate_kbps: None,
    };
    let mut args: Vec<String> = ["-hide_banner", "-loglevel", "error"]
        .map(String::from)
        .to_vec();
    args.extend(capture_input(target, &video));
    if let Some(filter) = video_filter(target, &video, encoder) {
        args.extend(["-vf".into(), filter]);
    }
    args.extend(encoder_args(encoder, &video));
    // Pencere yakalaması yalnızca içerik değişince kare verir: tek kare yeter.
    args.extend(["-frames:v", "1", "-f", "null", "-"].map(String::from));
    args
}

/// MKV kaydı MP4'e aktarır (yeniden kodlamadan, saniyeler sürer).
pub fn remux_args(input: &str, output: &str) -> Vec<String> {
    [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        input,
        "-map",
        "0",
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        output,
    ]
    .map(String::from)
    .to_vec()
}

/// Anlık tekrar parçalarını tek MP4'te birleştirir.
pub fn concat_args(list_path: &str, output: &str) -> Vec<String> {
    [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        list_path,
        "-map",
        "0:v",
        "-map",
        "0:a?",
        "-c",
        "copy",
        "-bsf:a",
        "aac_adtstoasc",
        "-movflags",
        "+faststart",
        output,
    ]
    .map(String::from)
    .to_vec()
}

/// Kayıtlar sayfasındaki küçük resim.
pub fn thumbnail_args(input: &str, seconds: f64, output: &str) -> Vec<String> {
    vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-y".into(),
        "-ss".into(),
        format!("{seconds:.2}"),
        "-i".into(),
        input.into(),
        "-frames:v".into(),
        "1".into(),
        "-vf".into(),
        "scale=320:-2".into(),
        "-q:v".into(),
        "5".into(),
        output.into(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn monitor(dda: Option<u32>) -> CaptureTarget {
        CaptureTarget::Monitor {
            hmonitor: 65537,
            dda_index: dda,
            width: 2560,
            height: 1440,
        }
    }

    fn video(max_height: Option<u32>) -> VideoOptions {
        VideoOptions {
            fps: 60,
            max_height,
            quality: Quality::Balanced,
            cursor: true,
            bitrate_kbps: None,
        }
    }

    #[test]
    fn ozel_bit_hizi_kalite_on_ayarinin_yerine_gecer() {
        let video = VideoOptions {
            fps: 60,
            max_height: None,
            quality: Quality::Balanced,
            cursor: true,
            bitrate_kbps: Some(12_000),
        };
        let nvenc = encoder_args(Encoder::Nvenc, &video).join(" ");
        assert!(nvenc.contains("-rc cbr"));
        assert!(nvenc.contains("-b:v 12000k -maxrate 12000k -bufsize 24000k"));
        assert!(!nvenc.contains("-cq"));
        let amf = encoder_args(Encoder::Amf, &video).join(" ");
        assert!(amf.contains("-rc cbr") && amf.contains("-b:v 12000k"));
        // Sınır dışı değer kırpılır; GOP yine eklenir.
        let tiny = VideoOptions {
            bitrate_kbps: Some(10),
            ..video
        };
        let x264 = encoder_args(Encoder::X264, &tiny).join(" ");
        assert!(x264.contains("-b:v 1000k") && x264.contains("-g 120"));
    }

    #[test]
    fn cikti_boyutu_en_boyu_koruyup_cift_sayiya_iner() {
        assert_eq!(output_size((2560, 1440), Some(1080)), Some((1920, 1080)));
        assert_eq!(output_size((1920, 1080), Some(1080)), None);
        assert_eq!(output_size((1001, 777), Some(500)), Some((644, 500)));
        assert_eq!(output_size((1920, 1080), None), None);
    }

    #[test]
    fn monitor_ddagrab_ile_nvenc_kareleri_indirmeden_kodlar() {
        let args = recording_args(
            &monitor(Some(1)),
            &video(None),
            Encoder::Nvenc,
            None,
            "k.mkv",
        )
        .join(" ");
        assert!(args.contains("-i ddagrab=output_idx=1:framerate=60:draw_mouse=1"));
        assert!(!args.contains("hwdownload"));
        assert!(args.contains("-c:v h264_nvenc") && args.contains("-g 120"));
        assert!(args.contains("-fps_mode cfr -r 60"));
        assert!(args.ends_with("-f matroska k.mkv"));
        assert!(!args.contains("-map 1:a"));
    }

    #[test]
    fn kucultmede_ve_islemci_kodlayicisinda_kareler_indirilir() {
        let args = recording_args(
            &monitor(Some(0)),
            &video(Some(1080)),
            Encoder::X264,
            None,
            "k.mkv",
        )
        .join(" ");
        assert!(args
            .contains("-vf hwdownload,format=bgra,scale=1920:1080:flags=bilinear,format=yuv420p"));
        assert!(args.contains("-preset superfast"));
    }

    #[test]
    fn pencere_gfxcapture_ile_yakalanir_kucultme_yakalamada() {
        let window = CaptureTarget::Window {
            hwnd: 1234,
            width: 1600,
            height: 1201,
        };
        let args =
            recording_args(&window, &video(Some(720)), Encoder::Nvenc, None, "k.mkv").join(" ");
        assert!(args.contains(
            "gfxcapture=hwnd=1234:max_framerate=60:capture_cursor=1:width=958:height=720:resize_mode=scale_aspect"
        ));
        let native = recording_args(&window, &video(None), Encoder::Nvenc, None, "k.mkv").join(" ");
        assert!(native.contains(":width=-2:height=-2"));
        // ddagrab'ın göremediği monitör de gfxcapture ile.
        let other =
            recording_args(&monitor(None), &video(None), Encoder::Nvenc, None, "k.mkv").join(" ");
        assert!(other.contains("gfxcapture=hmonitor=65537"));
    }

    #[test]
    fn ses_borusu_ikinci_giris_olarak_eslenir() {
        let args = recording_args(
            &monitor(Some(0)),
            &video(None),
            Encoder::Nvenc,
            Some(r"\\.\pipe\dk"),
            "k.mkv",
        )
        .join(" ");
        assert!(args.contains(r"-f f32le -ar 48000 -ac 2 -i \\.\pipe\dk"));
        assert!(args.contains("-map 0:v -map 1:a"));
        assert!(args.contains("-c:a aac"));
    }

    #[test]
    fn geriye_donuk_kayit_halka_parcalar_yazar() {
        let args = replay_args(
            &monitor(Some(0)),
            &video(None),
            Encoder::Nvenc,
            None,
            r"C:\tmp\replay",
            18,
        )
        .join(" ");
        assert!(args.contains("-f segment -segment_time 2 -segment_format mpegts"));
        assert!(args.contains(r"-segment_wrap 18 -segment_list C:\tmp\replay\list.csv"));
        assert!(args.contains("-force_key_frames expr:gte(t,n_forced*2)"));
        assert!(args.ends_with(r"C:\tmp\replay\seg%04d.ts"));
    }

    #[test]
    fn deneme_birkac_kareyi_bosa_kodlar() {
        let args = probe_args(&monitor(Some(0)), Encoder::Qsv).join(" ");
        assert!(args.contains("-vf hwdownload,format=bgra,format=nv12"));
        assert!(args.ends_with("-frames:v 1 -f null -"));
    }
}
