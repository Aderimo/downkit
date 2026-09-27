import type { ClipLook } from "../lib/clipLook";
import type { LocalMediaInfo } from "./convert";
import type { TextOverlay } from "../lib/textItems";

/** Kaynaktan alınacak parça ve hızı (Rust `ffmpeg::edit::Clip`). */
export interface EditClip {
  /** `inputs` dizisindeki kaynağın sırası (yoksa 0 = ilk kaynak). */
  source?: number;
  start: number;
  end: number;
  speed: number;
  /** 0 = sessiz, 1 = olduğu gibi. */
  volume: number;
  /** Açılma / kararma (çıktı saniyesi). */
  fadeIn: number;
  fadeOut: number;
  /** Zaman çizelgesindeki boşluk: bu süre (end - start) siyah görüntü ve sessizlik. */
  black?: boolean;
  /** Filtre, renk ve efektler (Rust `Look`). */
  look?: ClipLook;
  fadeWhite?: boolean;
}

/** Rust `ffmpeg::edit::GifOptions`. */
export interface GifOptions {
  fps: number;
  /** En fazla bu genişlik (px); kaynak daha darsa büyütülmez. */
  width: number;
}

/** Rust `commands::edit::EditRequest` ile eşleşir. Kaynak ya yerel dosya
 * (`inputPath`) ya da link (`url`) olur. */
export interface EditRequest {
  inputPath: string | null;
  url: string | null;
  /** Çoklu kaynak: her girdi için dosya ya da link (sıra = kliplerdeki `source`).
   * Boşsa `inputPath`/`url` tek kaynak sayılır. */
  inputs?: { inputPath: string | null; url: string | null }[];
  /** Çıktıdaki sırayla. */
  clips: EditClip[];
  destinationDir: string;
  /** Uzantısız çıktı adı. */
  outputName: string;
  audioOnly: boolean;
  /** Ses: mp3 | m4a | wav | flac. Link kaynağında görüntü: mp4 | mkv | webm. */
  outputFormat: string | null;
  maxHeight: number | null;
  audioBitrateKbps: number | null;
  /** Yerel tek klipte tam karede kes (yeniden kodlar). */
  precise: boolean;
  rateLimitKbps?: number | null;
  /** Duraklat/sürdür boyunca aynı kalan anahtar (kuyruktaki iş kimliği). */
  workKey?: string;
  /** Verilirse çıktı sessiz, hareketli bir GIF olur. */
  gif?: GifOptions | null;
  /** Verilirse görüntü bu kareye kırpılır ya da sığdırılır (ör. dikey 9:16). */
  frame?: { width: number; height: number; fit: boolean; position: number } | null;
  /** Görüntüye yazılacak yazılar (zamanlar çıktı saniyesi). */
  texts?: TextOverlay[];
}

/** Rust `commands::editor::LocalPreview`. */
export interface LocalPreview {
  url: string;
  token: string;
  info: LocalMediaInfo;
}

export interface PreviewCopy {
  url: string;
  token: string;
}

export interface ThumbPayload {
  requestId: string;
  index: number;
  dataUrl: string | null;
}

export interface PreviewCopyProgress {
  token: string;
  percent: number | null;
}
