//! Tek bir kayıt süreci: FFmpeg ekranı yakalayıp kodlar, ses Rust'taki
//! karıştırıcıdan adlandırılmış boru (named pipe) ile gelir. Durdurma FFmpeg'e
//! `q` yazılarak yapılır ki dosya düzgün kapansın.

use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::io::{AsyncWriteExt, BufReader};
use tokio::net::windows::named_pipe::ServerOptions;
use tokio::process::{ChildStdin, Command};
use tokio::sync::{oneshot, watch};
use uuid::Uuid;

use super::audio::{self, now_ticks, Capture, Endpoint};
use super::mixer::{self, ticks_to_frames, Mixer, Ticks};
use super::sources::redraw_window;
use crate::jobs;

/// Paketlerin yakalanıp karıştırıcıya ulaşması için beklenen süre (100 ns).
/// Bu kadar geriden yazılır ki geç gelen paket sessizliğe dönüşmesin.
const MARGIN: Ticks = 800_000;
/// Sesin görüntüye göre öne alınması (100 ns). Ölçüm (her saniye beyaz yanıp
/// bip çalan pencere, 6 olay): ekran yakalamada ses 14–24 ms, pencere
/// yakalamada 39–55 ms sonra (tarayıcının ~48 ms ses gecikmesi dahil). İkisi
/// de fark edilme eşiğinin altında; düzeltme gerekmedi.
pub const AUDIO_LEAD: Ticks = 0;

#[derive(Debug, Clone, Default)]
pub struct AudioPlan {
    /// Sistem sesi: çıkış aygıtı (yoksa varsayılan) ve kazancı (1 = olduğu gibi).
    pub system: Option<(Option<String>, f32)>,
    /// Mikrofon: aygıt (yoksa varsayılan), kazanç ve gürültü engelleme.
    pub microphone: Option<(Option<String>, f32, bool)>,
}

impl AudioPlan {
    fn is_empty(&self) -> bool {
        self.system.is_none() && self.microphone.is_none()
    }
}

#[derive(Debug, Clone, Default)]
pub struct Progress {
    /// Kaydedilen süre.
    pub seconds: f64,
    pub bytes: u64,
}

pub struct Pipeline {
    stdin: Option<ChildStdin>,
    exited: watch::Receiver<Option<bool>>,
    kill: Option<oneshot::Sender<()>>,
    audio_stop: Arc<AtomicBool>,
    writer: Option<tokio::task::JoinHandle<()>>,
    captures: Vec<Capture>,
    mixer: Option<Arc<Mutex<Mixer>>>,
    pub progress: Arc<Mutex<Progress>>,
    stderr: Arc<Mutex<String>>,
}

impl Pipeline {
    /// `build` boru adını (ses varsa) alıp FFmpeg argümanlarını döndürür.
    /// `nudge`: pencere yakalamasında pencerenin tutamacı; kare akışı durursa
    /// pencereye yeniden çizim isteği gönderilir.
    pub async fn start(
        ffmpeg: &Path,
        build: impl FnOnce(Option<&str>) -> Vec<String>,
        audio_plan: AudioPlan,
        nudge: Option<u64>,
    ) -> Result<Pipeline, String> {
        let origin = now_ticks();
        let mut captures = Vec::new();
        let mixer = if audio_plan.is_empty() {
            None
        } else {
            let mixer = Arc::new(Mutex::new(Mixer::default()));
            if let Some((device, gain)) = audio_plan.system.clone() {
                let track = mixer.lock().unwrap().add_track(gain);
                captures.push(audio::start(
                    Endpoint::System(device),
                    mixer.clone(),
                    track,
                    origin,
                    false,
                ));
            }
            if let Some((device, gain, denoise)) = audio_plan.microphone.clone() {
                let track = mixer.lock().unwrap().add_track(gain);
                captures.push(audio::start(
                    Endpoint::Microphone(device),
                    mixer.clone(),
                    track,
                    origin,
                    denoise,
                ));
            }
            Some(mixer)
        };

        let pipe_name = format!(r"\\.\pipe\downkit-rec-{}", Uuid::new_v4().simple());
        let server = match &mixer {
            Some(_) => Some(
                ServerOptions::new()
                    .first_pipe_instance(true)
                    .access_inbound(false)
                    .out_buffer_size(1 << 16)
                    .create(&pipe_name)
                    .map_err(|e| format!("Ses borusu açılamadı: {e}"))?,
            ),
            None => None,
        };

        let args = build(server.as_ref().map(|_| pipe_name.as_str()));
        let mut command = Command::new(ffmpeg);
        command
            .args(&args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        jobs::hide_console(&mut command);
        let mut child = command
            .spawn()
            .map_err(|e| format!("FFmpeg başlatılamadı: {e}"))?;
        if let Some(pid) = child.id() {
            crate::process_guard::attach(pid);
        }
        let stdin = child.stdin.take();
        let stdout = child.stdout.take().expect("stdout piped");
        let stderr_pipe = child.stderr.take().expect("stderr piped");

        let progress = Arc::new(Mutex::new(Progress::default()));
        let progress_task = progress.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            let mut buf = Vec::new();
            while let Some(line) = jobs::read_line_lossy(&mut reader, &mut buf).await {
                let Some((key, value)) = line.trim().split_once('=') else {
                    continue;
                };
                let mut p = progress_task.lock().unwrap();
                match key {
                    "out_time_us" => {
                        if let Ok(us) = value.parse::<i64>() {
                            p.seconds = us.max(0) as f64 / 1_000_000.0;
                        }
                    }
                    "total_size" => {
                        if let Ok(bytes) = value.parse::<u64>() {
                            p.bytes = bytes;
                        }
                    }
                    _ => {}
                }
            }
        });

