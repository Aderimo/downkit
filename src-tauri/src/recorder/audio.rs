//! Windows ses yakalama (WASAPI). Sistem sesi "loopback" ile yakalanır: hoparlöre
//! giden karışım, sanal ses aygıtı ya da "Stereo Karışım" gerekmeden. Mikrofon
//! doğrudan. Her paket, aygıtın verdiği QPC zaman damgasıyla karıştırıcıya gider.
//!
//! Varsayılan aygıt değişirse (ör. kulaklık takıldı) yakalama yeni aygıtla
//! kendiliğinden yeniden başlar.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde::Serialize;
use windows::core::{HSTRING, PWSTR};
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Media::Audio::{
    eCapture, eConsole, eRender, EDataFlow, IAudioCaptureClient, IAudioClient, IMMDevice,
    IMMDeviceEnumerator, MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_LOOPBACK, DEVICE_STATE_ACTIVE, WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
};
use windows::Win32::Media::KernelStreaming::WAVE_FORMAT_EXTENSIBLE;
use windows::Win32::Media::Multimedia::{KSDATAFORMAT_SUBTYPE_IEEE_FLOAT, WAVE_FORMAT_IEEE_FLOAT};
use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
    COINIT_MULTITHREADED, STGM_READ,
};
use windows::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};

use super::denoise::Denoiser;
use super::mixer::{decode, ticks_to_frames, to_stereo, Mixer, Resampler, Ticks, TICKS_PER_SEC};

/// WASAPI'nin paket zamanıyla aynı saat (QPC, 100 ns birim).
pub fn now_ticks() -> Ticks {
    static FREQ: OnceLock<i64> = OnceLock::new();
    let freq = *FREQ.get_or_init(|| {
        let mut f = 0i64;
        let _ = unsafe { QueryPerformanceFrequency(&mut f) };
        f.max(1)
    });
    let mut counter = 0i64;
    let _ = unsafe { QueryPerformanceCounter(&mut counter) };
    (counter as i128 * TICKS_PER_SEC as i128 / freq as i128) as i64
}

/// İş parçacığında COM'u açar, kapanırken kapatır.
struct Com(bool);

impl Com {
    fn init() -> Com {
        Com(unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok())
    }
}

