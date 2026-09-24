export type CompressMode = "targetSize" | "preset";
export type CompressPreset = "high" | "balanced" | "small";

export interface CompressRequest {
  inputPath: string;
  destinationDir: string;
  mode: CompressMode;
  targetSizeMb: number | null;
  preset: CompressPreset | null;
}

// Bu dosyadaki hesaplar Rust `ffmpeg::compress` ile aynıdır — burada yalnızca
// kullanıcıya önizleme (tahmini boyut, çıkacak çözünürlük) göstermek için.

const MIN_VIDEO_BITRATE_KBPS = 150;
const TARGET_SAFETY = 0.95;

/** Seviyelerin çözünürlük sınırı (kısa kenar): "Küçük dosya" 720p'ye iner. */
export const PRESET_MAX_SHORT_SIDE: Record<CompressPreset, number> = {
  high: 1080,
  balanced: 1080,
  small: 720,
};

export interface TargetPlan {
  videoKbps: number;
  audioKbps: number;
  maxShortSide: number;
}

/** Hedef boyut için bit hızı bütçesi; bütçe düştükçe ses ve çözünürlük de düşer. */
export function targetPlan(targetSizeBytes: number, durationSeconds: number): TargetPlan {
  if (durationSeconds <= 0) {
    return { videoKbps: MIN_VIDEO_BITRATE_KBPS, audioKbps: 64, maxShortSide: 360 };
  }
  const totalKbps = (((targetSizeBytes * 8) / 1000) * TARGET_SAFETY) / durationSeconds;
  const audioKbps = totalKbps < 600 ? 64 : totalKbps < 1500 ? 96 : 128;
  const videoKbps = Math.max(Math.round(totalKbps - audioKbps), MIN_VIDEO_BITRATE_KBPS);
  const maxShortSide =
    videoKbps >= 2500 ? 1080 : videoKbps >= 1200 ? 720 : videoKbps >= 600 ? 480 : 360;
  return { videoKbps, audioKbps, maxShortSide };
}

export function estimateOutputSizeBytes(plan: TargetPlan, durationSeconds: number): number {
  return Math.round((((plan.videoKbps + plan.audioKbps) * 1000) / 8) * durationSeconds);
}

/** Kısa kenar sınırı aşılıyorsa küçültülmüş boyut; aşılmıyorsa null (büyütülmez). */
export function scaledSize(
  width: number,
  height: number,
  maxShortSide: number,
): { width: number; height: number } | null {
  const short = Math.min(width, height);
  if (short === 0 || short <= maxShortSide) return null;
  const ratio = maxShortSide / short;
  const even = (v: number) => Math.max(2, Math.round((v * ratio) / 2) * 2);
  return { width: even(width), height: even(height) };
}

/** "1920×1080" → "1080p" gibi kısa gösterim (kısa kenar). */
export function resolutionLabel(width: number, height: number): string {
  return `${Math.min(width, height)}p`;
}