        let stderr = Arc::new(Mutex::new(String::new()));
        let stderr_task = stderr.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr_pipe);
            let mut buf = Vec::new();
            while let Some(line) = jobs::read_line_lossy(&mut reader, &mut buf).await {
                jobs::push_tail(&mut stderr_task.lock().unwrap(), &line);
            }
        });

        let (exit_tx, exited) = watch::channel(None);
        let (kill_tx, kill_rx) = oneshot::channel::<()>();
        tokio::spawn(async move {
            let success = tokio::select! {
                status = child.wait() => status.map(|s| s.success()).unwrap_or(false),
                _ = kill_rx => {
                    let _ = child.kill().await;
                    false
                }
            };
            let _ = exit_tx.send(Some(success));
        });

        if let Some(hwnd) = nudge {
            let (progress, mut exited) = (progress.clone(), exited.clone());
            tokio::spawn(async move {
                let mut last = -1.0;
                let mut stale = 0;
                loop {
                    tokio::select! {
                        _ = exited.wait_for(Option::is_some) => return,
                        _ = tokio::time::sleep(Duration::from_millis(250)) => {}
                    }
                    let now = progress.lock().unwrap().seconds;
                    stale = if now > last { 0 } else { stale + 1 };
                    last = now;
                    // Başlangıçta sık, sonra kare akışı 1 sn durduğunda.
                    if now <= 0.0 || stale >= 4 {
                        redraw_window(hwnd);
                        stale = 0;
                    }
                }
            });
        }

        let audio_stop = Arc::new(AtomicBool::new(false));
        let writer = match (server, &mixer) {
            (Some(server), Some(mixer)) => {
                let (mixer, stop) = (mixer.clone(), audio_stop.clone());
                Some(tokio::spawn(async move {
                    write_audio(server, mixer, origin, stop).await;
                }))
            }
            _ => None,
        };

        Ok(Pipeline {
            stdin,
            exited,
            kill: Some(kill_tx),
            audio_stop,
            writer,
            captures,
            mixer,
            progress,
            stderr,
        })
    }

    /// Süreç kendiliğinden bittiyse (hata ya da ekran erişimi kesildi) sonucu.
    pub fn exit_status(&self) -> Option<bool> {
        *self.exited.borrow()
    }

    pub fn stderr_tail(&self) -> String {
        self.stderr.lock().unwrap().clone()
    }

    /// Kaynakların son seviyeleri (0–1): sistem sesi, mikrofon sırasıyla.
    pub fn take_levels(&self) -> Vec<f32> {
        self.mixer
            .as_ref()
            .map(|m| m.lock().unwrap().take_peaks())
            .unwrap_or_default()
    }

    /// Düzgün durdurur: FFmpeg dosyayı kapatır. Başarılıysa Ok.
    pub async fn stop(mut self) -> Result<(), String> {
        if let Some(mut stdin) = self.stdin.take() {
            let _ = stdin.write_all(b"q").await;
            let _ = stdin.flush().await;
        }
        let mut exited = self.exited.clone();
        let finished =
            tokio::time::timeout(Duration::from_secs(15), exited.wait_for(Option::is_some))
                .await
                .is_ok();
        if !finished {
            if let Some(kill) = self.kill.take() {
                let _ = kill.send(());
            }
            let _ = tokio::time::timeout(Duration::from_secs(5), exited.wait_for(Option::is_some))
                .await;
        }
        let success = self.exit_status() == Some(true);
        let tail = self.stderr_tail();
        self.shutdown_audio().await;
        if success {
            Ok(())
        } else {
            Err(tail)
        }
    }

    /// Kendiliğinden bitmiş sürecin kalıntılarını (ses yakalama) kapatır.
    pub async fn dispose(mut self) {
        if let Some(kill) = self.kill.take() {
            let _ = kill.send(());
        }
        self.shutdown_audio().await;
    }

    async fn shutdown_audio(&mut self) {
        self.audio_stop.store(true, Ordering::SeqCst);
        if let Some(writer) = self.writer.take() {
            writer.abort();
        }
        let captures = std::mem::take(&mut self.captures);
        // Yakalama iş parçacıkları katılırken çalışma zamanı bloklanmasın.
        let _ = tokio::task::spawn_blocking(move || drop(captures)).await;
    }
}

