use std::path::PathBuf;
use std::process::Stdio;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::{AppHandle, Emitter};
use tokio::io::BufReader;
use tokio::process::Command;
use uuid::Uuid;

use crate::error::AppError;
use crate::events::{
    DownloadProgressPayload, JobCanceledPayload, JobCompletePayload, JobErrorPayload,
};
use crate::jobs;
use crate::template::translate_filename_template;
use crate::{ffmpeg, ytdlp};

const PROGRESS_PREFIX: &str = "[dk-progress]";
const FILE_PREFIX: &str = "[dk-file]";
const TARGET_PREFIX: &str = "[dk-target]";
const PROGRESS_INTERVAL: Duration = Duration::from_millis(250);
const DEFAULT_AUDIO_KBPS: u32 = 192;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub url: String,
    pub destination_dir: String,
    pub filename_template: String,
    #[serde(default)]
    pub audio_only: bool,
    pub max_height: Option<u32>,
    pub format_id: Option<String>,
    /// mp4 | mkv | webm | mov | avi | mp3 | m4a | wav | aac | flac
    #[serde(default)]
    pub output_format: Option<String>,
    #[serde(default)]
    pub audio_bitrate_kbps: Option<u32>,
    #[serde(default)]
    pub subtitles: bool,
    /// Altyazı dilleri (ör. ["tr", "en"]). Boşsa Türkçe + İngilizce.
    #[serde(default)]
    pub subtitle_langs: Vec<String>,
    /// Otomatik (makine) altyazıları da dahil et. YouTube'un otomatik çevirileri
    /// sık sık 429 ile kısıtlandığı için kapatılabilir.
    #[serde(default = "default_true")]
    pub auto_subtitles: bool,
    /// İndirme hızı sınırı (KB/s); None = sınırsız.
    #[serde(default)]
    pub rate_limit_kbps: Option<u32>,
    /// Videonun yalnızca bu aralığı indirilir (saniye). 1 saatlik bir videodan
    /// 2 dakikalık sahneyi almak için tamamını indirmeye gerek kalmaz.
    #[serde(default)]
    pub section_start: Option<f64>,
    #[serde(default)]
    pub section_end: Option<f64>,
}

/// Geçerli bir bölüm seçildiyse (başlangıç < bitiş) aralığı döner.
fn section_range(request: &DownloadRequest) -> Option<(f64, f64)> {
    match (request.section_start, request.section_end) {
        (Some(start), Some(end)) if start >= 0.0 && end - start >= 0.1 => Some((start, end)),
        _ => None,
    }
}

fn default_true() -> bool {
    true
}

/// Dil kodu yalnızca harf/rakam/tire olabilir ("tr", "en", "pt-BR", "zh-Hans");
/// yt-dlp argümanına başka bir şey (virgül, regex) sızmasın.
fn is_valid_lang(lang: &str) -> bool {
    (2..=12).contains(&lang.len())
        && lang.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        && lang.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
}

fn subtitle_langs(request: &DownloadRequest) -> String {
    let langs: Vec<&str> = request
        .subtitle_langs
        .iter()
        .map(String::as_str)
        .filter(|l| is_valid_lang(l))
        .collect();
    if langs.is_empty() {
        "tr,en".to_string()
    } else {
        langs.join(",")
    }
}

const AUDIO_FORMATS: [&str; 5] = ["mp3", "m4a", "wav", "aac", "flac"];

