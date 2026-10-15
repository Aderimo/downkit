//! Klip Düzenleyici'nin dışa aktarımı.
//!
//! - Tek kaynak: tek klip kesilir (hızlı kopyalama ya da tam kare), birden çok
//!   klip tek dosyada birleştirilir; istenirse yalnızca ses ya da GIF çıkar.
//! - Birden çok kaynak: klipler tek çıktıda birleştirilir (her zaman yeniden
//!   kodlanır; kaynakların boyutu ve kare hızı farklı olabilir).

use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::process::Command;
use uuid::Uuid;

use crate::error::AppError;
use crate::events::{JobCanceledPayload, JobCompletePayload, JobErrorPayload};
use crate::ffmpeg::edit::{
    self as edit_args, BlurRegion, Clip, ClipOverlay, Frame, GifOptions, ImageOverlay, MusicTrack,
    Streams, TextOverlay, VideoPost, AUDIO_FORMATS,
};
use crate::jobs::{self, FfmpegJob};
use crate::{ffmpeg, paths};

const MAX_CLIPS: usize = 50;
const MIN_CLIP_SECONDS: f64 = 0.1;
const DEFAULT_AUDIO_KBPS: u32 = 192;
const MAX_NAME_CHARS: usize = 150;
const ERROR_MESSAGE: &str = "Dışa aktarma tamamlanamadı. Tekrar deneyin.";

/// Çoklu kaynakta tek girdi: bilgisayardaki dosya.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditInput {
    #[serde(default)]
    pub input_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditRequest {
    /// Tek kaynağın dosya yolu.
    #[serde(default)]
    pub input_path: Option<String>,
    /// Birden çok kaynak: kliplerin `source` alanı bu diziye işaret eder.
    /// Boşsa yukarıdaki tek kaynak alanları kullanılır.
    #[serde(default)]
    pub inputs: Vec<EditInput>,
    /// Çıktıdaki sırayla (zaman sırası olmak zorunda değil).
    pub clips: Vec<Clip>,
    pub destination_dir: String,
    /// Uzantısız çıktı adı.
    pub output_name: String,
    #[serde(default)]
    pub audio_only: bool,
    /// Ses: mp3 | m4a | wav | flac. Çok kaynaklı görüntü: mp4 | mkv | webm.
    #[serde(default)]
    pub output_format: Option<String>,
    #[serde(default)]
    pub audio_bitrate_kbps: Option<u32>,
    /// Yerel tek klipte tam karede kes (yeniden kodlar); false ise kopyalayarak hızlı keser.
    #[serde(default)]
    pub precise: bool,
    /// Duraklat/sürdür boyunca aynı kalan anahtar (arayüzdeki iş kimliği).
    #[serde(default)]
    pub work_key: Option<String>,
    /// Verilirse çıktı sessiz, hareketli bir GIF olur.
    #[serde(default)]
    pub gif: Option<GifOptions>,
    /// Verilirse görüntü bu kareye kırpılır/sığdırılır (ör. dikey 9:16).
    #[serde(default)]
    pub frame: Option<Frame>,
    /// Görüntüye yazılacak yazılar (çıktı zamanıyla).
    #[serde(default)]
    pub texts: Vec<TextOverlay>,
    /// Verilirse çıktı bu boyuta (MB) sığacak bit hızıyla kodlanır (ör. Discord 10 MB).
    #[serde(default)]
    pub target_size_mb: Option<f64>,
    /// Ekran kartı kodlayıcısı: "nvenc" | "amf" | "qsv" (hızlı dışa aktarma).
    #[serde(default)]
    pub gpu_encoder: Option<String>,
    /// Üste bindirilecek resimler (logo, çıkartma).
    #[serde(default)]
    pub images: Vec<ImageOverlay>,
    /// Klip sesiyle karıştırılacak müzik izleri.
    #[serde(default)]
    pub music: Vec<MusicTrack>,
    /// Gizlenecek bölgeler (bulanık ya da pikselli).
    #[serde(default)]
    pub blurs: Vec<BlurRegion>,
    /// Zengin yazılar ve kelime vurgulu altyazılar: arayüzün ürettiği ASS betiği
    /// (libass ile, diğer yazıların üstüne çizilir). Zamanlar çıktı saniyesidir.
    #[serde(default)]
    pub ass_script: Option<String>,
    /// İlerleme çubuğu (videonun ne kadarı geçti).
    #[serde(default)]
    pub progress: Option<edit_args::ProgressBar>,
    /// Üst izden bindirilen dönüşümlü klipler (resim içinde resim).
    #[serde(default)]
    pub overlays: Vec<OverlayRequest>,
    /// Karışımın hedef ses seviyesi (LUFS, ör. sosyal medya için −14).
    #[serde(default)]
    pub loudness: Option<f64>,
}

/// Bindirilen klip: kaynağı `inputs` sırasıyla (tek kaynakta 0), çıktıdaki başlangıcı.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayRequest {
    #[serde(default)]
    pub source: usize,
    pub clip: Clip,
    pub at: f64,
}

/// Bindirmenin kaynağı hakkında bilinenler.
struct OverlaySource<'a> {
    path: &'a str,
    size: Option<(u32, u32)>,
    has_audio: bool,
    duration: Option<f64>,
}

