//! Mikrofon gürültü engelleme: RNNoise'un saf Rust kopyası (`nnnoiseless`, BSD-3).
//! Fan, klavye, uğultu gibi sürekli sesleri bastırır, konuşmayı bırakır.
//!
//! RNNoise 48 kHz mono, 480 örneklik (10 ms) kareler işler. Yakalama paketleri
//! bu boyda gelmediği için artan kısım bir sonraki pakete saklanır; bu yüzden
//! çıktı girdinin gerisinde kalır ve kaç kare geride olduğu da döndürülür.

use nnnoiseless::DenoiseState;

const FRAME: usize = DenoiseState::FRAME_SIZE;
/// RNNoise örnekleri −1…1 değil i16 aralığında bekler.
const SCALE: f32 = 32767.0;
/// Konuşma yokken kalan gürültü bu kazançla kısılır (≈ −26 dB).
const QUIET_GAIN: f32 = 0.05;
/// Kapı son bu kadar karenin (10 ms'lik) en düşük konuşma olasılığına bakar:
/// RNNoise klavye tıkırtısında 1-2 kare "konuşma" der, bu kareler kapıyı açamaz;
/// sürekli konuşma ise 30 ms içinde açar. Ölçüm (Windows TTS konuşması + yapay
/// gürültü, 2026-09-27; eski kapıya göre): klavye −14 → −30 dB, fan −57 → −61 dB,
/// uğultu −46 → −50 dB; konuşma kaybı 1,5 dB'in altında (çok kısık mikrofonda bile).
const VOICE_WINDOW: usize = 3;
/// Kapının açılışı hızlı (konuşmanın başı kesilmesin), kapanışı yavaş (kare başına).
const GATE_ATTACK: f32 = 0.6;
const GATE_RELEASE: f32 = 0.08;

pub struct Denoiser {
    state: Box<DenoiseState<'static>>,
    /// Henüz tam kare olmamış mono örnekler.
    pending: Vec<f32>,
    /// Konuşma kapısının o anki kazancı.
    gain: f32,
    /// Son karelerin konuşma olasılıkları (halka).
    voices: [f32; VOICE_WINDOW],
    next_voice: usize,
}

/// Konuşma olasılığından kapı kazancı: belirgin konuşmada 1, sessizlikte QUIET_GAIN.
/// RNNoise konuşma olmayan hışırtıda da 0,2–0,4 verebildiği için kapı 0,45'ten
/// sonra açılmaya başlar (0,25'te başlayınca tıkırtılar arasında yarı açık kalıyordu).
fn gate_gain(voice: f32) -> f32 {
    let t = ((voice - 0.45) / 0.35).clamp(0.0, 1.0);
    QUIET_GAIN + (1.0 - QUIET_GAIN) * t
}

impl Default for Denoiser {
    fn default() -> Self {
        Denoiser {
            state: DenoiseState::new(),
            pending: Vec::with_capacity(FRAME * 2),
            gain: 1.0,
            voices: [0.0; VOICE_WINDOW],
            next_voice: 0,
        }
    }
}