/// Kullanıcının seçtiği çıktı formatını yt-dlp format seçicisine ve
/// son-işlem argümanlarına çevirir. Tüm dönüştürmeler yt-dlp'nin kendi
/// FFmpeg son-işlemcileriyle yapılır (bizim ffmpeg'imiz `--ffmpeg-location` ile).
fn build_format_args(request: &DownloadRequest) -> Vec<String> {
    let height = request
        .max_height
        .map(|h| format!("[height<={h}]"))
        .unwrap_or_default();

    let output_format = request
        .output_format
        .as_deref()
        .unwrap_or(if request.audio_only {
            "native-audio"
        } else {
            "mp4"
        });

    let mut args: Vec<String> = Vec::new();

    if output_format == "native-audio" {
        args.extend(["-f".into(), "ba/b".into()]);
    } else if AUDIO_FORMATS.contains(&output_format) {
        let selector = if output_format == "m4a" {
            "ba[ext=m4a]/ba/b"
        } else {
            "ba/b"
        };
        args.extend([
            "-f".into(),
            selector.into(),
            "-x".into(),
            "--audio-format".into(),
            output_format.into(),
        ]);
        if matches!(output_format, "mp3" | "m4a" | "aac") {
            let kbps = request.audio_bitrate_kbps.unwrap_or(DEFAULT_AUDIO_KBPS);
            args.extend(["--audio-quality".into(), format!("{kbps}K")]);
        }
    } else {
        let selector = if let Some(id) = &request.format_id {
            format!("{id}+ba/{id}")
        } else {
            match output_format {
                "webm" => format!("bv*[ext=webm]{height}+ba[ext=webm]/bv*{height}+ba/b{height}/b"),
                "mkv" => format!("bv*{height}+ba/b{height}/b"),
                // mp4/mov/avi: en geniş uyumluluk için H.264 + AAC tercih edilir.
                _ => format!("bv*[vcodec^=avc1]{height}+ba[ext=m4a]/bv*{height}+ba/b{height}/b"),
            }
        };
        args.extend(["-f".into(), selector]);

        match output_format {
            "mkv" => args.extend(["--merge-output-format".into(), "mkv".into()]),
            // Eski cihaz uyumluluğu için AVI her zaman yeniden kodlanır.
            "avi" => args.extend([
                "--merge-output-format".into(),
                "mkv".into(),
                "--recode-video".into(),
                "avi".into(),
            ]),
            // Önce doğrudan hedef kapsayıcıya birleştirmeyi dener; codec'ler
            // uymazsa mkv'ye birleştirip yalnızca o durumda yeniden kodlar.
            other => args.extend([
                "--merge-output-format".into(),
                format!("{other}/mkv"),
                "--recode-video".into(),
                other.into(),
            ]),
        }
    }

    if request.subtitles {
        args.extend([
            // yt-dlp altyazı indirme hatasını (ör. YouTube'un 429 kısıtlaması)
            // varsayılan olarak ölümcül sayıp videoyu da iptal ediyor. `-i` ile
            // uyarıya düşer; gerçek indirme hataları yine çıkış kodu 1 verir.
            "--ignore-errors".into(),
            "--write-subs".into(),
            "--sub-langs".into(),
            subtitle_langs(request),
            "--convert-subs".into(),
            "srt".into(),
        ]);
        if request.auto_subtitles {
            args.push("--write-auto-subs".into());
        }
    }

    if let Some((start, end)) = section_range(request) {
        args.extend([
            "--download-sections".into(),
            format!(
                "*{}-{}",
                ffmpeg::trim::seconds_arg(start),
                ffmpeg::trim::seconds_arg(end)
            ),
            // Kesim en yakın anahtar kareye kaymasın; ölçümde süreyi uzatmadı.
            "--force-keyframes-at-cuts".into(),
        ]);
    }

    if let Some(kbps) = request.rate_limit_kbps.filter(|k| *k > 0) {
        args.extend(["--limit-rate".into(), format!("{kbps}K")]);
    }

    args
}

#[derive(Debug, Deserialize)]
struct ProgressEnvelope {
    progress: YtDlpProgress,
    vcodec: Option<String>,
}

// Sayılar yt-dlp'de bazen tam sayı bazen ondalık gelir; tek bir float alanın
// ayrıştırılamaması bütün satırı düşürmesin diye hepsi f64 okunur.
#[derive(Debug, Deserialize)]
struct YtDlpProgress {
    status: Option<String>,
    downloaded_bytes: Option<f64>,
    total_bytes: Option<f64>,
    total_bytes_estimate: Option<f64>,
    speed: Option<f64>,
    eta: Option<f64>,
    #[serde(rename = "_percent")]
    percent: Option<f64>,
    fragment_index: Option<f64>,
    fragment_count: Option<f64>,
}

#[derive(Debug)]
enum StdoutLine {
    Progress(ProgressEnvelope),
    File(String),
    /// İndirmeden önce bilinen hedef yol; iptal/duraklatmada yarım dosyaları bulmak için.
    Target(String),
    Other,
}

fn parse_stdout_line(line: &str) -> StdoutLine {
    let line = line.trim();
    if let Some(rest) = line.strip_prefix(PROGRESS_PREFIX) {
        return serde_json::from_str(rest)
            .map(StdoutLine::Progress)
            .unwrap_or(StdoutLine::Other);
    }
    if let Some(rest) = line.strip_prefix(FILE_PREFIX) {
        return serde_json::from_str::<String>(rest)
            .map(StdoutLine::File)
            .unwrap_or(StdoutLine::Other);
    }
    if let Some(rest) = line.strip_prefix(TARGET_PREFIX) {
        return serde_json::from_str::<String>(rest)
            .map(StdoutLine::Target)
            .unwrap_or(StdoutLine::Other);
    }
    StdoutLine::Other
}