/// Bindirmeleri kaynaklarına bağlar: aralık kaynağın süresine sığdırılır, geçersizler
/// atlanır (en çok 8).
fn resolve_overlays(requests: &[OverlayRequest], sources: &[OverlaySource]) -> Vec<ClipOverlay> {
    requests
        .iter()
        .filter_map(|r| {
            let source = sources.get(r.source)?;
            let limit = source.duration.filter(|d| *d > 0.0).unwrap_or(f64::MAX);
            let clip = Clip {
                source: 0,
                start: r.clip.start.clamp(0.0, limit),
                end: r.clip.end.clamp(0.0, limit),
                speed: r.clip.speed(),
                xfade: None,
                black: false,
                ..r.clip.clone()
            };
            (clip.duration() >= MIN_CLIP_SECONDS && r.at.is_finite() && r.at >= 0.0).then(|| {
                ClipOverlay {
                    path: source.path.to_string(),
                    clip,
                    at: r.at,
                    size: source.size,
                    has_audio: source.has_audio,
                }
            })
        })
        .take(8)
        .collect()
}

/// Yalnızca bilgisayardaki gerçek ses dosyaları kabul edilir (en çok 10 iz).
/// Hedef ses seviyesi yalnızca makul aralıkta (−24…−9 LUFS) kabul edilir.
fn valid_loudness(lufs: Option<f64>) -> Option<f64> {
    lufs.filter(|v| v.is_finite() && (-24.0..=-9.0).contains(v))
}

fn valid_music(tracks: &[MusicTrack]) -> Vec<MusicTrack> {
    tracks
        .iter()
        .filter(|track| {
            let path = Path::new(&track.path);
            let ext = path
                .extension()
                .map(|e| e.to_string_lossy().to_ascii_lowercase())
                .unwrap_or_default();
            matches!(
                ext.as_str(),
                "mp3" | "m4a" | "aac" | "wav" | "flac" | "ogg" | "opus" | "wma"
            ) && path.is_file()
                && track.length.is_finite()
                && track.length > 0.05
        })
        .take(10)
        .cloned()
        .collect()
}

/// Yalnızca bilgisayardaki gerçek resim dosyaları kabul edilir (en çok 10 tane).
fn valid_images(images: &[ImageOverlay]) -> Vec<ImageOverlay> {
    images
        .iter()
        .filter(|image| {
            let path = Path::new(&image.path);
            let ext = path
                .extension()
                .map(|e| e.to_string_lossy().to_ascii_lowercase())
                .unwrap_or_default();
            matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp" | "webm") && path.is_file()
        })
        .take(10)
        .cloned()
        .collect()
}

/// Hedef boyuta sığacak görüntü bit hızı (kbps): sesin 128 kbps'ı ve kap için
/// %8 pay düşülür.
fn target_kbps(size_mb: Option<f64>, seconds: f64) -> Option<u32> {
    let size = size_mb.filter(|s| s.is_finite() && *s > 0.5)?;
    if seconds <= 0.1 {
        return None;
    }
    let total = size * 8192.0 * 0.92 / seconds;
    Some((total - 128.0).max(150.0) as u32)
}

fn gpu_name(requested: Option<&str>) -> Option<String> {
    requested
        .filter(|g| matches!(*g, "nvenc" | "amf" | "qsv"))
        .map(str::to_string)
}

/// Windows yazı tipi: kalın/normal Segoe UI, yoksa Arial.
fn font_file(bold: bool) -> Option<PathBuf> {
    let fonts = PathBuf::from(std::env::var("WINDIR").unwrap_or_else(|_| r"C:\Windows".into()))
        .join("Fonts");
    let names: &[&str] = if bold {
        &["segoeuib.ttf", "arialbd.ttf", "segoeui.ttf", "arial.ttf"]
    } else {
        &["segoeui.ttf", "arial.ttf"]
    };
    names.iter().map(|n| fonts.join(n)).find(|p| p.exists())
}

/// Yazıları dosyaya yazıp drawtext filtrelerini kurar (dosya adı içeriğin özeti:
/// aynı yazı yeniden yazılmaz).
async fn text_filters(app: &AppHandle, texts: &[TextOverlay]) -> Result<Vec<String>, AppError> {
    use std::hash::{Hash, Hasher};
    if texts.is_empty() {
        return Ok(Vec::new());
    }
    let dir = paths::cache_dir(app, "edit-text")?;
    let mut filters = Vec::new();
    for overlay in texts {
        let Some(font) = font_file(overlay.bold) else {
            continue;
        };
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        overlay.text.hash(&mut hasher);
        let file = dir.join(format!("{:016x}.txt", hasher.finish()));
        if !file.exists() {
            tokio::fs::write(&file, overlay.text.as_bytes())
                .await
                .map_err(|e| AppError::new(ERROR_MESSAGE, Some(e.to_string())))?;
        }
        if let Some(filter) =
            edit_args::drawtext_filter(overlay, &file.to_string_lossy(), &font.to_string_lossy())
        {
            filters.push(filter);
        }
    }
    Ok(filters)
}

/// ASS betiği en fazla bu kadar (çok uzun videoda bile birkaç yüz KB).
const MAX_ASS_BYTES: usize = 8 * 1024 * 1024;

