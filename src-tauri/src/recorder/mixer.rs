//! Kayıt sesi: sistem sesi ve mikrofon ayrı iş parçacıklarında yakalanır, her
//! paket yakalandığı anın zaman damgasıyla gelir. Karıştırıcı paketleri ortak
//! saate göre yerine koyar (geç gelen paket kaymaz, sessizlik boşluğu sıfırla
//! dolar) ve FFmpeg'e sabit hızda (48 kHz, stereo, f32) akan tek bir ses üretir.
//! Hepsi saf hesap; Windows'a dokunan kısım `audio.rs` içinde.

use std::collections::VecDeque;

pub const RATE: u32 = 48_000;
pub const CHANNELS: usize = 2;

/// 100 ns birimli saat: WASAPI paket zaman damgası (QPC) ile aynı birim.
pub type Ticks = i64;
pub const TICKS_PER_SEC: i64 = 10_000_000;

/// Paket zamanlarındaki küçük oynamalar (bu kadar kareye kadar) yok sayılır,
/// yoksa her pakette araya sıfır girer ya da örnek atılırdı.
const JITTER_FRAMES: i64 = 480;
/// Bir kaynak yazılan konumun bu kadar önüne geçerse (saat kayması) fazlası atılır.
const MAX_AHEAD_FRAMES: i64 = RATE as i64 * 2;

pub fn ticks_to_frames(ticks: Ticks) -> i64 {
    (ticks as i128 * RATE as i128 / TICKS_PER_SEC as i128) as i64
}

#[cfg(test)]
fn frames_to_ticks(frames: i64) -> Ticks {
    (frames as i128 * TICKS_PER_SEC as i128 / RATE as i128) as Ticks
}

/// Bir kaynağın çıkış saatine yerleştirilmiş örnekleri (stereo, iç içe).
#[derive(Debug, Default)]
struct Track {
    gain: f32,
    /// `samples`'ın ilk karesinin çıkış akışındaki dizini.
    start: i64,
    samples: VecDeque<f32>,
    peak: f32,
}

impl Track {
    fn frames(&self) -> i64 {
        (self.samples.len() / CHANNELS) as i64
    }

    fn push(&mut self, frame: i64, data: &[f32]) {
        let count = (data.len() / CHANNELS) as i64;
        if count == 0 {
            return;
        }
        if self.samples.is_empty() {
            self.start = frame;
            self.samples.extend(data);
            return;
        }
        let expected = self.start + self.frames();
        let diff = frame - expected;
        if diff.abs() <= JITTER_FRAMES {
            self.samples.extend(data);
        } else if diff > 0 {
            // Kaynak bir süre sustu (ör. hiçbir şey çalmıyordu): arası sessizlik.
            self.samples
                .extend(std::iter::repeat_n(0.0, diff as usize * CHANNELS));
            self.samples.extend(data);
        } else {
            // Paket zaten yazılmış bir aralıkla örtüşüyor: örtüşen baş kısmı atılır.
            let skip = (-diff).min(count) as usize * CHANNELS;
            self.samples.extend(&data[skip..]);
        }
    }

    /// `[from, from + out.len()/2)` aralığını `out`'a ekler ve o kısmı tüketir.
    fn mix_into(&mut self, from: i64, out: &mut [f32]) {
        let wanted = (out.len() / CHANNELS) as i64;
        // Yazılan konumdan eskiler artık çalınamaz.
        if self.start < from {
            let stale = (from - self.start).min(self.frames());
            self.samples.drain(..stale as usize * CHANNELS);
            self.start = from;
        }
        if self.samples.is_empty() {
            self.start = from;
            return;
        }
        let offset = self.start - from;
        if offset >= wanted {
            return;
        }
        let take = (wanted - offset).min(self.frames());
        let begin = offset as usize * CHANNELS;
        for (i, sample) in self.samples.drain(..take as usize * CHANNELS).enumerate() {
            let value = sample * self.gain;
            self.peak = self.peak.max(value.abs());
            out[begin + i] += value;
        }
        self.start += take;
    }