#[derive(Debug, PartialEq)]
struct ProgressUpdate {
    percent: Option<f64>,
    downloaded_bytes: u64,
    stream_total_bytes: Option<u64>,
    speed_bps: Option<f64>,
    eta_seconds: Option<f64>,
    stage: &'static str,
    stream: &'static str,
    stream_index: u32,
}

/// Video ve ses genelde ayrı akış olarak sırayla iner; tamamlanan akışların
/// baytlarını biriktirerek toplam indirilen miktarı sürekli artan tutar.
#[derive(Default)]
struct ProgressTracker {
    completed_bytes: u64,
    stream_index: u32,
    in_stream: bool,
    last_emit: Option<Instant>,
}

impl ProgressTracker {
    fn update(&mut self, envelope: &ProgressEnvelope, now: Instant) -> Option<ProgressUpdate> {
        let p = &envelope.progress;
        let stream = if envelope.vcodec.as_deref() == Some("none") {
            "audio"
        } else {
            "video"
        };
        let total = p.total_bytes.or(p.total_bytes_estimate).map(|v| v as u64);
        let downloaded = p.downloaded_bytes.unwrap_or(0.0) as u64;

        let starts_stream = !self.in_stream;
        if starts_stream {
            self.stream_index += 1;
            self.in_stream = true;
        }

        match p.status.as_deref() {
            Some("finished") => {
                self.completed_bytes += total.unwrap_or(downloaded).max(downloaded);
                self.in_stream = false;
                self.last_emit = Some(now);
                Some(ProgressUpdate {
                    percent: Some(100.0),
                    downloaded_bytes: self.completed_bytes,
                    stream_total_bytes: total,
                    speed_bps: p.speed,
                    eta_seconds: None,
                    stage: "post_processing",
                    stream,
                    stream_index: self.stream_index,
                })
            }
            Some("downloading") => {
                let throttled = self
                    .last_emit
                    .is_some_and(|last| now.duration_since(last) < PROGRESS_INTERVAL);
                if throttled && !starts_stream {
                    return None;
                }
                self.last_emit = Some(now);
                let percent =
                    p.percent
                        .or_else(|| match (total, p.fragment_index, p.fragment_count) {
                            (Some(t), _, _) if t > 0 => Some(downloaded as f64 / t as f64 * 100.0),
                            (_, Some(i), Some(c)) if c > 0.0 => Some(i / c * 100.0),
                            _ => None,
                        });
                Some(ProgressUpdate {
                    percent: percent.map(|v| v.clamp(0.0, 100.0)),
                    downloaded_bytes: self.completed_bytes + downloaded,
                    stream_total_bytes: total,
                    speed_bps: p.speed,
                    eta_seconds: p.eta,
                    stage: "downloading",
                    stream,
                    stream_index: self.stream_index,
                })
            }
            _ => None,
        }
    }
}

#[tauri::command]
pub async fn start_download(app: AppHandle, request: DownloadRequest) -> Result<String, AppError> {
    let ytdlp_path = ytdlp::binary::ensure_ytdlp(&app).await?;
    let ffmpeg_dir = ffmpeg::binary::ensure_ffmpeg(&app).await?;

    let output_template = translate_filename_template(&request.filename_template);
    let output_path = PathBuf::from(&request.destination_dir).join(&output_template);

    let platform = crate::platform::detect_platform(&request.url).unwrap_or("");
    let js_args = ytdlp::jsruntime::ytdlp_args(&app, platform).await;

    let mut args = build_format_args(&request);
    args.extend(js_args);
    args.extend([
        "--newline".into(),
        // `--print` quiet modu açıyor; ilerlemenin yine basılması için şart.
        "--progress".into(),
        "--encoding".into(),
        "utf-8".into(),
        // `%(...)j` ASCII-güvenli JSON üretir: Windows'ta çıktı kod sayfası
        // (cp1254) ne olursa olsun Türkçe karakterli yollar bozulmaz.
        "--progress-template".into(),
        format!(
            "download:{PROGRESS_PREFIX}{{\"progress\":%(progress)j,\"vcodec\":%(info.vcodec)j}}"
        ),
        "--print".into(),
        format!("before_dl:{TARGET_PREFIX}%(filename)j"),
        "--print".into(),
        format!("after_move:{FILE_PREFIX}%(filepath)j"),
        "--ffmpeg-location".into(),
        ffmpeg_dir.to_string_lossy().into_owned(),
        "-o".into(),
        output_path.to_string_lossy().into_owned(),
        // `--no-warnings` kullanılmaz: altyazı hatası artık uyarı olarak geliyor
        // ve kullanıcıya bildirmek için okunması gerekiyor.
        "--no-playlist".into(),
        request.url.clone(),
    ]);

    let section_mode = section_range(&request).is_some();
    let mut command = Command::new(&ytdlp_path);
    command
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    jobs::hide_console(&mut command);

    let mut child = command.spawn().map_err(|e| {
        AppError::coded(
            "toolStartFailed",
            "İndirme başlatılamadı.",
            Some(e.to_string()),
        )
    })?;

    let job_id = Uuid::new_v4().to_string();
    if let Some(pid) = child.id() {
        jobs::register(&app, &job_id, pid);
    }

    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");
    let app_for_task = app.clone();
    let job_id_for_task = job_id.clone();

    tauri::async_runtime::spawn(async move {
        run_download_job(
            app_for_task,
            job_id_for_task,
            child,
            stdout,
            stderr,
            section_mode,
        )
        .await;
    });

    Ok(job_id)
}