/// ASS betiğini dosyaya yazıp `subtitles` filtresini kurar (dosya adı içeriğin özeti).
async fn caption_filter(app: &AppHandle, script: Option<&str>) -> Result<Option<String>, AppError> {
    use std::hash::{Hash, Hasher};
    let Some(script) = script.filter(|s| !s.trim().is_empty()) else {
        return Ok(None);
    };
    if script.len() > MAX_ASS_BYTES || !script.starts_with("[Script Info]") {
        return Ok(None);
    }
    let dir = paths::cache_dir(app, "edit-captions")?;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    script.hash(&mut hasher);
    let file = dir.join(format!("{:016x}.ass", hasher.finish()));
    if !file.exists() {
        tokio::fs::write(&file, script.as_bytes())
            .await
            .map_err(|e| AppError::new(ERROR_MESSAGE, Some(e.to_string())))?;
    }
    Ok(Some(edit_args::subtitles_filter(&file.to_string_lossy())))
}

/// Yazıların tüm filtreleri: önce drawtext yazıları, en üstte ASS altyazıları.
async fn all_text_filters(app: &AppHandle, request: &EditRequest) -> Result<Vec<String>, AppError> {
    let mut filters = text_filters(app, &request.texts).await?;
    if let Some(filter) = caption_filter(app, request.ass_script.as_deref()).await? {
        filters.push(filter);
    }
    Ok(filters)
}

/// İş klasörü adı: yalnızca harf, rakam ve tire (yol dışına çıkılamasın).
fn work_dir_name(key: Option<&str>, job_id: &str) -> String {
    key.filter(|k| {
        (1..=64).contains(&k.len()) && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    })
    .unwrap_or(job_id)
    .to_string()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EditProgressPayload {
    job_id: String,
    percent: Option<f64>,
    /// "merging"
    stage: &'static str,
}

/// Klipleri kendi kaynağının süresine sığdırır, çok kısa olanları atar.
/// `durations[i]`: i. kaynağın süresi; bilinmiyorsa None.
fn normalize_clips(clips: &[Clip], durations: &[Option<f64>]) -> Result<Vec<Clip>, AppError> {
    if clips.len() > MAX_CLIPS {
        return Err(AppError::coded(
            "tooManyClips",
            "Tek seferde en fazla 50 klip dışa aktarılabilir.",
            None,
        ));
    }
    let fallback = durations.first().copied().flatten();
    let normalized: Vec<Clip> = clips
        .iter()
        .filter(|c| c.start.is_finite() && c.end.is_finite())
        .map(|c| {
            let limit = match durations.get(c.source) {
                // Kaynağın süresi biliniyor: ona sığdır.
                Some(&Some(d)) if d > 0.0 => d,
                // Süresi okunamayan kaynak: kısıt yok.
                Some(_) => f64::MAX,
                // Aralık dışı kaynak işareti: ilk kaynağa düş.
                None => fallback.filter(|d| *d > 0.0).unwrap_or(f64::MAX),
            };
            Clip {
                start: c.start.clamp(0.0, limit),
                end: c.end.clamp(0.0, limit),
                speed: c.speed(),
                ..c.clone()
            }
        })
        .filter(|c| c.duration() >= MIN_CLIP_SECONDS)
        .collect();
    if normalized.is_empty() {
        return Err(AppError::coded(
            "invalidRange",
            "Bitiş zamanı başlangıçtan sonra olmalı.",
            None,
        ));
    }
    Ok(normalized)
}

/// Kullanıcının yazdığı adı Windows dosya adına uygun hale getirir.
pub(crate) fn sanitize_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_control() || r#"<>:"/\|?*"#.contains(c) {
                ' '
            } else {
                c
            }
        })
        .collect();
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed: String = collapsed
        .trim_matches(|c: char| c == '.' || c == ' ')
        .chars()
        .take(MAX_NAME_CHARS)
        .collect();
    let trimmed = trimmed.trim_end_matches(['.', ' ']).to_string();
    // Windows'un ayrılmış aygıt adları dosya adı olamaz.
    let reserved = ["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "LPT1", "LPT2"];
    if trimmed.is_empty() || reserved.contains(&trimmed.to_ascii_uppercase().as_str()) {
        "klip".to_string()
    } else {
        trimmed
    }
}

/// Yalnızca ses çıktısında kullanılacak biçim: istenen, yoksa kaynağınki, yoksa m4a.
fn audio_format<'a>(requested: Option<&'a str>, container: &'a str) -> &'a str {
    requested
        .filter(|f| AUDIO_FORMATS.contains(f))
        .or_else(|| AUDIO_FORMATS.contains(&container).then_some(container))
        .unwrap_or("m4a")
}

#[tauri::command]
pub async fn start_edit(app: AppHandle, request: EditRequest) -> Result<String, AppError> {
    // Etkin girdi listesi: çoklu kaynak `inputs`'tan, yoksa eski tek kaynak alanlarından.
    let inputs: Vec<EditInput> = if !request.inputs.is_empty() {
        request.inputs.clone()
    } else {
        request
            .input_path
            .iter()
            .map(|path| EditInput {
                input_path: Some(path.clone()),
            })
            .collect()
    };
    match inputs.as_slice() {
        [] => Err(AppError::new("Kaynak seçilmedi.", None)),
        [one] => match &one.input_path {
            Some(path) => start_local(&app, &request, path).await,
            None => Err(AppError::new("Kaynak seçilmedi.", None)),
        },
        many => start_multi(&app, &request, many).await,
    }
}