impl Drop for Com {
    fn drop(&mut self) {
        if self.0 {
            unsafe { CoUninitialize() };
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

fn enumerator() -> windows::core::Result<IMMDeviceEnumerator> {
    unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
}

fn take_pwstr(p: PWSTR) -> Option<String> {
    if p.is_null() {
        return None;
    }
    let text = unsafe { p.to_string() }.ok();
    unsafe { CoTaskMemFree(Some(p.0 as *const _)) };
    text
}

fn device_id(device: &IMMDevice) -> Option<String> {
    take_pwstr(unsafe { device.GetId() }.ok()?)
}

fn device_name(device: &IMMDevice) -> Option<String> {
    unsafe {
        let store = device.OpenPropertyStore(STGM_READ).ok()?;
        let value = store.GetValue(&PKEY_Device_FriendlyName).ok()?;
        take_pwstr(PropVariantToStringAlloc(&value).ok()?)
    }
}

fn default_id(enumerator: &IMMDeviceEnumerator, flow: EDataFlow) -> Option<String> {
    let device = unsafe { enumerator.GetDefaultAudioEndpoint(flow, eConsole) }.ok()?;
    device_id(&device)
}

/// Bağlı mikrofonlar (varsayılan işaretli).
pub fn list_microphones() -> Vec<AudioDevice> {
    list_devices(eCapture)
}

/// Bağlı hoparlör / kulaklık gibi çıkış aygıtları (sistem sesi bunlardan birinden alınır).
pub fn list_speakers() -> Vec<AudioDevice> {
    list_devices(eRender)
}

fn list_devices(flow: EDataFlow) -> Vec<AudioDevice> {
    let _com = Com::init();
    let Ok(enumerator) = enumerator() else {
        return Vec::new();
    };
    let default = default_id(&enumerator, flow);
    let Ok(collection) = (unsafe { enumerator.EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE) })
    else {
        return Vec::new();
    };
    let count = unsafe { collection.GetCount() }.unwrap_or(0);
    (0..count)
        .filter_map(|i| {
            let device = unsafe { collection.Item(i) }.ok()?;
            let id = device_id(&device)?;
            Some(AudioDevice {
                is_default: default.as_deref() == Some(id.as_str()),
                name: device_name(&device).unwrap_or_else(|| id.clone()),
                id,
            })
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq)]
pub enum Endpoint {
    /// Hoparlöre giden ses; kimlik yoksa Windows'un varsayılan çıkış aygıtı.
    System(Option<String>),
    /// Mikrofon; kimlik yoksa varsayılan.
    Microphone(Option<String>),
}

#[derive(Debug, Clone, Copy)]
struct Format {
    channels: usize,
    rate: u32,
    bits: u16,
    float: bool,
    block_align: usize,
}

unsafe fn read_format(ptr: *const WAVEFORMATEX) -> Format {
    let base = unsafe { std::ptr::read_unaligned(ptr) };
    let tag = base.wFormatTag as u32;
    let float = if tag == WAVE_FORMAT_EXTENSIBLE && base.cbSize >= 22 {
        let ext = unsafe { std::ptr::read_unaligned(ptr as *const WAVEFORMATEXTENSIBLE) };
        let sub = ext.SubFormat;
        sub == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT
    } else {
        tag == WAVE_FORMAT_IEEE_FLOAT
    };
    Format {
        channels: base.nChannels as usize,
        rate: base.nSamplesPerSec,
        bits: base.wBitsPerSample,
        float,
        block_align: base.nBlockAlign as usize,
    }
}

/// Çalışan bir yakalama; bırakılınca durur.
pub struct Capture {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Drop for Capture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// Yakalamayı başlatır; paketler `mixer`'daki `track`'e, `origin` anına göre
/// kare dizinleriyle yazılır. `denoise`: gürültü engelleme (mikrofonda).
pub fn start(
    endpoint: Endpoint,
    mixer: Arc<Mutex<Mixer>>,
    track: usize,
    origin: Ticks,
    denoise: bool,
) -> Capture {
    let stop = Arc::new(AtomicBool::new(false));
    let flag = stop.clone();
    let thread = std::thread::Builder::new()
        .name("downkit-audio".into())
        .spawn(move || {
            let _com = Com::init();
            while !flag.load(Ordering::SeqCst) {
                // Aygıt kaybolduysa ya da değiştiyse kısa bir bekleyişle yeniden bağlanır.
                if run(&endpoint, &mixer, track, origin, denoise, &flag).is_err() {
                    std::thread::sleep(Duration::from_millis(500));
                }
            }
        })
        .ok();
    Capture { stop, thread }
}

fn run(
    endpoint: &Endpoint,
    mixer: &Arc<Mutex<Mixer>>,
    track: usize,
    origin: Ticks,
    denoise: bool,
    stop: &AtomicBool,
) -> windows::core::Result<()> {
    let enumerator = enumerator()?;
    let (flow, device) = unsafe {
        match endpoint {
            Endpoint::System(Some(id)) => (eRender, enumerator.GetDevice(&HSTRING::from(id))?),
            Endpoint::System(None) => (
                eRender,
                enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?,
            ),
            Endpoint::Microphone(Some(id)) => (eCapture, enumerator.GetDevice(&HSTRING::from(id))?),
            Endpoint::Microphone(None) => (
                eCapture,
                enumerator.GetDefaultAudioEndpoint(eCapture, eConsole)?,
            ),
        }
    };
    // Varsayılan aygıtı izleyen yakalama, varsayılan değişince yeniden kurulur.
    let follows_default = matches!(
        endpoint,
        Endpoint::System(None) | Endpoint::Microphone(None)
    );
    let started_on = device_id(&device);

    let client: IAudioClient = unsafe { device.Activate(CLSCTX_ALL, None)? };
    let format_ptr = unsafe { client.GetMixFormat()? };
    let format = unsafe { read_format(format_ptr) };
    let flags = if flow == eRender {
        AUDCLNT_STREAMFLAGS_LOOPBACK
    } else {
        0
    };
    let init = unsafe {
        // 100 ms paylaşımlı arabellek.
        client.Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            flags,
            1_000_000,
            0,
            format_ptr,
            None,
        )
    };
    unsafe { CoTaskMemFree(Some(format_ptr as *const _)) };
    init?;
    let capture: IAudioCaptureClient = unsafe { client.GetService()? };
    unsafe { client.Start()? };

    let mut resampler = Resampler::new(format.rate);
    let mut denoiser = denoise.then(Denoiser::default);
    let mut last_check = Instant::now();
    let result = loop {
        if stop.load(Ordering::SeqCst) {
            break Ok(());
        }
        std::thread::sleep(Duration::from_millis(5));
        if let Err(e) = drain(
            &capture,
            format,
            &mut resampler,
            denoiser.as_mut(),
            mixer,
            track,
            origin,
        ) {
            break Err(e);
        }
        if follows_default && last_check.elapsed() > Duration::from_secs(2) {
            last_check = Instant::now();
            if default_id(&enumerator, flow) != started_on {
                break Err(windows::core::Error::from_hresult(windows::core::HRESULT(
                    0x88890004_u32 as i32,
                )));
            }
        }
    };
    unsafe {
        let _ = client.Stop();
    }
    result
}

fn drain(
    capture: &IAudioCaptureClient,
    format: Format,
    resampler: &mut Resampler,
    mut denoiser: Option<&mut Denoiser>,
    mixer: &Arc<Mutex<Mixer>>,
    track: usize,
    origin: Ticks,
) -> windows::core::Result<()> {
    loop {
        let packet = unsafe { capture.GetNextPacketSize()? };
        if packet == 0 {
            return Ok(());
        }
        let mut data: *mut u8 = std::ptr::null_mut();
        let mut frames = 0u32;
        let mut flags = 0u32;
        let mut qpc = 0u64;
        unsafe { capture.GetBuffer(&mut data, &mut frames, &mut flags, None, Some(&mut qpc))? };
        let silent = flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0;
        let samples = if silent || data.is_null() {
            vec![0.0; frames as usize * format.channels]
        } else {
            let bytes =
                unsafe { std::slice::from_raw_parts(data, frames as usize * format.block_align) };
            decode(bytes, format.bits, format.float)
        };
        unsafe { capture.ReleaseBuffer(frames)? };

        let stereo = to_stereo(&samples, format.channels);
        let out = resampler.process(&stereo);
        // Zaman damgası yoksa (bazı sürücüler) paket şimdiki zamana konur.
        let at = if qpc > 0 { qpc as i64 } else { now_ticks() };
        let frame = ticks_to_frames(at - origin);
        // Gürültü engelleme 10 ms'lik kareler işler: çıktı biraz geride kalır ve
        // o kadar önceki kareye yazılır.
        let (out, frame) = match denoiser.as_deref_mut() {
            Some(d) => {
                let (clean, delay) = d.process(&out);
                (clean, frame - delay as i64)
            }
            None => (out, frame),
        };
        if !out.is_empty() {
            if let Ok(mut m) = mixer.lock() {
                m.push(track, frame, &out);
            }
        }
    }
}