async fn run_download_job(
    app: AppHandle,
    job_id: String,
    mut child: tokio::process::Child,
    stdout: tokio::process::ChildStdout,
    stderr: tokio::process::ChildStderr,
    section_mode: bool,
) {
    let mut stdout = BufReader::new(stdout);
    let mut stderr = BufReader::new(stderr);
    let (mut out_buf, mut err_buf) = (Vec::new(), Vec::new());
    let mut stderr_done = false;
    let mut summary = StderrSummary::default();
    let mut final_path: Option<String> = None;
    let mut target: Option<String> = None;
    let mut tracker = ProgressTracker::default();
    // Bölüm indirmede yt-dlp ara ilerleme vermiyor (yalnızca "bitti"); büyüyen
    // yarım dosyanın boyutu izlenir, yüzdeyi arayüz tahmini boyuta oranlar.
    let mut ticker = tokio::time::interval(Duration::from_millis(750));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut last_poll: Option<(u64, Instant)> = None;

    loop {
        tokio::select! {
            _ = ticker.tick(), if section_mode && target.is_some() => {
                let bytes = partial_bytes(target.as_deref().unwrap_or_default()).await;
                let now = Instant::now();
                let speed = last_poll.and_then(|(prev, at)| {
                    let dt = now.duration_since(at).as_secs_f64();
                    (bytes > prev && dt > 0.0).then(|| (bytes - prev) as f64 / dt)
                });
                if bytes > last_poll.map_or(0, |(prev, _)| prev) {
                    let _ = app.emit(
                        "download-progress",
                        DownloadProgressPayload {
                            job_id: job_id.clone(),
                            percent: None,
                            downloaded_bytes: bytes,
                            stream_total_bytes: None,
                            speed_bps: speed,
                            eta_seconds: None,
                            stage: "downloading",
                            stream: "video",
                            stream_index: 1,
                        },
                    );
                }
                last_poll = Some((bytes, now));
            }
            line = jobs::read_line_lossy(&mut stdout, &mut out_buf) => {
                let Some(line) = line else { break };
                match parse_stdout_line(&line) {
                    StdoutLine::Progress(envelope) => {
                        if let Some(u) = tracker.update(&envelope, Instant::now()) {
                            let _ = app.emit(
                                "download-progress",
                                DownloadProgressPayload {
                                    job_id: job_id.clone(),
                                    percent: u.percent,
                                    downloaded_bytes: u.downloaded_bytes,
                                    stream_total_bytes: u.stream_total_bytes,
                                    speed_bps: u.speed_bps,
                                    eta_seconds: u.eta_seconds,
                                    stage: u.stage,
                                    stream: u.stream,
                                    stream_index: u.stream_index,
                                },
                            );
                        }
                    }
                    StdoutLine::File(path) => final_path = Some(path),
                    StdoutLine::Target(path) => target = Some(path),
                    StdoutLine::Other => {}
                }
            }
            line = jobs::read_line_lossy(&mut stderr, &mut err_buf), if !stderr_done => {
                match line {
                    Some(line) => summary.push(&line),
                    None => stderr_done = true,
                }
            }
        }
    }
    // stdout stderr'den önce kapanabilir; yt-dlp'nin asıl `ERROR:` satırı genelde
    // en sondadır, kaybolmasın diye stderr sonuna kadar okunur.
    while !stderr_done {
        match jobs::read_line_lossy(&mut stderr, &mut err_buf).await {
            Some(line) => summary.push(&line),
            None => stderr_done = true,
        }
    }

    let status = child.wait().await;
    let finished = jobs::finish(&app, &job_id);
    let succeeded = matches!(status, Ok(s) if s.success());

    // Her iş tam olarak bir terminal olay yayınlar; UI asla "İndiriliyor"da asılı kalmaz.
    if finished.canceled {
        // İptalde yarım dosyalar silinir; duraklatmada yt-dlp devam ederken
        // kaldığı yerden sürdürsün diye tutulur ve yolu arayüze bildirilir.
        let partial_target = if finished.discard_partial {
            if let Some(target) = &target {
                discard_partials(target).await;
            }
            None
        } else {
            target
        };
        let _ = app.emit(
            "download-canceled",
            JobCanceledPayload {
                job_id,
                partial_target,
            },
        );
        return;
    }

    match (succeeded, final_path) {
        (true, Some(path)) => {
            let size = tokio::fs::metadata(&path)
                .await
                .map(|m| m.len())
                .unwrap_or(0);
            let _ = app.emit(
                "download-complete",
                JobCompletePayload {
                    job_id,
                    file_path: path,
                    file_size_bytes: size,
                    notice: summary.subtitles_failed.then_some("subtitlesFailed"),
                },
            );
        }
        (true, None) => {
            let _ = app.emit(
                "download-error",
                JobErrorPayload {
                    job_id,
                    message:
                        "İndirme bitti ama dosyanın yeri okunamadı. İndirme klasörünü kontrol edin."
                            .to_string(),
                    code: Some("downloadNoFile"),
                    raw_detail: Some(summary.tail),
                },
            );
        }
        (false, _) => {
            let friendly = ytdlp::errors::friendly(summary.error_text());
            let _ = app.emit(
                "download-error",
                JobErrorPayload {
                    job_id,
                    message: friendly
                        .map(|f| f.message)
                        .unwrap_or("İndirme tamamlanamadı. Tekrar deneyin.")
                        .to_string(),
                    code: Some(friendly.map(|f| f.code).unwrap_or("downloadFailed")),
                    raw_detail: Some(summary.tail),
                },
            );
        }
    }
}

