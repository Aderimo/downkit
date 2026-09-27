//! Ekran kaydı ve geriye dönük kayıt (anlık tekrar, NVIDIA ShadowPlay / OBS
//! "Replay Buffer" gibi).
//!
//! - Kayıt: ekran (ya da pencere) ve sesler MKV'ye yazılır; durdurunca MP4'e
//!   aktarılır. Program çökse bile MKV oynatılabilir, Kayıtlar'dan onarılır.
//! - Anlık tekrar: arka planda son N saniye 2 saniyelik parçalar hâlinde diskte
//!   tutulur; "Kaydet" son N saniyeyi tek MP4 yapar. İkisi aynı anda çalışabilir.
//!
//! Durum her yarım saniyede `recorder-status` olayıyla yayınlanır; kaydedilen
//! dosya `recorder-saved`, beklenmedik hata `recorder-error` ile.

pub mod args;
pub mod audio;
mod denoise;
pub(crate) mod library;
pub mod mixer;
mod pipeline;
mod replay;
pub mod screenshot;
mod sources;
mod thumbs;

/// Pencere yakalamasında dürtülecek pencere.
fn nudge_target(target: &CaptureTarget) -> Option<u64> {
    match target {
        CaptureTarget::Window { hwnd, .. } => Some(*hwnd),
        CaptureTarget::Monitor { .. } => None,
    }
}

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::commands::edit::sanitize_name;
use crate::error::AppError;
use crate::{ffmpeg, jobs, paths};
use args::{CaptureTarget, Encoder, VideoOptions};
use pipeline::{AudioPlan, Pipeline};

const MAX_REPLAY_SECONDS: u32 = 600;
const MAX_REPLAY_RESTARTS: u32 = 5;

#[derive(Default)]
pub struct RecorderState(Mutex<Recorder>);

#[derive(Default)]
struct Recorder {
    recording: Option<Recording>,
    replay: Option<Replay>,
    /// Çalıştığı denenmiş kodlayıcı; anahtar: ddagrab mı (kare yolu farklı).
    encoders: HashMap<bool, Encoder>,
    ticker: bool,
    meta: library::MetaCache,
}

struct Recording {
    pipeline: Pipeline,
    mkv: PathBuf,
    mp4: PathBuf,
    has_audio: bool,
}