    /// Saat kayması birikmesin: yazılan konumun çok önündeki fazlalık atılır.
    fn trim_ahead(&mut self, written: i64) {
        let limit = written + MAX_AHEAD_FRAMES;
        let end = self.start + self.frames();
        if end > limit {
            let excess = ((end - limit).min(self.frames())) as usize * CHANNELS;
            self.samples.drain(..excess);
            self.start += (excess / CHANNELS) as i64;
        }
    }
}

/// Kaynakları ortak saate göre karıştırır. `written`: FFmpeg'e yazılan son kare.
#[derive(Debug, Default)]
pub struct Mixer {
    tracks: Vec<Track>,
    written: i64,
}

impl Mixer {
    /// Yeni kaynak ekler; dönen dizin `push` için kullanılır.
    pub fn add_track(&mut self, gain: f32) -> usize {
        self.tracks.push(Track {
            gain,
            ..Track::default()
        });
        self.tracks.len() - 1
    }

    pub fn set_start(&mut self, frame: i64) {
        self.written = frame;
    }

    /// `frame`: paketin ilk karesinin çıkış akışındaki dizini.
    pub fn push(&mut self, track: usize, frame: i64, data: &[f32]) {
        if let Some(t) = self.tracks.get_mut(track) {
            t.push(frame, data);
            t.trim_ahead(self.written);
        }
    }

    /// `until` karesine kadar karışımı üretir (eksik yerler sessizlik).
    pub fn render(&mut self, until: i64) -> Vec<f32> {
        let frames = until - self.written;
        if frames <= 0 {
            return Vec::new();
        }
        let mut out = vec![0.0; frames as usize * CHANNELS];
        for track in &mut self.tracks {
            track.mix_into(self.written, &mut out);
        }
        for sample in &mut out {
            *sample = sample.clamp(-1.0, 1.0);
        }
        self.written = until;
        out
    }

    /// Son okumadan beri her kaynağın en yüksek seviyesi (seviye göstergesi için).
    pub fn take_peaks(&mut self) -> Vec<f32> {
        self.tracks
            .iter_mut()
            .map(|t| std::mem::take(&mut t.peak).min(1.0))
            .collect()
    }
}

/// Aygıtın örnek hızından 48 kHz'e doğrusal yeniden örnekleme (stereo, akış
/// hâlinde: paket sınırında önceki kare hatırlanır).
#[derive(Debug)]
pub struct Resampler {
    step: f64,
    pos: f64,
    prev: [f32; 2],
    primed: bool,
}

impl Resampler {
    pub fn new(from_rate: u32) -> Self {
        Resampler {
            step: from_rate.max(1) as f64 / RATE as f64,
            pos: 0.0,
            prev: [0.0; 2],
            primed: false,
        }
    }

    pub fn is_passthrough(&self) -> bool {
        (self.step - 1.0).abs() < 1e-9
    }

    pub fn process(&mut self, input: &[f32]) -> Vec<f32> {
        if self.is_passthrough() {
            return input.to_vec();
        }
        let frames = input.len() / CHANNELS;
        if frames == 0 {
            return Vec::new();
        }
        let mut data = input;
        if !self.primed {
            self.prev = [input[0], input[1]];
            self.primed = true;
            data = &input[CHANNELS..];
        }
        let n = data.len() / CHANNELS;
        // c[0] = önceki kare, c[k] = data'nın (k-1). karesi.
        let frame = |k: usize| -> [f32; 2] {
            if k == 0 {
                self.prev
            } else {
                [data[(k - 1) * 2], data[(k - 1) * 2 + 1]]
            }
        };
        let mut out = Vec::with_capacity(((n as f64 / self.step) as usize + 2) * CHANNELS);
        let mut p = self.pos;
        while p < n as f64 {
            let i = p.floor() as usize;
            let t = (p - i as f64) as f32;
            let (a, b) = (frame(i), frame(i + 1));
            out.push(a[0] + (b[0] - a[0]) * t);
            out.push(a[1] + (b[1] - a[1]) * t);
            p += self.step;
        }
        self.pos = p - n as f64;
        if n > 0 {
            self.prev = frame(n);
        }
        out
    }
}