/// yt-dlp'nin stderr çıktısından gereken her şeyi tek geçişte toplar.
/// Uyarılar artık kapatılmadığı için hata mesajı yalnızca `ERROR:` satırlarından
/// çıkarılır; aksi halde "yeniden deneniyor… timed out" gibi zararsız bir uyarı
/// asıl hatanın yerine açıklama olarak seçilebilirdi.
#[derive(Default)]
struct StderrSummary {
    tail: String,
    errors: String,
    subtitles_failed: bool,
}

impl StderrSummary {
    fn push(&mut self, line: &str) {
        jobs::push_tail(&mut self.tail, line);
        if line.trim_start().starts_with("ERROR:") {
            jobs::push_tail(&mut self.errors, line);
        }
        if line
            .to_lowercase()
            .contains("unable to download video subtitles")
        {
            self.subtitles_failed = true;
        }
    }

    fn error_text(&self) -> &str {
        if self.errors.is_empty() {
            &self.tail
        } else {
            &self.errors
        }
    }
}

/// `discard`: İptal'de true (yarım dosyalar silinir), Duraklat'ta false.
#[tauri::command]
pub async fn cancel_download(
    app: AppHandle,
    job_id: String,
    discard: Option<bool>,
) -> Result<(), AppError> {
    jobs::cancel(&app, &job_id, discard.unwrap_or(true)).await;
    Ok(())
}

/// Duraklatılmış (süreci bitmiş) bir indirme iptal edilince arayüz, duraklatırken
/// aldığı hedef yolla yarım dosyaları sildirir.
#[tauri::command]
pub async fn discard_partial_download(target: String) -> Result<(), AppError> {
    discard_partials(&target).await;
    Ok(())
}

/// yt-dlp'nin bir indirme için bıraktığı geçici dosyalar mı? Yalnızca bunlar
/// silinir; aynı adla başlayan bitmiş dosyalara (ör. "Video.mp4", "Video.tr.srt")
/// dokunulmaz.
///   Video.mp4.part, Video.f137.mp4.part, Video.f137.mp4 (birleştirilmemiş akış),
///   Video.mp4.ytdl, Video.mp4.part-Frag12, Video.temp.mp4 (yarım birleştirme)
fn is_partial_of(stem: &str, file_name: &str) -> bool {
    let Some(rest) = file_name
        .strip_prefix(stem)
        .and_then(|r| r.strip_prefix('.'))
    else {
        return false;
    };
    if rest.contains(".part") || rest.ends_with(".ytdl") || rest.starts_with("temp.") {
        return true;
    }
    // "f137.mp4", "f251-drc.webm": birleştirilmeyi bekleyen tek akış.
    match rest.split_once('.') {
        Some((format, ext)) => {
            format.len() > 1
                && format.starts_with('f')
                && format[1..]
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
                && !ext.is_empty()
                && ext.chars().all(|c| c.is_ascii_alphanumeric())
        }
        None => false,
    }
}