struct Replay {
    pipeline: Pipeline,
    dir: PathBuf,
    seconds: u32,
    wrap: u32,
    options: CaptureOptions,
    encoder: Encoder,
    restarts: u32,
    /// Son kaydın alt sınırı (akış saniyesi) ve alındığı an: arabellek oradan
    /// yeniden sayılır.
    floor: f64,
    saved_at: Option<std::time::Instant>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureOptions {
    pub target: CaptureTarget,
    pub video: VideoOptions,
    #[serde(default)]
    pub system_audio: bool,
    #[serde(default = "one")]
    pub system_volume: f32,
    /// Sistem sesinin alınacağı çıkış aygıtı; yoksa Windows varsayılanı.
    #[serde(default)]
    pub system_audio_id: Option<String>,
    #[serde(default)]
    pub microphone: bool,
    #[serde(default)]
    pub microphone_id: Option<String>,
    #[serde(default = "one")]
    pub microphone_volume: f32,
    /// Mikrofonda gürültü engelleme (RNNoise).
    #[serde(default = "yes")]
    pub noise_suppression: bool,
}

fn yes() -> bool {
    true
}

fn one() -> f32 {
    1.0
}

impl CaptureOptions {
    fn audio_plan(&self) -> AudioPlan {
        AudioPlan {
            system: self.system_audio.then(|| {
                (
                    self.system_audio_id.clone().filter(|id| !id.is_empty()),
                    self.system_volume.clamp(0.0, 2.0),
                )
            }),
            microphone: self.microphone.then(|| {
                (
                    self.microphone_id.clone().filter(|id| !id.is_empty()),
                    self.microphone_volume.clamp(0.0, 3.0),
                    self.noise_suppression,
                )
            }),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sources {
    monitors: Vec<sources::MonitorInfo>,
    windows: Vec<sources::WindowInfo>,
    microphones: Vec<audio::AudioDevice>,
    speakers: Vec<audio::AudioDevice>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncoderInfo {
    encoder: Encoder,
    label: &'static str,
    hardware: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedRecording {
    pub path: String,
    /// "recording" | "replay"
    pub kind: &'static str,
    pub seconds: f64,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    recording: Option<RecordingStatus>,
    replay: Option<ReplayStatus>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecordingStatus {
    seconds: f64,
    bytes: u64,
    path: String,
    has_audio: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReplayStatus {
    buffered_seconds: f64,
    seconds: u32,
    encoder: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecorderError {
    /// "recording" | "replay"
    kind: &'static str,
    message: String,
    detail: Option<String>,
}

fn state(app: &AppHandle) -> &Mutex<Recorder> {
    &app.state::<RecorderState>().inner().0
}

fn err(message: &str, detail: impl Into<Option<String>>) -> AppError {
    AppError::coded("recorderFailed", message, detail.into())
}

#[tauri::command]
pub async fn recorder_sources() -> Result<Sources, AppError> {
    tokio::task::spawn_blocking(|| Sources {
        monitors: sources::list_monitors(),
        windows: sources::list_windows(),
        microphones: audio::list_microphones(),
        speakers: audio::list_speakers(),
    })
    .await
    .map_err(|e| err("Kaynaklar okunamadı.", e.to_string()))
}

/// Kaynak seçicinin önizlemeleri: "m:<hmonitor>" / "w:<hwnd>" → JPEG veri adresi.
/// Çizilemeyen (simge durumundaki) pencereler listede yer almaz.
#[tauri::command]
pub async fn recorder_source_thumbs(width: u32) -> Result<HashMap<String, String>, AppError> {
    let width = width.clamp(120, 640);
    tokio::task::spawn_blocking(move || {
        let mut out = HashMap::new();
        for m in sources::list_monitors() {
            if let Some(url) = thumbs::monitor_thumb(m.hmonitor, width) {
                out.insert(format!("m:{}", m.hmonitor), url);
            }
        }
        for w in sources::list_windows().into_iter().filter(|w| !w.own) {
            if let Some(url) = thumbs::window_thumb(w.hwnd, width) {
                out.insert(format!("w:{}", w.hwnd), url);
            }
        }
        out
    })
    .await
    .map_err(|e| err("Önizlemeler alınamadı.", e.to_string()))
}

/// Oyuna / uygulamaya göre klasör açıksa `Kayıtlar\<Uygulama>`, değilse kayıt klasörü.
/// Tam ekran uygulama bulunamayan ekran kayıtlarında `fallback` (ör. "Ana ekran") kullanılır.
async fn app_dir(
    base: PathBuf,
    target: &CaptureTarget,
    by_app: bool,
    fallback: Option<String>,
) -> PathBuf {
    if !by_app {
        return base;
    }
    let target = target.clone();
    let app = tokio::task::spawn_blocking(move || sources::app_folder(&target))
        .await
        .ok()
        .flatten();
    match app
        .or(fallback)
        .map(|name| sanitize_name(&name))
        .filter(|n| !n.is_empty())
    {
        Some(folder) => base.join(folder),
        None => base,
    }
}

/// Bu yakalama için çalışan kodlayıcıyı bulur (ilk seferde dener, sonra hatırlar).
async fn ensure_encoder(
    app: &AppHandle,
    ffmpeg_exe: &Path,
    target: &CaptureTarget,
) -> Result<Encoder, AppError> {
    let dda = matches!(
        target,
        CaptureTarget::Monitor {
            dda_index: Some(_),
            ..
        }
    );
    if let Some(encoder) = state(app).lock().await.encoders.get(&dda) {
        return Ok(*encoder);
    }
    for encoder in Encoder::ALL {
        if pipeline::probe(
            ffmpeg_exe,
            args::probe_args(target, encoder),
            nudge_target(target),
        )
        .await
        {
            state(app).lock().await.encoders.insert(dda, encoder);
            return Ok(encoder);
        }
    }
    Err(AppError::coded(
        "captureUnavailable",
        "Ekran yakalanamadı. Seçilen ekran ya da pencere kapalı olabilir; Windows 10 (1903) ya da daha yenisi gerekir.",
        None,
    ))
}

#[tauri::command]
pub async fn recorder_prepare(
    app: AppHandle,
    target: CaptureTarget,
) -> Result<EncoderInfo, AppError> {
    let ffmpeg_dir = ffmpeg::binary::ensure_ffmpeg(&app).await?;
    let encoder = ensure_encoder(&app, &ffmpeg_dir.join("ffmpeg.exe"), &target).await?;
    Ok(EncoderInfo {
        encoder,
        label: encoder.label(),
        hardware: encoder.is_hardware(),
    })
}

/// Süreç başladıktan kısa süre sonra düşerse (ör. ekran kartı kodlayıcısı açılamadı)
/// hata hemen gösterilir.
async fn fail_fast(pipeline: Pipeline) -> Result<Pipeline, AppError> {
    for _ in 0..12 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        if pipeline.exit_status().is_some() {
            let detail = pipeline.stderr_tail();
            pipeline.dispose().await;
            return Err(err("Kayıt başlatılamadı.", detail));
        }
    }
    Ok(pipeline)
}

#[tauri::command]
pub async fn recorder_start(
    app: AppHandle,
    options: CaptureOptions,
    output_dir: String,
    name: String,
    by_app: Option<bool>,
    folder_fallback: Option<String>,
) -> Result<(), AppError> {
    if state(&app).lock().await.recording.is_some() {
        return Err(err("Zaten kayıt yapılıyor.", None::<String>));
    }
    let ffmpeg_dir = ffmpeg::binary::ensure_ffmpeg(&app).await?;
    let ffmpeg_exe = ffmpeg_dir.join("ffmpeg.exe");
    let encoder = ensure_encoder(&app, &ffmpeg_exe, &options.target).await?;

    let dir = app_dir(
        PathBuf::from(&output_dir),
        &options.target,
        by_app.unwrap_or(false),
        folder_fallback,
    )
    .await;
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| err("Kayıt klasörü oluşturulamadı.", e.to_string()))?;
    let stem = sanitize_name(&name);
    let mp4 = jobs::unique_output_path(&dir, &stem, "mp4");
    let mkv_stem = mp4
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or(stem);
    let mkv = jobs::unique_output_path(&dir, &mkv_stem, "mkv");
    let plan = options.audio_plan();
    let has_audio = plan.system.is_some() || plan.microphone.is_some();

    let mkv_text = mkv.to_string_lossy().into_owned();
    let pipeline = Pipeline::start(
        &ffmpeg_exe,
        |pipe| args::recording_args(&options.target, &options.video, encoder, pipe, &mkv_text),
        plan,
        nudge_target(&options.target),
    )
    .await
    .map_err(|e| err("Kayıt başlatılamadı.", e))?;
    let pipeline = fail_fast(pipeline).await?;

    let mut s = state(&app).lock().await;
    s.recording = Some(Recording {
        pipeline,
        mkv,
        mp4,
        has_audio,
    });
    start_ticker(&app, &mut s);
    Ok(())
}

/// MKV'yi MP4'e aktarır; başarılıysa MKV silinir. Aktarılamazsa MKV kalır.
async fn finalize(ffmpeg_exe: &Path, mkv: &Path, mp4: &Path) -> PathBuf {
    let args = args::remux_args(&mkv.to_string_lossy(), &mp4.to_string_lossy());
    match pipeline::run_ffmpeg(ffmpeg_exe, args).await {
        Ok(()) => {
            let _ = tokio::fs::remove_file(mkv).await;
            mp4.to_path_buf()
        }
        Err(_) => {
            let _ = tokio::fs::remove_file(mp4).await;
            mkv.to_path_buf()
        }
    }
}

async fn saved(ffmpeg_dir: &Path, path: &Path, kind: &'static str) -> SavedRecording {
    let text = path.to_string_lossy().into_owned();
    let info = ffmpeg::convert::probe_file(ffmpeg_dir, &text).await.ok();
    SavedRecording {
        seconds: info
            .as_ref()
            .and_then(|i| i.duration_seconds)
            .unwrap_or(0.0),
        bytes: info.map(|i| i.file_size_bytes).unwrap_or(0),
        path: text,
        kind,
    }
}

#[tauri::command]
pub async fn recorder_stop(app: AppHandle) -> Result<SavedRecording, AppError> {
    let recording = state(&app)
        .lock()
        .await
        .recording
        .take()
        .ok_or_else(|| err("Kayıt yapılmıyor.", None::<String>))?;
    let ffmpeg_dir = ffmpeg::binary::ensure_ffmpeg(&app).await?;
    let stopped = recording.pipeline.stop().await;
    let written = tokio::fs::metadata(&recording.mkv)
        .await
        .map(|m| m.len() > 0)
        .unwrap_or(false);
    if !written {
        let _ = tokio::fs::remove_file(&recording.mkv).await;
        return Err(err(
            "Kayıt kaydedilemedi.",
            stopped.err().filter(|t| !t.is_empty()),
        ));
    }
    let path = finalize(
        &ffmpeg_dir.join("ffmpeg.exe"),
        &recording.mkv,
        &recording.mp4,
    )
    .await;
    let result = saved(&ffmpeg_dir, &path, "recording").await;
    let _ = app.emit("recorder-saved", result.clone());
    Ok(result)
}

async fn start_replay_pipeline(
    ffmpeg_exe: &Path,
    options: &CaptureOptions,
    encoder: Encoder,
    dir: &Path,
    wrap: u32,
) -> Result<Pipeline, AppError> {
    let dir_text = dir.to_string_lossy().into_owned();
    let pipeline = Pipeline::start(
        ffmpeg_exe,
        |pipe| {
            args::replay_args(
                &options.target,
                &options.video,
                encoder,
                pipe,
                &dir_text,
                wrap,
            )
        },
        options.audio_plan(),
        nudge_target(&options.target),
    )
    .await
    .map_err(|e| err("Anlık tekrar başlatılamadı.", e))?;
    fail_fast(pipeline).await
}

#[tauri::command]
pub async fn replay_start(
    app: AppHandle,
    options: CaptureOptions,
    seconds: u32,
) -> Result<(), AppError> {
    if state(&app).lock().await.replay.is_some() {
        return Err(err("Anlık tekrar zaten açık.", None::<String>));
    }
    let seconds = seconds.clamp(5, MAX_REPLAY_SECONDS);
    let ffmpeg_dir = ffmpeg::binary::ensure_ffmpeg(&app).await?;
    let ffmpeg_exe = ffmpeg_dir.join("ffmpeg.exe");
    let encoder = ensure_encoder(&app, &ffmpeg_exe, &options.target).await?;
    let dir = paths::cache_dir(&app, "replay")?.join(Uuid::new_v4().simple().to_string());
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| err("Geçici klasör oluşturulamadı.", e.to_string()))?;
    let wrap = replay::wrap_for(seconds);
    let pipeline = match start_replay_pipeline(&ffmpeg_exe, &options, encoder, &dir, wrap).await {
        Ok(p) => p,
        Err(e) => {
            let _ = tokio::fs::remove_dir_all(&dir).await;
            return Err(e);
        }
    };
    let mut s = state(&app).lock().await;
    s.replay = Some(Replay {
        pipeline,
        dir,
        seconds,
        wrap,
        options,
        encoder,
        restarts: 0,
        floor: 0.0,
        saved_at: None,
    });
    start_ticker(&app, &mut s);
    Ok(())
}

#[tauri::command]
pub async fn replay_stop(app: AppHandle) -> Result<(), AppError> {
    let replay = state(&app).lock().await.replay.take();
    if let Some(replay) = replay {
        let _ = replay.pipeline.stop().await;
        let _ = tokio::fs::remove_dir_all(&replay.dir).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn replay_save(
    app: AppHandle,
    output_dir: String,
    name: String,
    by_app: Option<bool>,
    folder_fallback: Option<String>,
) -> Result<SavedRecording, AppError> {
    let (dir, seconds, wrap, floor, target) = {
        let s = state(&app).lock().await;
        let replay = s
            .replay
            .as_ref()
            .ok_or_else(|| err("Anlık tekrar açık değil.", None::<String>))?;
        // Tuşa art arda basılınca aynı an iki kez kaydedilmesin.
        if replay
            .saved_at
            .is_some_and(|at| at.elapsed() < Duration::from_millis(1500))
        {
            return Err(AppError::coded(
                "replayJustSaved",
                "Az önce kaydedildi.",
                None,
            ));
        }
        (
            replay.dir.clone(),
            replay.seconds,
            replay.wrap,
            replay.floor,
            replay.options.target.clone(),
        )
    };
    let ffmpeg_dir = ffmpeg::binary::ensure_ffmpeg(&app).await?;
    let list = tokio::fs::read_to_string(dir.join("list.csv"))
        .await
        .unwrap_or_default();
    let picked = replay::pick(&replay::parse_list(&list), seconds as f64, wrap, floor);
    let files = picked.files;

    // Parçalar kopyalanır: birleştirme sürerken halka en eskinin üzerine yazmasın.
    let work = paths::cache_dir(&app, "replay-save")?.join(Uuid::new_v4().simple().to_string());
    tokio::fs::create_dir_all(&work)
        .await
        .map_err(|e| err("Geçici klasör oluşturulamadı.", e.to_string()))?;
    let mut copies = Vec::new();
    for (i, file) in files.iter().enumerate() {
        let source = dir.join(file);
        let target = work.join(format!("{i:04}.ts"));
        if tokio::fs::copy(&source, &target).await.is_ok_and(|n| n > 0) {
            copies.push(target.to_string_lossy().into_owned());
        }
    }
    if copies.is_empty() {
        let _ = tokio::fs::remove_dir_all(&work).await;
        return Err(AppError::coded(
            "replayEmpty",
            "Henüz kaydedilecek bir şey yok; birkaç saniye sonra tekrar dene.",
            None,
        ));
    }
    let list_path = work.join("list.txt");
    tokio::fs::write(&list_path, replay::concat_list(&copies))
        .await
        .map_err(|e| err("Anlık tekrar kaydedilemedi.", e.to_string()))?;

    // Kaydetme anında öndeki oyunun klasörüne (NVIDIA'daki gibi).
    let out_dir = app_dir(
        PathBuf::from(&output_dir),
        &target,
        by_app.unwrap_or(false),
        folder_fallback,
    )
    .await;
    tokio::fs::create_dir_all(&out_dir)
        .await
        .map_err(|e| err("Kayıt klasörü oluşturulamadı.", e.to_string()))?;
    let output = jobs::unique_output_path(&out_dir, &sanitize_name(&name), "mp4");
    let result = pipeline::run_ffmpeg(
        &ffmpeg_dir.join("ffmpeg.exe"),
        args::concat_args(&list_path.to_string_lossy(), &output.to_string_lossy()),
    )
    .await;
    let _ = tokio::fs::remove_dir_all(&work).await;
    if let Err(detail) = result {
        let _ = tokio::fs::remove_file(&output).await;
        return Err(err("Anlık tekrar kaydedilemedi.", detail));
    }
    // Arabellek kayıt anından yeniden sayılır (aynı oturum sürüyorsa).
    {
        let mut s = state(&app).lock().await;
        if let Some(replay) = s.replay.as_mut().filter(|r| r.dir == dir) {
            replay.floor = picked.current_start;
            replay.saved_at = Some(std::time::Instant::now());
        }
    }
    let result = saved(&ffmpeg_dir, &output, "replay").await;
    let _ = app.emit("recorder-saved", result.clone());
    Ok(result)
}

async fn snapshot(s: &Recorder) -> Status {
    let recording = s.recording.as_ref().map(|r| {
        let p = r.pipeline.progress.lock().unwrap().clone();
        RecordingStatus {
            seconds: p.seconds,
            bytes: p.bytes,
            path: r.mp4.to_string_lossy().into_owned(),
            has_audio: r.has_audio,
        }
    });
    let replay = match &s.replay {
        Some(r) => {
            let list = tokio::fs::read_to_string(r.dir.join("list.csv"))
                .await
                .unwrap_or_default();
            // Son kayıttan beri geçen süre (kayıt yoksa biriken parçalar).
            let buffered = match r.saved_at {
                Some(at) => at.elapsed().as_secs_f64(),
                None => replay::buffered_seconds(&replay::parse_list(&list)),
            };
            Some(ReplayStatus {
                buffered_seconds: buffered.min(r.seconds as f64),
                seconds: r.seconds,
                encoder: r.encoder.label(),
            })
        }
        None => None,
    };
    Status { recording, replay }
}

/// Kaynak seviyeleri (0–1, son okumadan beri tepe): sistem sesi, mikrofon
/// (açık olanlar sırasıyla). Kayıt sürüyorsa onun, yoksa anlık tekrarın.
fn take_levels(s: &Recorder) -> Vec<f32> {
    s.recording
        .as_ref()
        .map(|r| &r.pipeline)
        .or(s.replay.as_ref().map(|r| &r.pipeline))
        .map(Pipeline::take_levels)
        .unwrap_or_default()
}

#[tauri::command]
pub async fn recorder_status(app: AppHandle) -> Result<Status, AppError> {
    let s = state(&app).lock().await;
    Ok(snapshot(&s).await)
}

/// Ses seviyeleri bu aralıkla yayınlanır: gösterge akıcı görünsün (saniyede 20).
const LEVELS_MS: u64 = 50;
/// Durum (süre, boyut, arabellek) her bu kadar seviye turunda bir yayınlanır (500 ms).
const STATUS_EVERY: u32 = 10;

/// Etkin bir oturum varken seviyeleri saniyede 20, durumu yarım saniyede bir
/// yayınlar; kendiliğinden biten süreçleri toplar (kaydı kurtarır, anlık
/// tekrarı yeniden başlatır).
fn start_ticker(app: &AppHandle, s: &mut Recorder) {
    if s.ticker {
        return;
    }
    s.ticker = true;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut tick: u32 = 0;
        loop {
            tokio::time::sleep(Duration::from_millis(LEVELS_MS)).await;
            tick = tick.wrapping_add(1);
            if !tick.is_multiple_of(STATUS_EVERY) {
                // Yalnızca seviyeler: hafif, yalnızca ana pencereye (bilgi penceresi dinlemez).
                let levels = {
                    let s = state(&app).lock().await;
                    take_levels(&s)
                };
                let _ = app.emit_to("main", "recorder-levels", levels);
                continue;
            }
            let crashed_recording;
            let crashed_replay;
            let status;
            {
                let mut s = state(&app).lock().await;
                crashed_recording = if s
                    .recording
                    .as_ref()
                    .is_some_and(|r| r.pipeline.exit_status().is_some())
                {
                    s.recording.take()
                } else {
                    None
                };
                crashed_replay = if s
                    .replay
                    .as_ref()
                    .is_some_and(|r| r.pipeline.exit_status().is_some())
                {
                    s.replay.take()
                } else {
                    None
                };
                status = snapshot(&s).await;
                if s.recording.is_none() && s.replay.is_none() && crashed_replay.is_none() {
                    s.ticker = false;
                    let _ = app.emit("recorder-status", status);
                    if let Some(recording) = crashed_recording {
                        recover_recording(&app, recording).await;
                    }
                    return;
                }
            }
            let _ = app.emit("recorder-status", status);
            if let Some(recording) = crashed_recording {
                recover_recording(&app, recording).await;
            }
            if let Some(replay) = crashed_replay {
                restart_replay(&app, replay).await;
            }
        }
    });
}

/// Kayıt süreci kendiliğinden bitti (ör. ekran çözünürlüğü değişti): o ana kadar
/// yazılan kısım MP4'e aktarılıp kaydedilir.
async fn recover_recording(app: &AppHandle, recording: Recording) {
    let detail = recording.pipeline.stderr_tail();
    recording.pipeline.dispose().await;
    let _ = app.emit(
        "recorder-error",
        RecorderError {
            kind: "recording",
            message: "Kayıt beklenmedik biçimde durdu; o ana kadarki kısım kaydedildi.".into(),
            detail: Some(detail),
        },
    );
    let Ok(ffmpeg_dir) = ffmpeg::binary::ensure_ffmpeg(app).await else {
        return;
    };
    if tokio::fs::metadata(&recording.mkv)
        .await
        .is_ok_and(|m| m.len() > 0)
    {
        let path = finalize(
            &ffmpeg_dir.join("ffmpeg.exe"),
            &recording.mkv,
            &recording.mp4,
        )
        .await;
        let _ = app.emit(
            "recorder-saved",
            saved(&ffmpeg_dir, &path, "recording").await,
        );
    }
}

/// Anlık tekrar süreci düştüyse (ör. tam ekran oyuna geçişte ekran erişimi
/// kesildi) aynı ayarlarla yeniden başlatılır; art arda çok düşerse bırakılır.
async fn restart_replay(app: &AppHandle, replay: Replay) {
    let detail = replay.pipeline.stderr_tail();
    replay.pipeline.dispose().await;
    if replay.restarts >= MAX_REPLAY_RESTARTS {
        give_up_replay(app, &replay.dir, detail).await;
        return;
    }
    tokio::time::sleep(Duration::from_secs(1)).await;
    let Ok(ffmpeg_dir) = ffmpeg::binary::ensure_ffmpeg(app).await else {
        give_up_replay(app, &replay.dir, detail).await;
        return;
    };
    // Eski parçalar yeni oturumun zamanıyla karışmasın.
    let _ = tokio::fs::remove_dir_all(&replay.dir).await;
    let _ = tokio::fs::create_dir_all(&replay.dir).await;
    let started = start_replay_pipeline(
        &ffmpeg_dir.join("ffmpeg.exe"),
        &replay.options,
        replay.encoder,
        &replay.dir,
        replay.wrap,
    )
    .await;
    match started {
        Ok(pipeline) => {
            let mut s = state(app).lock().await;
            if s.replay.is_none() {
                s.replay = Some(Replay {
                    pipeline,
                    restarts: replay.restarts + 1,
                    // Yeni süreç yeni bir zaman çizgisi başlatır.
                    floor: 0.0,
                    saved_at: None,
                    ..replay
                });
                start_ticker(app, &mut s);
            } else {
                drop(s);
                pipeline.dispose().await;
            }
        }
        Err(e) => give_up_replay(app, &replay.dir, e.detail.unwrap_or(e.message)).await,
    }
}

async fn give_up_replay(app: &AppHandle, dir: &Path, detail: String) {
    let _ = tokio::fs::remove_dir_all(dir).await;
    let _ = app.emit(
        "recorder-error",
        RecorderError {
            kind: "replay",
            message: "Anlık tekrar durdu.".into(),
            detail: Some(detail),
        },
    );
}

/// Program kapanırken: kayıt düzgün kapatılıp MP4'e aktarılır, anlık tekrar bırakılır.
pub async fn shutdown(app: &AppHandle) {
    let (recording, replay) = {
        let mut s = state(app).lock().await;
        (s.recording.take(), s.replay.take())
    };
    if let Some(replay) = replay {
        let _ = replay.pipeline.stop().await;
        let _ = tokio::fs::remove_dir_all(&replay.dir).await;
    }
    if let Some(recording) = recording {
        let _ = recording.pipeline.stop().await;
        if let Ok(ffmpeg_dir) = ffmpeg::binary::ensure_ffmpeg(app).await {
            finalize(
                &ffmpeg_dir.join("ffmpeg.exe"),
                &recording.mkv,
                &recording.mp4,
            )
            .await;
        }
    }
}

#[tauri::command]
pub async fn recordings_list(
    app: AppHandle,
    dir: String,
) -> Result<Vec<library::RecordingFile>, AppError> {
    let ffmpeg_dir = ffmpeg::binary::ensure_ffmpeg(&app).await?;
    let (exclude, mut meta) = {
        let mut s = state(&app).lock().await;
        (
            s.recording.as_ref().map(|r| r.mkv.clone()),
            std::mem::take(&mut s.meta),
        )
    };
    let files = library::list(&ffmpeg_dir, Path::new(&dir), exclude.as_deref(), &mut meta).await;
    state(&app).lock().await.meta = meta;
    Ok(files)
}

#[tauri::command]
pub async fn recording_thumbnail(app: AppHandle, path: String) -> Result<Option<String>, AppError> {
    let ffmpeg_dir = ffmpeg::binary::ensure_ffmpeg(&app).await?;
    let cache = paths::cache_dir(&app, "recording-thumbs")?;
    Ok(library::thumbnail(&ffmpeg_dir, &cache, Path::new(&path)).await)
}

#[tauri::command]
pub async fn recording_delete(path: String, dir: String) -> Result<(), AppError> {
    let file = library::check_inside(Path::new(&path), Path::new(&dir))
        .map_err(|m| AppError::new(&m, None))?;
    tokio::task::spawn_blocking(move || library::move_to_trash(&file))
        .await
        .map_err(|e| AppError::new("Silinemedi.", Some(e.to_string())))?
        .map_err(|m| AppError::new("Silinemedi.", Some(m)))
}

#[tauri::command]
pub async fn recording_rename(path: String, dir: String, name: String) -> Result<String, AppError> {
    let file = library::check_inside(Path::new(&path), Path::new(&dir))
        .map_err(|m| AppError::new(&m, None))?;
    let ext = file
        .extension()
        .map(|e| e.to_string_lossy().into_owned())
        .unwrap_or_else(|| "mp4".into());
    let target = file.with_file_name(format!("{}.{ext}", sanitize_name(&name)));
    if target == file {
        return Ok(file.to_string_lossy().into_owned());
    }
    if target.exists() {
        return Err(AppError::coded(
            "nameTaken",
            "Bu adla bir kayıt zaten var.",
            None,
        ));
    }
    tokio::fs::rename(&file, &target)
        .await
        .map_err(|e| AppError::new("Yeniden adlandırılamadı.", Some(e.to_string())))?;
    Ok(target.to_string_lossy().into_owned())
}

/// Kaydın bir bölümünü alır (Discord'un klip kırpması gibi). Kesim tam istenen
/// karede olur (yeniden kodlanır). `overwrite`: özgün kayıt Geri Dönüşüm
/// Kutusu'na gider ve kırpılmış hâli onun adını alır; değilse yanına kopya yazılır.
#[tauri::command]
pub async fn recording_trim(
    app: AppHandle,
    path: String,
    dir: String,
    start: f64,
    end: f64,
    overwrite: bool,
) -> Result<String, AppError> {
    let file = library::check_inside(Path::new(&path), Path::new(&dir))
        .map_err(|m| AppError::new(&m, None))?;
    // NaN da reddedilir.
    let length_ok = (end - start).is_finite() && end - start >= 0.2;
    if !length_ok || start < 0.0 {
        return Err(AppError::new("Kırpılacak bölüm çok kısa.", None));
    }
    let ffmpeg_dir = ffmpeg::binary::ensure_ffmpeg(&app).await?;
    let parent = file.parent().unwrap_or(Path::new(&dir)).to_path_buf();
    let stem = file
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Kayıt".into());
    let output = if overwrite {
        parent.join(format!(".{stem}.kirpiliyor.mp4"))
    } else {
        jobs::unique_output_path(&parent, &format!("{stem} (kırpılmış)"), "mp4")
    };
    let args = ffmpeg::trim::build_args(
        &file.to_string_lossy(),
        &output.to_string_lossy(),
        start,
        end,
        true,
    );
    if let Err(detail) = pipeline::run_ffmpeg(&ffmpeg_dir.join("ffmpeg.exe"), args).await {
        let _ = tokio::fs::remove_file(&output).await;
        return Err(AppError::new("Kırpılamadı.", Some(detail)));
    }
    if !overwrite {
        return Ok(output.to_string_lossy().into_owned());
    }
    // Özgün dosya kalıcı silinmez: Geri Dönüşüm Kutusu'ndan geri alınabilir.
    let original = file.clone();
    tokio::task::spawn_blocking(move || library::move_to_trash(&original))
        .await
        .map_err(|e| AppError::new("Kırpılamadı.", Some(e.to_string())))?
        .map_err(|m| AppError::new("Özgün kayıt kaldırılamadı.", Some(m)))?;
    let target = file.with_extension("mp4");
    tokio::fs::rename(&output, &target)
        .await
        .map_err(|e| AppError::new("Kırpılan kayıt kaydedilemedi.", Some(e.to_string())))?;
    Ok(target.to_string_lossy().into_owned())
}

/// Yarım kalmış MKV kaydını MP4'e aktarır.
#[tauri::command]
pub async fn recording_repair(
    app: AppHandle,
    path: String,
    dir: String,
) -> Result<String, AppError> {
    let file = library::check_inside(Path::new(&path), Path::new(&dir))
        .map_err(|m| AppError::new(&m, None))?;
    let ffmpeg_dir = ffmpeg::binary::ensure_ffmpeg(&app).await?;
    let stem = file
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "kayit".into());
    let mp4 = jobs::unique_output_path(file.parent().unwrap_or(Path::new(&dir)), &stem, "mp4");
    let result = finalize(&ffmpeg_dir.join("ffmpeg.exe"), &file, &mp4).await;
    if result == file {
        return Err(AppError::coded(
            "repairFailed",
            "Kayıt onarılamadı; dosya bozuk olabilir.",
            None,
        ));
    }
    Ok(result.to_string_lossy().into_owned())
}

/// Varsayılan kayıt klasörü: Videolar\DownKit\<ad>.
#[tauri::command]
pub fn recorder_default_dir(app: AppHandle, folder: String) -> Result<String, AppError> {
    let videos = app
        .path()
        .video_dir()
        .map_err(|e| AppError::new("Videolar klasörü bulunamadı.", Some(e.to_string())))?;
    Ok(videos
        .join("DownKit")
        .join(sanitize_name(&folder))
        .to_string_lossy()
        .into_owned())
}