/// FFmpeg boruya bağlanınca karışımı gerçek zamanlı yazar. Her 10 ms'de saatin
/// gösterdiği ana kadar (paket gecikmesi payı bırakılarak) örnek üretilir.
async fn write_audio(
    mut server: tokio::net::windows::named_pipe::NamedPipeServer,
    mixer: Arc<Mutex<Mixer>>,
    origin: Ticks,
    stop: Arc<AtomicBool>,
) {
    let connected = tokio::time::timeout(Duration::from_secs(30), server.connect()).await;
    if !matches!(connected, Ok(Ok(()))) {
        return;
    }
    // Sesin ilk örneği bu ana denk gelir; yazmaya ise MARGIN kadar sonra başlanır.
    let start = now_ticks() - AUDIO_LEAD;
    mixer
        .lock()
        .unwrap()
        .set_start(ticks_to_frames(start - origin));
    let mut interval = tokio::time::interval(Duration::from_millis(10));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        interval.tick().await;
        if stop.load(Ordering::SeqCst) {
            break;
        }
        let until = ticks_to_frames(now_ticks() - origin - MARGIN);
        let bytes = {
            let pcm = mixer.lock().unwrap().render(until);
            mixer::to_bytes(&pcm)
        };
        if bytes.is_empty() {
            continue;
        }
        if server.write_all(&bytes).await.is_err() {
            break;
        }
    }
}

/// Yakalama + kodlayıcıyı tek karelik bir denemeyle sınar.
pub async fn probe(ffmpeg: &Path, args: Vec<String>, nudge: Option<u64>) -> bool {
    let mut command = Command::new(ffmpeg);
    command
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    jobs::hide_console(&mut command);
    let Ok(mut child) = command.spawn() else {
        return false;
    };
    let wait = async {
        loop {
            tokio::select! {
                status = child.wait() => return status.map(|s| s.success()).unwrap_or(false),
                _ = tokio::time::sleep(Duration::from_millis(300)) => {
                    if let Some(hwnd) = nudge {
                        redraw_window(hwnd);
                    }
                }
            }
        }
    };
    tokio::time::timeout(Duration::from_secs(15), wait)
        .await
        .unwrap_or(false)
}

/// Kısa bir FFmpeg işi (aktarma, birleştirme, küçük resim). Hata metnini döner.
pub async fn run_ffmpeg(ffmpeg: &Path, args: Vec<String>) -> Result<(), String> {
    let mut command = Command::new(ffmpeg);
    command
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    jobs::hide_console(&mut command);
    let output = command
        .output()
        .await
        .map_err(|e| format!("FFmpeg başlatılamadı: {e}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).into_owned())
    }
}
