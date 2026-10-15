import type { ClipLook } from "../lib/clipLook";
import type { AudioFx } from "../lib/audioFx";
import type { MotionId, TransitionStyle } from "../lib/clipFx";
import type { BlurRegionReq, ImageOverlayReq, MusicTrackReq } from "../lib/layers";
import type { LocalMediaInfo } from "./convert";
import type { TextOverlay } from "../lib/textItems";
import type { ClipXfade } from "../lib/xfade";
import type { SplitLayout } from "../lib/splitLayout";
import type { TransformReq } from "../lib/clipTransform";

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
  /** Hareket (Rust `fx::Motion`), şiddeti ve parçanın klip içindeki yeri. */
  motion?: MotionId;
  motionStrength?: number;
  motionOffset?: number;
  motionTotal?: number;
  /** Geçiş stili (Rust `fx::Transition`); yoksa kararma. */
  transition?: TransitionStyle;
  /** Bu parçadan sonrakine geçiş (Rust `ffmpeg::xfade::Xfade`). */
  xfade?: ClipXfade;
  /** Sesteki gürültüyü azalt (Rust `afftdn`). */
  denoise?: boolean;
  /** Hareket bulanıklığı (kare karıştırma). */
  motionBlur?: boolean;
  /** Ses onarımı, eşitleyici ve dinamik (Rust `AudioFx`). */
  audioFx?: AudioFx;
  /** Dondurulmuş kare: kaynağın bu saniyesindeki kare durur. */
  freezeAt?: number;
  /** Ters oynatma. */
  reverse?: boolean;
  /** Konum, ölçek, döndürme, saydamlık (Rust `ffmpeg::transform::Transform`). */
  transform?: TransformReq | null;
  /** Zamanlı yakınlaştırma (dönüşümden sonra, karenin tamamına). */
  zoom?: TransformReq | null;
}

/** Üst izden bindirilen klip (Rust `OverlayRequest`): `source` istekteki girdi sırası. */
export interface ClipOverlayReq {
  source: number;
  clip: EditClip;
  /** Çıktıdaki başlangıç saniyesi. */
  at: number;
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
  /** İlerleme çubuğu (Rust `ProgressBar`). */
  progress?: { color: string; height: number; top: boolean } | null;
  /** Verilirse çıktı sessiz, hareketli bir GIF olur. */
  gif?: GifOptions | null;
  /** Verilirse görüntü bu kareye kırpılır ya da sığdırılır (ör. dikey 9:16). */
  frame?: {
    width: number;
    height: number;
    fit: boolean;
    blur?: boolean;
    position: number;
    /** Kamera + oyun düzeni (Rust `Split`). */
    split?: SplitLayout;
    /** Sığdırırken arka plan renk geçişi (yukarıdan aşağı). */
    gradient?: [string, string] | null;
    /** Kırpma konumu zamanla (yüz takibi): [çıktı saniyesi, konum]. */
    track?: [number, number][] | null;
  } | null;
  /** Görüntüye yazılacak yazılar (zamanlar çıktı saniyesi). */
  texts?: TextOverlay[];
  /** Çıktı bu boyuta (MB) sığsın. */
  targetSizeMb?: number | null;
  /** Ekran kartı kodlayıcısı: nvenc | amf | qsv. */
  gpuEncoder?: string | null;
  /** Üste bindirilecek resimler ve müzik izleri. */
  images?: ImageOverlayReq[];
  music?: MusicTrackReq[];
  /** Üst izden bindirilen dönüşümlü klipler (resim içinde resim). */
  overlays?: ClipOverlayReq[];
  /** Karışımın hedef ses seviyesi (LUFS, ör. −14). */
  loudness?: number | null;
  /** Gizlenecek bölgeler (Rust `BlurRegion`). */
  blurs?: BlurRegionReq[];
  /** Zengin yazılar ve kelime vurgulu altyazılar (ASS; zamanlar çıktı saniyesi). */
  assScript?: string | null;
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