/// Aygıtın kanal düzenini stereoya çevirir. Çok kanallıda orta kanal iki yana,
/// arka kanallar yarım güçte eklenir (5.1/7.1 hoparlör kurulumu).
pub fn to_stereo(data: &[f32], channels: usize) -> Vec<f32> {
    match channels {
        0 => Vec::new(),
        1 => data.iter().flat_map(|&s| [s, s]).collect(),
        2 => data.to_vec(),
        _ => data
            .chunks_exact(channels)
            .flat_map(|f| {
                let center = f.get(2).copied().unwrap_or(0.0) * 0.707;
                let (back_l, back_r) = if channels >= 6 {
                    (f[4] * 0.5, f[5] * 0.5)
                } else {
                    (0.0, 0.0)
                };
                [f[0] + center + back_l, f[1] + center + back_r]
            })
            .collect(),
    }
}

/// Aygıtın örnek biçimini f32'ye çevirir: 32 bit kayan nokta ya da 16/24/32 bit tam sayı.
pub fn decode(bytes: &[u8], bits: u16, float: bool) -> Vec<f32> {
    match (bits, float) {
        (32, true) => bytes
            .as_chunks::<4>()
            .0
            .iter()
            .map(|b| f32::from_le_bytes(*b))
            .collect(),
        (16, false) => bytes
            .as_chunks::<2>()
            .0
            .iter()
            .map(|b| i16::from_le_bytes(*b) as f32 / 32_768.0)
            .collect(),
        (24, false) => bytes
            .as_chunks::<3>()
            .0
            .iter()
            .map(|b| (i32::from_le_bytes([0, b[0], b[1], b[2]]) >> 8) as f32 / 8_388_608.0)
            .collect(),
        (32, false) => bytes
            .as_chunks::<4>()
            .0
            .iter()
            .map(|b| i32::from_le_bytes(*b) as f32 / 2_147_483_648.0)
            .collect(),
        _ => Vec::new(),
    }
}

