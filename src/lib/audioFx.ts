// Ses onarım asistanı: konuşma ya da müzik için gürültü, rüzgâr, yankı azaltma ve
// iyileştirme. Dışa aktarmada FFmpeg süzgeçlerine (Rust `ffmpeg::edit::AudioFx`)
// çevrilir; önce/sonra dinlemesi aynı süzgeçlerle kısa bir WAV üretir. Saf fonksiyonlar.

export interface AudioFx {
  /** Müzik modu (yoksa konuşma). */
  music: boolean;
  /** 0–1: sürekli gürültü (fan, uğultu, cızırtı). */
  noise: number;
  wind: boolean;
  /** 0–1: oda yankısı. */
  echo: number;
  enhance: boolean;
  /** Eşitleyici kazançları (dB, −12…12): bas, orta, tiz. */
  low?: number;
  mid?: number;
  high?: number;
  /** 0–1: sıkıştırıcı. */
  compress?: number;
  /** Tepe sınırlayıcı (−1 dBFS). */
  limit?: boolean;
}

/** Eşitleyici kazancı sınırı (dB). */
export const EQ_LIMIT = 12;

/** Sosyal medya için hedef ses seviyesi (LUFS). */
export const SOCIAL_LUFS = -14;

/** Hazır ayarlar: tek tıkla konuşma ya da müzik onarımı. */
export const AUDIO_FX_PRESETS: Record<"speech" | "music", AudioFx> = {
  speech: { music: false, noise: 0.5, wind: true, echo: 0.3, enhance: true },
  music: { music: true, noise: 0.2, wind: false, echo: 0, enhance: true },
};

const amount = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.round(Math.min(1, Math.max(0, v)) * 100) / 100
    : 0;

const gain = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.round(Math.min(EQ_LIMIT, Math.max(-EQ_LIMIT, v)) * 2) / 2
    : 0;

/** Geçerli ayar; hiçbir şey açık değilse undefined. */
export function normalizeAudioFx(raw: unknown): AudioFx | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const fx: AudioFx = {
    music: r.music === true,
    noise: amount(r.noise),
    wind: r.wind === true,
    echo: amount(r.echo),
    enhance: r.enhance === true,
  };
  // Eşitleyici ve dinamik yalnız açıksa yazılır (eski projeler aynı kalsın).
  for (const key of ["low", "mid", "high"] as const) {
    const v = gain(r[key]);
    if (v !== 0) fx[key] = v;
  }
  const compress = amount(r.compress);
  if (compress > 0) fx.compress = compress;
  if (r.limit === true) fx.limit = true;
  const extra = fx.low || fx.mid || fx.high || fx.compress || fx.limit;
  return fx.noise > 0 || fx.wind || fx.echo > 0 || fx.enhance || extra ? fx : undefined;
}