impl Denoiser {
    /// 48 kHz stereo (LRLR) girer, gürültüsü alınmış stereo çıkar.
    /// Dönen ikinci değer: çıktının ilk karesi girdinin ilk karesinden kaç kare
    /// önceye denk gelir (önceki paketten kalan kısım).
    pub fn process(&mut self, stereo: &[f32]) -> (Vec<f32>, usize) {
        let delay = self.pending.len();
        self.pending.extend(
            stereo
                .as_chunks::<2>()
                .0
                .iter()
                .map(|[l, r]| (l + r) * 0.5 * SCALE),
        );
        let frames = self.pending.len() / FRAME;
        let mut out = Vec::with_capacity(frames * FRAME * 2);
        let mut cleaned = [0.0f32; FRAME];
        for chunk in self.pending[..frames * FRAME].chunks(FRAME) {
            // RNNoise gürültüyü bastırır ve karede konuşma olasılığını verir; konuşma
            // yokken kalan hışırtı yumuşak bir kapıyla ayrıca kısılır.
            let voice = self.state.process_frame(&mut cleaned, chunk);
            self.voices[self.next_voice] = voice;
            self.next_voice = (self.next_voice + 1) % VOICE_WINDOW;
            let target = gate_gain(self.voices.iter().copied().fold(1.0, f32::min));
            let rate = if target > self.gain {
                GATE_ATTACK
            } else {
                GATE_RELEASE
            };
            let from = self.gain;
            self.gain += (target - self.gain) * rate;
            let step = (self.gain - from) / FRAME as f32;
            out.extend(cleaned.iter().enumerate().flat_map(|(i, s)| {
                let v = (s / SCALE * (from + step * i as f32)).clamp(-1.0, 1.0);
                [v, v]
            }));
        }
        self.pending.drain(..frames * FRAME);
        (out, delay)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rms(samples: &[f32]) -> f32 {
        (samples.iter().map(|s| s * s).sum::<f32>() / samples.len().max(1) as f32).sqrt()
    }

    #[test]
    fn eksik_kare_sonraki_pakete_kalir() {
        let mut d = Denoiser::default();
        let (out, delay) = d.process(&vec![0.0; 300 * 2]);
        assert!(out.is_empty());
        assert_eq!(delay, 0);
        let (out, delay) = d.process(&vec![0.0; 300 * 2]);
        assert_eq!(out.len(), FRAME * 2);
        assert_eq!(delay, 300);
    }

    #[test]
    fn sessizlik_sessiz_kalir_ve_cikti_sinirli() {
        let mut d = Denoiser::default();
        let (out, _) = d.process(&vec![0.0; FRAME * 20 * 2]);
        assert_eq!(out.len(), FRAME * 20 * 2);
        assert!(rms(&out) < 1e-4);
        // Aşırı yüksek girdi de −1…1 dışına taşmaz.
        let loud: Vec<f32> = (0..FRAME * 10)
            .flat_map(|i| {
                let v = if i % 2 == 0 { 1.0 } else { -1.0 };
                [v, v]
            })
            .collect();
        let (out, _) = d.process(&loud);
        assert!(out.iter().all(|s| (-1.0..=1.0).contains(s)));
    }

    #[test]
    fn konusma_kapisi_konusmada_acik_sessizlikte_kisik() {
        assert_eq!(gate_gain(0.9), 1.0);
        assert!((gate_gain(0.05) - QUIET_GAIN).abs() < 1e-6);
        assert!((gate_gain(0.4) - QUIET_GAIN).abs() < 1e-6, "hışırtı düzeyi kapıyı açmaz");
        assert!(gate_gain(0.6) > QUIET_GAIN && gate_gain(0.6) < 1.0);
    }

    #[test]
    fn surekli_gurultu_belirgin_kisilir() {
        // Düşük seviyeli hışırtı (fan/bilgisayar gürültüsü ölçeğinde, ≈ −39 dBFS):
        // iki saniye beslendikten sonra kapı kapanmalı ve çıktı çok zayıf kalmalı.
        // Not: yüksek genlikli ya da saf sinüzoidal sinyaller RNNoise'ın nöral ağını
        // "içerik" sanmasına yol açar; burada gerçekçi arka plan gürültüsü sınanır.
        let mut d = Denoiser::default();
        let mut seed = 0x12345678u32;
        let mut noise = |n: usize| -> Vec<f32> {
            (0..n * 2)
                .map(|_| {
                    // xorshift: tekrarlanabilir, periyodik olmayan hışırtı.
                    seed ^= seed << 13;
                    seed ^= seed >> 17;
                    seed ^= seed << 5;
                    (seed as f32 / u32::MAX as f32 - 0.5) * 0.04
                })
                .collect()
        };
        // İlk iki saniye: model ısınır ve kapı kapanır.
        for _ in 0..20 {
            d.process(&noise(FRAME * 10));
        }
        let mut tail = Vec::new();
        for _ in 0..5 {
            let (out, _) = d.process(&noise(FRAME * 10));
            tail.extend(out);
        }
        let output_rms = rms(&tail);
        // Girdi ≈ 0,0115 RMS; bastırma işliyorsa çıktı bunun yarısından az olmalı.
        assert!(
            output_rms < 0.006,
            "gürültü yeterince kısılmadı: çıktı {output_rms}, kapı kazancı {}",
            d.gain
        );
    }

    #[test]
    fn klavye_tikirtisi_kapiyi_acamaz() {
        // 150 ms arayla 5 ms'lik yüksek tıkırtılar; aralarda gerçek mikrofonlardaki
        // gibi çok hafif, alçak frekanslı (kahverengi) hışırtı.
        let mut d = Denoiser::default();
        let mut seed = 0x9e37_79b9u32;
        let mut brown = 0.0f32;
        let mut clicks = |n: usize, offset: usize| -> Vec<f32> {
            (0..n)
                .flat_map(|i| {
                    seed ^= seed << 13;
                    seed ^= seed >> 17;
                    seed ^= seed << 5;
                    let white = seed as f32 / u32::MAX as f32 - 0.5;
                    brown = (brown + white * 0.1) * 0.995;
                    let phase = (i + offset) % 7200;
                    let v = if phase < 240 {
                        white * 0.3 * (1.0 - phase as f32 / 240.0)
                    } else {
                        brown * 0.002
                    };
                    [v, v]
                })
                .collect()
        };
        for k in 0..20 {
            d.process(&clicks(FRAME * 10, k * FRAME * 10));
        }
        let mut input = Vec::new();
        let mut output = Vec::new();
        for k in 20..40 {
            let chunk = clicks(FRAME * 10, k * FRAME * 10);
            let (out, _) = d.process(&chunk);
            input.extend(chunk);
            output.extend(out);
        }
        // En az −20 dB (ölçümde −30 dB); tıkırtı kapıyı açmamalı.
        assert!(
            rms(&output) < rms(&input) * 0.1,
            "tıkırtı yeterince kısılmadı: girdi {}, çıktı {}",
            rms(&input),
            rms(&output)
        );
    }
}