/// FFmpeg'e yazılacak ham bayt (f32, little-endian).
pub fn to_bytes(samples: &[f32]) -> Vec<u8> {
    samples.iter().flat_map(|s| s.to_le_bytes()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stereo(frames: usize, value: f32) -> Vec<f32> {
        vec![value; frames * CHANNELS]
    }

    #[test]
    fn paket_zamanina_gore_yerlesir_bosluk_sessizlikle_dolar() {
        let mut mixer = Mixer::default();
        let track = mixer.add_track(1.0);
        // 1000. karede başlayan 100 karelik paket.
        mixer.push(track, 1000, &stereo(100, 0.5));
        let out = mixer.render(1200);
        assert_eq!(out.len(), 1200 * CHANNELS);
        assert_eq!(out[999 * 2], 0.0);
        assert_eq!(out[1000 * 2], 0.5);
        assert_eq!(out[1099 * 2 + 1], 0.5);
        assert_eq!(out[1100 * 2], 0.0);
    }

    #[test]
    fn kucuk_zaman_oynamasi_bitisik_sayilir() {
        let mut mixer = Mixer::default();
        let track = mixer.add_track(1.0);
        mixer.push(track, 0, &stereo(480, 0.25));
        // Beklenen 480; 100 kare sonra gelse de araya boşluk girmez.
        mixer.push(track, 580, &stereo(480, 0.75));
        let out = mixer.render(960);
        assert_eq!(out[479 * 2], 0.25);
        assert_eq!(out[480 * 2], 0.75);
    }

    #[test]
    fn uzun_sessizlikten_sonra_gelen_paket_kendi_zamaninda_calar() {
        let mut mixer = Mixer::default();
        let track = mixer.add_track(1.0);
        mixer.push(track, 0, &stereo(100, 0.5));
        mixer.push(track, 48_000, &stereo(100, 0.5));
        let out = mixer.render(48_100);
        assert_eq!(out[24_000 * 2], 0.0);
        assert_eq!(out[48_000 * 2], 0.5);
    }

    #[test]
    fn yazilmis_araliga_gelen_eski_ornekler_atilir() {
        let mut mixer = Mixer::default();
        let track = mixer.add_track(1.0);
        let _ = mixer.render(1000);
        mixer.push(track, 900, &stereo(200, 0.5));
        let out = mixer.render(1200);
        // 900–999 zaten yazılmıştı; kalan 1000–1099 yerinde.
        assert_eq!(out.len(), 200 * CHANNELS);
        assert_eq!(out[0], 0.5);
        assert_eq!(out[99 * 2], 0.5);
        assert_eq!(out[100 * 2], 0.0);
    }

    #[test]
    fn kaynaklar_kazancla_toplanir_ve_kirpilir() {
        let mut mixer = Mixer::default();
        let system = mixer.add_track(1.0);
        let mic = mixer.add_track(0.5);
        mixer.push(system, 0, &stereo(10, 0.9));
        mixer.push(mic, 0, &stereo(10, 0.8));
        let out = mixer.render(10);
        assert!(out.iter().all(|&s| s == 1.0));
        let peaks = mixer.take_peaks();
        assert!((peaks[0] - 0.9).abs() < 1e-6 && (peaks[1] - 0.4).abs() < 1e-6);
        assert_eq!(mixer.take_peaks(), vec![0.0, 0.0]);
    }

    #[test]
    fn ornek_hizi_44100den_48000e_cevrilir() {
        let mut resampler = Resampler::new(44_100);
        let input: Vec<f32> = (0..4410).flat_map(|i| [i as f32, i as f32]).collect();
        let mut out = resampler.process(&input[..2000]);
        out.extend(resampler.process(&input[2000..]));
        let frames = out.len() / CHANNELS;
        // 0,1 saniye ≈ 4800 kare (sınırda ±1).
        assert!((4797..=4801).contains(&frames), "{frames}");
        // Doğrusal: çıktının k. karesi girişin k·44100/48000 konumu.
        let k = 3000;
        let expected = k as f32 * 44_100.0 / 48_000.0;
        assert!((out[k * 2] - expected).abs() < 0.01);
    }

    #[test]
    fn mono_ve_cok_kanalli_stereoya_cevrilir() {
        assert_eq!(to_stereo(&[0.1, 0.2], 1), vec![0.1, 0.1, 0.2, 0.2]);
        let six = [0.1, 0.2, 1.0, 0.0, 0.4, 0.6];
        let out = to_stereo(&six, 6);
        assert!((out[0] - (0.1 + 0.707 + 0.2)).abs() < 1e-6);
        assert!((out[1] - (0.2 + 0.707 + 0.3)).abs() < 1e-6);
    }

    #[test]
    fn tam_sayi_ornekler_f32ye_cevrilir() {
        assert_eq!(decode(&i16::MIN.to_le_bytes(), 16, false), vec![-1.0]);
        let s24 = [0x00, 0x00, 0x40]; // 0x400000 = yarım ölçek
        assert_eq!(decode(&s24, 24, false), vec![0.5]);
        assert_eq!(decode(&0.25f32.to_le_bytes(), 32, true), vec![0.25]);
    }

    #[test]
    fn saat_birimleri_karelere_cevrilir() {
        assert_eq!(ticks_to_frames(TICKS_PER_SEC), 48_000);
        assert_eq!(frames_to_ticks(24_000), TICKS_PER_SEC / 2);
    }
}