/// Bir indirmenin o ana kadar diske yazdığı yarım dosyaların toplam boyutu.
async fn partial_bytes(target: &str) -> u64 {
    let target = std::path::Path::new(target);
    let (Some(dir), Some(stem)) = (target.parent(), target.file_stem().and_then(|s| s.to_str()))
    else {
        return 0;
    };
    let Ok(mut entries) = tokio::fs::read_dir(dir).await else {
        return 0;
    };
    let mut total = 0;
    while let Ok(Some(entry)) = entries.next_entry().await {
        let is_partial = entry
            .file_name()
            .to_str()
            .is_some_and(|n| is_partial_of(stem, n));
        if is_partial {
            total += entry.metadata().await.map(|m| m.len()).unwrap_or(0);
        }
    }
    total
}

async fn discard_partials(target: &str) {
    let target = std::path::Path::new(target);
    let (Some(dir), Some(stem)) = (target.parent(), target.file_stem().and_then(|s| s.to_str()))
    else {
        return;
    };
    let Ok(mut entries) = tokio::fs::read_dir(dir).await else {
        return;
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name();
        if name.to_str().is_some_and(|n| is_partial_of(stem, n)) {
            let _ = tokio::fs::remove_file(entry.path()).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(output_format: Option<&str>, max_height: Option<u32>) -> DownloadRequest {
        DownloadRequest {
            url: "https://example.com".into(),
            destination_dir: "C:/indirilenler".into(),
            filename_template: "{title}.{ext}".into(),
            audio_only: false,
            max_height,
            format_id: None,
            output_format: output_format.map(str::to_string),
            audio_bitrate_kbps: None,
            subtitles: false,
            subtitle_langs: Vec::new(),
            auto_subtitles: true,
            rate_limit_kbps: None,
            section_start: None,
            section_end: None,
        }
    }

    fn joined(args: &[String]) -> String {
        args.join(" ")
    }

    #[test]
    fn mp4_h264_ve_aac_tercih_eder() {
        let args = joined(&build_format_args(&request(Some("mp4"), Some(1080))));
        assert!(args.contains("bv*[vcodec^=avc1][height<=1080]+ba[ext=m4a]"));
        assert!(args.contains("--merge-output-format mp4/mkv"));
        assert!(args.contains("--recode-video mp4"));
    }

    #[test]
    fn format_verilmezse_mp4_varsayilir() {
        let args = joined(&build_format_args(&request(None, None)));
        assert!(args.contains("--merge-output-format mp4/mkv"));
    }

    #[test]
    fn mp3_ses_cikarir_ve_bit_hizini_uygular() {
        let mut req = request(Some("mp3"), None);
        req.audio_bitrate_kbps = Some(320);
        let args = joined(&build_format_args(&req));
        assert!(args.contains("-x --audio-format mp3"));
        assert!(args.contains("--audio-quality 320K"));
    }

    #[test]
    fn kayipsiz_ses_formatinda_bit_hizi_verilmez() {
        let args = joined(&build_format_args(&request(Some("flac"), None)));
        assert!(args.contains("--audio-format flac"));
        assert!(!args.contains("--audio-quality"));
    }

    #[test]
    fn avi_her_zaman_yeniden_kodlanir() {
        let args = joined(&build_format_args(&request(Some("avi"), Some(720))));
        assert!(args.contains("--merge-output-format mkv --recode-video avi"));
    }

    #[test]
    fn eski_sadece_ses_istegi_donusturmeden_indirir() {
        let mut req = request(None, None);
        req.audio_only = true;
        let args = build_format_args(&req);
        assert_eq!(args, vec!["-f".to_string(), "ba/b".to_string()]);
    }

    #[test]
    fn gelismis_modda_secilen_format_kullanilir() {
        let mut req = request(Some("mkv"), None);
        req.format_id = Some("137".into());
        let args = joined(&build_format_args(&req));
        assert!(args.contains("-f 137+ba/137"));
    }

    #[test]
    fn altyazi_istenirse_srt_olarak_yazilir() {
        let mut req = request(Some("mp4"), None);
        req.subtitles = true;
        let args = joined(&build_format_args(&req));
        assert!(args.contains("--write-subs --sub-langs tr,en --convert-subs srt"));
        assert!(args.contains("--write-auto-subs"));
    }

    #[test]
    fn dosya_satiri_turkce_karakterleri_cozer() {
        let line = r#"[dk-file]"C:\\indir\\Yar\u0131\u015fmas\u0131.mp4""#;
        match parse_stdout_line(line) {
            StdoutLine::File(path) => assert_eq!(path, "C:\\indir\\Yarışması.mp4"),
            other => panic!("beklenmeyen: {other:?}"),
        }
    }

    #[test]
    fn ilerleme_satiri_ayristirilir() {
        let line = r#"[dk-progress]{"progress":{"status": "downloading", "downloaded_bytes": 500, "total_bytes": 1000, "speed": 2048.5, "eta": 3, "_percent": 50.0},"vcodec":"avc1.4D400B"}"#;
        match parse_stdout_line(line) {
            StdoutLine::Progress(env) => {
                assert_eq!(env.progress.percent, Some(50.0));
                assert_eq!(env.vcodec.as_deref(), Some("avc1.4D400B"));
            }
            other => panic!("beklenmeyen: {other:?}"),
        }
    }

    #[test]
    fn tanimsiz_satirlar_yok_sayilir() {
        assert!(matches!(
            parse_stdout_line("[download] 12%"),
            StdoutLine::Other
        ));
        assert!(matches!(
            parse_stdout_line("[dk-progress]{bozuk"),
            StdoutLine::Other
        ));
    }

    fn envelope(status: &str, downloaded: f64, total: f64, vcodec: &str) -> ProgressEnvelope {
        ProgressEnvelope {
            progress: YtDlpProgress {
                status: Some(status.into()),
                downloaded_bytes: Some(downloaded),
                total_bytes: Some(total),
                total_bytes_estimate: None,
                speed: Some(1000.0),
                eta: Some(5.0),
                percent: None,
                fragment_index: None,
                fragment_count: None,
            },
            vcodec: Some(vcodec.into()),
        }
    }

    #[test]
    fn video_ve_ses_akislari_birikimli_toplanir() {
        let mut tracker = ProgressTracker::default();
        let t0 = Instant::now();

        let video = tracker
            .update(&envelope("downloading", 400.0, 1000.0, "avc1"), t0)
            .unwrap();
        assert_eq!(
            (video.stream, video.stream_index, video.downloaded_bytes),
            ("video", 1, 400)
        );
        assert_eq!(video.percent, Some(40.0));

        let video_done = tracker
            .update(&envelope("finished", 1000.0, 1000.0, "avc1"), t0)
            .unwrap();
        assert_eq!(video_done.stage, "post_processing");

        let audio = tracker
            .update(&envelope("downloading", 100.0, 200.0, "none"), t0)
            .unwrap();
        assert_eq!((audio.stream, audio.stream_index), ("audio", 2));
        assert_eq!(audio.downloaded_bytes, 1100);
        assert_eq!(audio.stage, "downloading");
    }

    #[test]
    fn sik_gelen_ilerleme_satirlari_seyreltilir() {
        let mut tracker = ProgressTracker::default();
        let t0 = Instant::now();
        assert!(tracker
            .update(&envelope("downloading", 1.0, 100.0, "avc1"), t0)
            .is_some());
        let soon = t0 + Duration::from_millis(50);
        assert!(tracker
            .update(&envelope("downloading", 2.0, 100.0, "avc1"), soon)
            .is_none());
        let later = t0 + Duration::from_millis(300);
        assert!(tracker
            .update(&envelope("downloading", 3.0, 100.0, "avc1"), later)
            .is_some());
    }

    #[test]
    fn toplam_bilinmezse_parca_sayisindan_yuzde_hesaplanir() {
        let mut tracker = ProgressTracker::default();
        let mut env = envelope("downloading", 10.0, 0.0, "avc1");
        env.progress.total_bytes = None;
        env.progress.fragment_index = Some(3.0);
        env.progress.fragment_count = Some(4.0);
        let update = tracker.update(&env, Instant::now()).unwrap();
        assert_eq!(update.percent, Some(75.0));
    }

    #[test]
    fn altyazi_isteninde_altyazi_hatasi_indirmeyi_durdurmaz() {
        let mut with_subs = request(Some("mp4"), None);
        with_subs.subtitles = true;
        assert!(build_format_args(&with_subs).contains(&"--ignore-errors".to_string()));
        // Altyazı istenmiyorsa yt-dlp'nin varsayılan (katı) davranışı korunur.
        assert!(!build_format_args(&request(Some("mp4"), None))
            .contains(&"--ignore-errors".to_string()));
    }

    #[test]
    fn stderr_ozeti_altyazi_hatasini_ve_asil_hatayi_ayirir() {
        let mut summary = StderrSummary::default();
        summary.push("WARNING: [youtube] abc: Retrying (1/3)... timed out");
        summary.push("WARNING: Unable to download video subtitles for 'en': HTTP Error 429: Too Many Requests");
        summary.push("ERROR: [youtube] abc: Video unavailable");
        assert!(summary.subtitles_failed);
        // Uyarıdaki "timed out" asıl hatanın yerine geçmez.
        assert!(!summary.error_text().contains("timed out"));
        assert!(summary.error_text().contains("Video unavailable"));
        assert!(summary.tail.contains("timed out"));
    }

    #[test]
    fn hata_satiri_yoksa_tum_cikti_kullanilir() {
        let mut summary = StderrSummary::default();
        summary.push("Traceback: beklenmeyen bir şey");
        assert!(!summary.subtitles_failed);
        assert!(summary.error_text().contains("Traceback"));
    }

    #[test]
    fn yalnizca_ytdlp_gecici_dosyalari_silinir() {
        let stem = "Türkçe Başlık [abc]";
        for partial in [
            "Türkçe Başlık [abc].mp4.part",
            "Türkçe Başlık [abc].f137.mp4.part",
            "Türkçe Başlık [abc].f137.mp4",
            "Türkçe Başlık [abc].f251-drc.webm",
            "Türkçe Başlık [abc].mp4.ytdl",
            "Türkçe Başlık [abc].mp4.part-Frag12",
            "Türkçe Başlık [abc].temp.mp4",
        ] {
            assert!(is_partial_of(stem, partial), "silinmeliydi: {partial}");
        }
        for kept in [
            "Türkçe Başlık [abc].mp4",
            "Türkçe Başlık [abc].tr.srt",
            "Türkçe Başlık [abc].flac",
            "Türkçe Başlık [abc] (1).mp4.part",
            "Başka video.mp4.part",
        ] {
            assert!(!is_partial_of(stem, kept), "korunmalıydı: {kept}");
        }
    }

    #[test]
    fn altyazi_dilleri_suzulur() {
        let mut req = request(Some("mp4"), None);
        req.subtitles = true;
        req.subtitle_langs = vec!["de".into(), "pt-BR".into(), "en,.*".into(), "".into()];
        let args = joined(&build_format_args(&req));
        assert!(args.contains("--sub-langs de,pt-BR "));
        assert!(!args.contains(".*"));

        req.subtitle_langs.clear();
        assert!(joined(&build_format_args(&req)).contains("--sub-langs tr,en "));
    }

    #[test]
    fn otomatik_altyazi_kapatilabilir() {
        let mut req = request(Some("mp4"), None);
        req.subtitles = true;
        assert!(joined(&build_format_args(&req)).contains("--write-auto-subs"));
        req.auto_subtitles = false;
        assert!(!joined(&build_format_args(&req)).contains("--write-auto-subs"));
    }

    #[test]
    fn hiz_siniri_argumana_cevrilir() {
        let mut req = request(Some("mp4"), None);
        assert!(!joined(&build_format_args(&req)).contains("--limit-rate"));
        req.rate_limit_kbps = Some(2048);
        assert!(joined(&build_format_args(&req)).contains("--limit-rate 2048K"));
    }

    #[test]
    fn hedef_yol_satiri_ayristirilir() {
        // yt-dlp `%(...)j` ile ters bölüyü ikiler, Türkçe harfleri \uXXXX yazar.
        match parse_stdout_line(r#"[dk-target]"C:\\Videolar\\T\u00fcrk\u00e7e.mp4""#) {
            StdoutLine::Target(path) => assert_eq!(path, r"C:\Videolar\Türkçe.mp4"),
            other => panic!("beklenmeyen: {other:?}"),
        }
    }

    #[test]
    fn bolum_secilince_yalnizca_o_aralik_hassas_kesilir() {
        let mut req = request(Some("mp4"), Some(720));
        req.section_start = Some(65.5);
        req.section_end = Some(130.0);
        let args = joined(&build_format_args(&req));
        assert!(args.contains("--download-sections *65.5-130 --force-keyframes-at-cuts"));
    }

    #[test]
    fn gecersiz_bolum_yok_sayilir() {
        let mut req = request(Some("mp4"), None);
        req.section_start = Some(90.0);
        req.section_end = Some(30.0);
        assert!(!joined(&build_format_args(&req)).contains("--download-sections"));
        req.section_end = None;
        assert!(!joined(&build_format_args(&req)).contains("--download-sections"));
    }

    #[tokio::test]
    async fn yarim_dosya_boyutu_toplanir() {
        let dir = std::env::temp_dir().join(format!("downkit-part-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("Klip.mp4.part"), vec![0u8; 1500]).unwrap();
        std::fs::write(dir.join("Klip.f140.m4a.part"), vec![0u8; 500]).unwrap();
        std::fs::write(dir.join("Baska.mp4.part"), vec![0u8; 9999]).unwrap();
        let target = dir.join("Klip.mp4");
        assert_eq!(partial_bytes(target.to_str().unwrap()).await, 2000);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