/// `discard`: İptal'de true (yarım çıktı silinir), Duraklat'ta false.
#[tauri::command]
pub async fn cancel_edit(
    app: AppHandle,
    job_id: String,
    discard: Option<bool>,
) -> Result<(), AppError> {
    jobs::cancel(&app, &job_id, discard.unwrap_or(true)).await;
    Ok(())
}

/// Duraklatılmış bir dışa aktarım iptal edilince iş klasörünü siler.
#[tauri::command]
pub async fn discard_edit_work(app: AppHandle, work_key: String) -> Result<(), AppError> {
    let name = work_dir_name(Some(&work_key), "");
    if !name.is_empty() {
        let _ = tokio::fs::remove_dir_all(paths::cache_dir(&app, "edit")?.join(name)).await;
    }
    Ok(())
}

async fn start_local(
    app: &AppHandle,
    request: &EditRequest,
    path: &str,
) -> Result<String, AppError> {
    let ffmpeg_dir = ffmpeg::binary::ensure_ffmpeg(app).await?;
    let info = ffmpeg::convert::probe_file(&ffmpeg_dir, path).await?;
    let clips = normalize_clips(&request.clips, &[info.duration_seconds])?;
    let streams = Streams {
        video: info.video_codec.is_some(),
        audio: info.audio_codec.is_some(),
    };
    let overlays = resolve_overlays(
        &request.overlays,
        &[OverlaySource {
            path,
            size: info.width.zip(info.height),
            has_audio: streams.audio,
            duration: info.duration_seconds,
        }],
    );
    if let Some(gif) = request.gif {
        if !streams.video {
            return Err(AppError::coded(
                "noVideo",
                "Bu dosyada görüntü yok; GIF yapılamaz.",
                None,
            ));
        }
        let size = info.width.zip(info.height);
        return start_local_gif(app, request, path, &ffmpeg_dir, &clips, gif, size, overlays).await;
    }
    // Klipler arası geçişler: kesimin iki yanına kaynak payı eklenir.
    let mut clips = clips;
    let limit = info
        .duration_seconds
        .filter(|d| *d > 0.0)
        .unwrap_or(f64::MAX);
    edit_args::apply_xfade_handles(&mut clips, |_| limit);
    let audio_only = request.audio_only || !streams.video;
    if audio_only && !streams.audio {
        return Err(AppError::coded("noAudio", "Bu dosyada ses yok.", None));
    }
    let kbps = request.audio_bitrate_kbps.unwrap_or(DEFAULT_AUDIO_KBPS);
    let format = audio_format(request.output_format.as_deref(), &info.container);
    // Hızı değişen klip her zaman yeniden kodlanır (kopyalayarak hızlandırılamaz).
    // Hız, ses düzeyi ya da geçiş olan klip her zaman yeniden kodlanır.
    let size = info.width.zip(info.height);
    let post = VideoPost {
        frame: request.frame.clone(),
        texts: all_text_filters(app, request).await?,
        fx_size: size,
        fps: info
            .fps
            .filter(|f| f.is_finite() && *f > 0.0)
            .map(|f| f.round() as u32),
        video_kbps: target_kbps(request.target_size_mb, edit_args::joined_seconds(&clips)),
        gpu: gpu_name(request.gpu_encoder.as_deref()),
        images: valid_images(&request.images),
        music: valid_music(&request.music),
        blurs: request.blurs.iter().take(20).cloned().collect(),
        progress: request
            .progress
            .map(|bar| (bar, edit_args::joined_seconds(&clips))),
        overlays,
        loudness: valid_loudness(request.loudness),
    };
    let single = clips.len() == 1 && !clips[0].has_effects() && post.is_empty();

    let extension = if audio_only {
        format.to_string()
    } else if single && !request.precise && !info.container.is_empty() {
        info.container.clone()
    } else {
        "mp4".to_string()
    };
    let final_path = jobs::unique_output_path(
        Path::new(&request.destination_dir),
        &sanitize_name(&request.output_name),
        &extension,
    );
    // FFmpeg geçici dosyaya yazar; bitince asıl adına taşınır.
    let output = jobs::temp_output_path(&final_path)
        .to_string_lossy()
        .into_owned();

    let build = |post: &VideoPost| match (audio_only, single) {
        (true, true) => {
            edit_args::extract_audio_args(path, &output, clips[0].clone(), format, kbps)
        }
        (true, false) => edit_args::merge_args(
            path,
            &output,
            &clips,
            streams,
            Some((format, kbps)),
            // Yalnızca ses çıkarken de müzik ve bindirilen kliplerin sesi karışır.
            &VideoPost {
                music: post.music.clone(),
                overlays: post.overlays.clone(),
                loudness: post.loudness,
                ..VideoPost::default()
            },
        ),
        (false, true) => {
            ffmpeg::trim::build_args(path, &output, clips[0].start, clips[0].end, request.precise)
        }
        (false, false) => edit_args::merge_args(path, &output, &clips, streams, None, post),
    };
    let args = build(&post);
    // Ekran kartı kodlaması açılamazsa (sürücü, desteklenmeyen kart) işlemciyle yeniden denenir.
    let fallback_args = (post.gpu.is_some() && !audio_only && !single).then(|| {
        build(&VideoPost {
            gpu: None,
            ..post.clone()
        })
    });

    jobs::spawn_ffmpeg(
        app,
        &ffmpeg_dir.join("ffmpeg.exe"),
        args,
        FfmpegJob {
            event_prefix: "edit",
            error_code: "editFailed",
            error_message: ERROR_MESSAGE,
            duration_seconds: Some(edit_args::joined_seconds(&clips)),
            output_path: output.clone(),
            final_path: Some(final_path.to_string_lossy().into_owned()),
            input_size_bytes: None,
            fallback_args,
        },
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn start_local_gif(
    app: &AppHandle,
    request: &EditRequest,
    path: &str,
    ffmpeg_dir: &Path,
    clips: &[Clip],
    gif: GifOptions,
    size: Option<(u32, u32)>,
    overlays: Vec<ClipOverlay>,
) -> Result<String, AppError> {
    let final_path = jobs::unique_output_path(
        Path::new(&request.destination_dir),
        &sanitize_name(&request.output_name),
        "gif",
    );
    let output = jobs::temp_output_path(&final_path)
        .to_string_lossy()
        .into_owned();
    // Gizleme bölgeleri GIF'te de uygulanır (gizlenen bilgi açığa çıkmasın); logo ve
    // emoji bindirmeleri de görünür.
    let post = VideoPost {
        frame: request.frame.clone(),
        texts: all_text_filters(app, request).await?,
        fx_size: size,
        images: valid_images(&request.images),
        blurs: request.blurs.iter().take(20).cloned().collect(),
        progress: request
            .progress
            .map(|bar| (bar, edit_args::joined_seconds(clips))),
        overlays,
        ..VideoPost::default()
    };
    let inputs: Vec<edit_args::MergeInput> = clips
        .iter()
        .map(|c| edit_args::MergeInput {
            path,
            range: Some(c.input_range()),
            clip: c.clone(),
        })
        .collect();
    jobs::spawn_ffmpeg(
        app,
        &ffmpeg_dir.join("ffmpeg.exe"),
        edit_args::gif_args(&inputs, &output, gif, &post),
        FfmpegJob {
            event_prefix: "edit",
            error_code: "editFailed",
            error_message: ERROR_MESSAGE,
            duration_seconds: Some(clips.iter().map(Clip::output_duration).sum()),
            output_path: output,
            final_path: Some(final_path.to_string_lossy().into_owned()),
            input_size_bytes: None,
            fallback_args: None,
        },
    )
    .await
}

/// Birden çok dosyayı tek çıktıda birleştirir. Kaynaklar farklı boyut, kare
/// hızı ya da ses biçiminde olabileceğinden çıktı her zaman yeniden kodlanır
/// (`merge_inputs_args`'ın normalize zinciriyle).
async fn start_multi(
    app: &AppHandle,
    request: &EditRequest,
    inputs: &[EditInput],
) -> Result<String, AppError> {
    if request.gif.is_some() {
        return Err(AppError::coded(
            "multiGif",
            "Birden çok kaynak birleştirilirken GIF yapılamaz; GIF için tek kaynak kullanın.",
            None,
        ));
    }
    let ffmpeg_dir = ffmpeg::binary::ensure_ffmpeg(app).await?;
    // Her klip kendi kaynağının süresine sığdırılır.
    let mut durations: Vec<Option<f64>> = Vec::with_capacity(inputs.len());
    let mut paths: Vec<String> = Vec::with_capacity(inputs.len());
    let mut infos = Vec::with_capacity(inputs.len());
    for input in inputs {
        let Some(path) = &input.input_path else {
            return Err(AppError::new("Kaynak seçilmedi.", None));
        };
        let info = ffmpeg::convert::probe_file(&ffmpeg_dir, path).await?;
        durations.push(info.duration_seconds);
        paths.push(path.clone());
        infos.push(info);
    }
    let overlay_sources: Vec<OverlaySource> = paths
        .iter()
        .zip(&infos)
        .map(|(path, info)| OverlaySource {
            path,
            size: info.width.zip(info.height),
            has_audio: info.audio_codec.is_some(),
            duration: info.duration_seconds,
        })
        .collect();
    let overlays = resolve_overlays(&request.overlays, &overlay_sources);
    let mut clips = normalize_clips(&request.clips, &durations)?;
    edit_args::apply_xfade_handles(&mut clips, |c| {
        durations
            .get(c.source)
            .copied()
            .flatten()
            .filter(|d| *d > 0.0)
            .unwrap_or(f64::MAX)
    });
    let output_seconds = edit_args::joined_seconds(&clips);

    let job_id = Uuid::new_v4().to_string();
    let work_dir =
        paths::cache_dir(app, "edit")?.join(work_dir_name(request.work_key.as_deref(), &job_id));
    tokio::fs::create_dir_all(&work_dir)
        .await
        .map_err(|e| AppError::new(ERROR_MESSAGE, Some(e.to_string())))?;

    let audio_only = request.audio_only;
    let job = MultiEdit {
        work_dir,
        destination_dir: PathBuf::from(&request.destination_dir),
        output_name: sanitize_name(&request.output_name),
        ffmpeg_dir,
        clips,
        sources: paths,
        audio_only,
        output_format: request.output_format.clone(),
        audio_bitrate_kbps: request.audio_bitrate_kbps.unwrap_or(DEFAULT_AUDIO_KBPS),
        post: if audio_only {
            VideoPost {
                music: valid_music(&request.music),
                overlays,
                loudness: valid_loudness(request.loudness),
                ..VideoPost::default()
            }
        } else {
            VideoPost {
                frame: request.frame.clone(),
                texts: all_text_filters(app, request).await?,
                // Çok kaynakta boyut ve kare hızı birleştirmedeki ortak değerlerden gelir.
                fx_size: None,
                fps: None,
                video_kbps: target_kbps(request.target_size_mb, output_seconds),
                gpu: gpu_name(request.gpu_encoder.as_deref()),
                images: valid_images(&request.images),
                music: valid_music(&request.music),
                blurs: request.blurs.iter().take(20).cloned().collect(),
                progress: request.progress.map(|bar| (bar, output_seconds)),
                overlays,
                loudness: valid_loudness(request.loudness),
            }
        },
    };
    let (app_for_task, job_id_for_task) = (app.clone(), job_id.clone());
    tauri::async_runtime::spawn(async move {
        run_multi_edit(app_for_task, job_id_for_task, job).await;
    });
    Ok(job_id)
}

struct MultiEdit {
    work_dir: PathBuf,
    destination_dir: PathBuf,
    output_name: String,
    ffmpeg_dir: PathBuf,
    clips: Vec<Clip>,
    /// Kaynak dosyaların yolları; kliplerin `source` alanı bu sıraya işaret eder.
    sources: Vec<String>,
    audio_only: bool,
    output_format: Option<String>,
    audio_bitrate_kbps: u32,
    post: VideoPost,
}

async fn run_multi_edit(app: AppHandle, job_id: String, mut job: MultiEdit) {
    let result = run_multi_inner(&app, &job_id, &mut job).await;
    let finished = jobs::finish(&app, &job_id);
    let paused = finished.canceled && !finished.discard_partial;
    if !paused {
        let _ = tokio::fs::remove_dir_all(&job.work_dir).await;
    }
    if finished.canceled {
        if let Ok(path) = &result {
            let _ = tokio::fs::remove_file(path).await;
        }
        emit_canceled(&app, job_id);
        return;
    }
    match result {
        Ok(path) => {
            let size = tokio::fs::metadata(&path)
                .await
                .map(|m| m.len())
                .unwrap_or(0);
            let _ = app.emit(
                "edit-complete",
                JobCompletePayload {
                    job_id,
                    file_path: path.to_string_lossy().into_owned(),
                    file_size_bytes: size,
                    notice: None,
                },
            );
        }
        Err(MergeFailure::Friendly { code, message }) => {
            emit_error(&app, job_id, code, message, String::new());
        }
        Err(MergeFailure::Merge(detail)) => {
            emit_error(&app, job_id, "editFailed", ERROR_MESSAGE, detail);
        }
    }
}

async fn run_multi_inner(
    app: &AppHandle,
    job_id: &str,
    job: &mut MultiEdit,
) -> Result<PathBuf, MergeFailure> {
    // Kliplerin kullandığı kaynaklar.
    let mut used = vec![false; job.sources.len()];
    for clip in &job.clips {
        if !clip.black {
            if let Some(slot) = used.get_mut(clip.source) {
                *slot = true;
            }
        }
    }

    // 1) Her kaynağın akışları ölçülür: görüntü/ses birleştirilebilir mi?
    let mut audio_states: Vec<bool> = Vec::new();
    let mut target: Option<(u32, u32)> = None;
    for (source, in_use) in job.sources.iter().zip(used.iter()) {
        if !in_use {
            continue;
        }
        let info = ffmpeg::convert::probe_file(&job.ffmpeg_dir, source)
            .await
            .map_err(|e| MergeFailure::Merge(e.message))?;
        if !job.audio_only && info.video_codec.is_none() {
            return Err(MergeFailure::Friendly {
                code: "multiNoVideo",
                message: "Kaynaklardan birinde görüntü yok; birlikte dışa aktarılamaz.",
            });
        }
        audio_states.push(info.audio_codec.is_some());
        if target.is_none() {
            if let (Some(w), Some(h)) = (info.width, info.height) {
                target = Some((w, h));
            }
        }
    }
    let audio = if audio_states.iter().all(|a| *a) {
        !audio_states.is_empty()
    } else if audio_states.iter().all(|a| !*a) {
        if job.audio_only {
            return Err(MergeFailure::Friendly {
                code: "multiNoAudio",
                message: "Kaynaklarda ses yok; ses dosyası üretilemez.",
            });
        }
        false
    } else {
        return Err(MergeFailure::Friendly {
            code: "multiNoAudio",
            message: "Kaynaklardan birinde ses yok; birlikte dışa aktarılamaz.",
        });
    };
    let video = !job.audio_only;

    // 2) Birleştirme girişleri: klip kendi dosyasından kesilir; siyah boşluk o
    //    kaynağın küçük bir diliminden üretilir.
    let mut merge_inputs: Vec<edit_args::MergeInput> = Vec::new();
    for clip in &job.clips {
        let s = clip.source.min(job.sources.len().saturating_sub(1));
        let Some(path) = job.sources.get(s).map(String::as_str) else {
            continue;
        };
        merge_inputs.push(edit_args::MergeInput {
            path,
            range: Some(clip.input_range()),
            clip: clip.clone(),
        });
    }

    // 3) Çıktı: ses işi istenen/yedek ses biçimi, görüntü işi mp4|mkv|webm.
    let extension = if !video {
        audio_format(job.output_format.as_deref(), "m4a").to_string()
    } else {
        match job.output_format.as_deref() {
            Some("mkv") => "mkv".to_string(),
            Some("webm") => "webm".to_string(),
            _ => "mp4".to_string(),
        }
    };
    tokio::fs::create_dir_all(&job.destination_dir)
        .await
        .map_err(|e| MergeFailure::Merge(e.to_string()))?;
    let final_path = jobs::unique_output_path(&job.destination_dir, &job.output_name, &extension);
    let output = jobs::temp_output_path(&final_path);

    let _ = app.emit(
        "edit-progress",
        EditProgressPayload {
            job_id: job_id.to_string(),
            percent: None,
            stage: "merging",
        },
    );
    let output_text = output.to_string_lossy().into_owned();
    let audio_format_arg = (!video).then_some((extension.as_str(), job.audio_bitrate_kbps));
    let post = if video {
        job.post.clone()
    } else {
        VideoPost {
            music: job.post.music.clone(),
            overlays: job.post.overlays.clone(),
            ..VideoPost::default()
        }
    };
    let build = |post: &VideoPost| {
        edit_args::merge_inputs_args(
            &merge_inputs,
            &output_text,
            Streams { video, audio },
            if video { target } else { None },
            audio,
            audio_format_arg,
            post,
        )
    };
    let mut result =
        run_merge_child(app, job_id, &job.ffmpeg_dir, build(&post), &output, true).await;
    // Ekran kartı kodlaması açılamadıysa işlemciyle bir kez daha.
    if result.is_err() && post.gpu.is_some() && !jobs::is_canceled(app, job_id) {
        let cpu = VideoPost {
            gpu: None,
            ..post.clone()
        };
        result = run_merge_child(app, job_id, &job.ffmpeg_dir, build(&cpu), &output, false).await;
    }
    result?;
    jobs::promote_output(&output, &final_path).map_err(|e| {
        let _ = std::fs::remove_file(&output);
        MergeFailure::Merge(e.to_string())
    })
}

/// Birleştirme sürecini çalıştırır; başarısızsa yarım dosyayı siler ve hata kuyruğunu döner.
/// `first`: ilk denemede iş kaydı açılır, yeniden denemede yalnızca süreç kimliği güncellenir.
async fn run_merge_child(
    app: &AppHandle,
    job_id: &str,
    ffmpeg_dir: &Path,
    args: Vec<String>,
    output: &Path,
    first: bool,
) -> Result<(), MergeFailure> {
    let mut command = Command::new(ffmpeg_dir.join("ffmpeg.exe"));
    command
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    jobs::hide_console(&mut command);
    let child = command
        .spawn()
        .map_err(|e| MergeFailure::Merge(e.to_string()))?;
    if let Some(pid) = child.id() {
        if first {
            jobs::register(app, job_id, pid);
        } else {
            jobs::replace_pid(app, job_id, pid).await;
        }
    }
    match child.wait_with_output().await {
        Ok(out) if out.status.success() => Ok(()),
        Ok(out) => {
            let _ = tokio::fs::remove_file(output).await;
            let stderr = String::from_utf8_lossy(&out.stderr);
            let tail: String = stderr
                .chars()
                .rev()
                .take(4000)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
            Err(MergeFailure::Merge(tail))
        }
        Err(e) => {
            let _ = tokio::fs::remove_file(output).await;
            Err(MergeFailure::Merge(e.to_string()))
        }
    }
}

fn emit_error(app: &AppHandle, job_id: String, code: &'static str, message: &str, detail: String) {
    let _ = app.emit(
        "edit-error",
        JobErrorPayload {
            job_id,
            message: message.to_string(),
            raw_detail: Some(detail),
            code: Some(code),
        },
    );
}

fn emit_canceled(app: &AppHandle, job_id: String) {
    let _ = app.emit(
        "edit-canceled",
        JobCanceledPayload {
            job_id,
            partial_target: None,
        },
    );
}

enum MergeFailure {
    /// Kullanıcıya kendi dilinde gösterilecek hata (kod + ileti).
    Friendly {
        code: &'static str,
        message: &'static str,
    },
    Merge(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clip(start: f64, end: f64) -> Clip {
        Clip::new(start, end)
    }

    #[test]
    fn klipler_sureye_sigdirilir_kisalar_atilir() {
        let clips = [clip(-5.0, 10.0), clip(50.0, 50.05), clip(95.0, 200.0)];
        let out = normalize_clips(&clips, &[Some(100.0)]).unwrap();
        assert_eq!(out, vec![clip(0.0, 10.0), clip(95.0, 100.0)]);
    }

    #[test]
    fn her_klip_kendi_kaynaginin_suresine_sigdirilir() {
        let second = Clip {
            source: 1,
            ..clip(40.0, 200.0)
        };
        let clips = [clip(0.0, 500.0), second.clone()];
        // 1. kaynak 100 sn, 2. kaynak 60 sn: her klip kendi kaynağına göre kesilir.
        let out = normalize_clips(&clips, &[Some(100.0), Some(60.0)]).unwrap();
        assert_eq!(
            out,
            vec![
                clip(0.0, 100.0),
                Clip {
                    source: 1,
                    ..clip(40.0, 60.0)
                }
            ]
        );
        // Süresi okunamayan kaynak kısıtlanmaz.
        let out = normalize_clips(&clips, &[Some(100.0), None]).unwrap();
        assert_eq!(out, vec![clip(0.0, 100.0), second]);
    }

    #[test]
    fn gecerli_klip_yoksa_hata_verir() {
        let err = normalize_clips(&[clip(10.0, 5.0)], &[None]).unwrap_err();
        assert_eq!(err.code, Some("invalidRange"));
        let many = vec![clip(0.0, 1.0); MAX_CLIPS + 1];
        assert_eq!(
            normalize_clips(&many, &[None]).unwrap_err().code,
            Some("tooManyClips")
        );
    }

    #[test]
    fn hedef_boyut_bit_hizina_cevrilir() {
        // 10 MB, 60 sn: (10·8192·0,92/60) − 128 ≈ 1128 kbps.
        assert_eq!(target_kbps(Some(10.0), 60.0), Some(1128));
        assert_eq!(target_kbps(Some(10.0), 3600.0), Some(150));
        assert_eq!(target_kbps(None, 60.0), None);
        assert_eq!(gpu_name(Some("nvenc")).as_deref(), Some("nvenc"));
        assert_eq!(gpu_name(Some("x264; rm")), None);
    }

    #[test]
    fn dosya_adi_windowsa_uygun_hale_gelir() {
        assert_eq!(sanitize_name("Maç: özet / 2. yarı?"), "Maç özet 2. yarı");
        assert_eq!(sanitize_name("  ...  "), "klip");
        assert_eq!(sanitize_name("con"), "klip");
        assert_eq!(sanitize_name("son."), "son");
        assert_eq!(
            sanitize_name(&"a".repeat(300)).chars().count(),
            MAX_NAME_CHARS
        );
    }

    #[test]
    fn ses_bicimi_istek_kaynak_ve_varsayilan_sirasiyla_secilir() {
        assert_eq!(audio_format(Some("mp3"), "mp4"), "mp3");
        assert_eq!(audio_format(Some("mp4"), "flac"), "flac");
        assert_eq!(audio_format(None, "mkv"), "m4a");
    }

    #[test]
    fn is_klasoru_adi_yol_disina_cikamaz() {
        assert_eq!(work_dir_name(Some("a1b2-c3"), "yedek"), "a1b2-c3");
        assert_eq!(work_dir_name(Some("../../Windows"), "yedek"), "yedek");
        assert_eq!(work_dir_name(Some(""), "yedek"), "yedek");
        assert_eq!(work_dir_name(None, "yedek"), "yedek");
    }
}

/// Kapak görseli: imleçteki kare, dışa aktarmanın düzeniyle ve başlık yazısıyla.
/// Resimler\DownKit'e (Ekran Görüntüsü kitaplığı) kaydedilir; dosya yolu döner.
#[tauri::command]
pub async fn editor_cover(
    app: AppHandle,
    path: String,
    seconds: f64,
    frame: Option<edit_args::Frame>,
    ass_script: Option<String>,
    name: String,
) -> Result<String, AppError> {
    if !Path::new(&path).is_file() {
        return Err(AppError::new("Dosya bulunamadı.", Some(path)));
    }
    let ffmpeg_dir = ffmpeg::binary::ensure_ffmpeg(&app).await?;
    let dir = PathBuf::from(crate::snip::snip_default_dir(app.clone())?);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| AppError::new("Klasör oluşturulamadı.", Some(e.to_string())))?;
    let output = jobs::unique_output_path(&dir, &sanitize_name(&name), "jpg");
    let mut steps: Vec<String> = frame.iter().map(edit_args::Frame::filter).collect();
    if let Some(sub) = caption_filter(&app, ass_script.as_deref()).await? {
        steps.push(sub);
    }
    let filter = steps.join(",");
    let mut command = Command::new(ffmpeg_dir.join("ffmpeg.exe"));
    command
        .args(edit_args::cover_args(
            &path,
            seconds,
            Some(filter.as_str()),
            &output.to_string_lossy(),
        ))
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    jobs::hide_console(&mut command);
    let result = tokio::time::timeout(std::time::Duration::from_secs(40), command.output())
        .await
        .map_err(|_| AppError::new("Kapak çok uzun sürdü.", None))?
        .map_err(|e| AppError::new("Kapak kaydedilemedi.", Some(e.to_string())))?;
    if !result.status.success() || !output.is_file() {
        return Err(AppError::new(
            "Kapak kaydedilemedi.",
            Some(
                String::from_utf8_lossy(&result.stderr)
                    .chars()
                    .take(400)
                    .collect(),
            ),
        ));
    }
    Ok(output.to_string_lossy().into_owned())
}
