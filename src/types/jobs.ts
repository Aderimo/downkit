import type { OutputFormat } from "./media";
import type { FitMode } from "./resize";
import type { CompressPreset } from "./compress";
import type { TimeRange } from "../lib/timeRange";
import type { EditRequest } from "./edit";

/** "trim": eski "Video Kes" aracı; kayıtlı işler okunabilsin diye duruyor.
 * Yeni kesimler Klip Düzenleyici üzerinden "edit" olarak gelir. */
export type JobKind = "download" | "convert" | "compress" | "resize" | "trim" | "edit";

export type JobStatus =
  "queued" | "preparing" | "running" | "postprocessing" | "paused" | "done" | "error" | "canceled";

export const ACTIVE_STATUSES: readonly JobStatus[] = ["preparing", "running", "postprocessing"];
export const FINISHED_STATUSES: readonly JobStatus[] = ["done", "error", "canceled"];

/** Linkten işlem yaparken kullanıcının seçtiği her şey. */
export interface DownloadOptions {
  outputFormat: OutputFormat;
  maxHeight: number | null;
  formatId: string | null;
  audioBitrateKbps: number;
  subtitles: boolean;
  /** Platforma Hazırla: `PLATFORM_PRESETS` kimlikleri; indirmeden sonra boyutlandırılır. */
  platformTargets: string[];
  fitMode: FitMode;
  shrink: boolean;
  shrinkPreset: CompressPreset;
  /** Doluysa sıkıştırma bu hedef boyuta (MB) göre yapılır. */
  shrinkTargetMb: number | null;
  /** Doluysa videonun yalnızca bu aralığı indirilir (saniye). */
  section: TimeRange | null;
}

export type ChainStep =
  | {
      kind: "resize";
      labelKey: string;
      targetWidth: number;
      targetHeight: number;
      fitMode: FitMode;
    }
  | {
      kind: "compress";
      mode: "preset" | "targetSize";
      preset: CompressPreset | null;
      targetSizeMb: number | null;
    };

export type JobRequest =
  | {
      kind: "download";
      url: string;
      destinationDir: string;
      options: DownloadOptions;
      /** Analiz yapılmadan kuyruğa eklenen linkler (toplu işlem) önce hazırlanır. */
      needsAnalyze: boolean;
    }
  | { kind: "convert"; inputPath: string; destinationDir: string; targetContainer: string }
  | {
      kind: "compress";
      inputPath: string;
      destinationDir: string;
      mode: "preset" | "targetSize";
      targetSizeMb: number | null;
      preset: CompressPreset | null;
      maxShortSide?: number | null;
      maxFps?: number | null;
    }
  | {
      kind: "resize";
      inputPath: string;
      destinationDir: string;
      targetWidth: number;
      targetHeight: number;
      fitMode: FitMode;
    }
  | {
      kind: "trim";
      inputPath: string;
      destinationDir: string;
      startSeconds: number;
      endSeconds: number;
      /** Tam karede kes (yeniden kodla); false ise kopyalayarak hızlı kes. */
      precise: boolean;
    }
  | ({ kind: "edit" } & Omit<EditRequest, "rateLimitKbps">);

/** Kuyrukta bir satır. `id` yereldir ve duraklat/devam boyunca sabit kalır;
 * `backendJobId` o an çalışan Rust işinin kimliğidir. */
export interface Job {
  id: string;
  kind: JobKind;
  backendJobId: string | null;
  status: JobStatus;
  /** Çalışan aşamanın çevirisi için anahtar (ör. "jobs.stageVideo"). */
  stageKey: string | null;
  stageParam: string | null;

  title: string;
  thumbnailUrl: string | null;
  platform: string | null;
  durationSeconds: number | null;
  qualityLabel: string | null;
  formatLabel: string;

  percent: number | null;
  downloadedBytes: number | null;
  totalBytesEstimate: number | null;
  /** Video akışından sonra inecek sesin tahmini; genel yüzdeyi düzeltmek için. */
  audioBytesEstimate: number | null;
  speedBps: number | null;
  etaSeconds: number | null;

  outputs: string[];
  fileSizeBytes: number | null;
  errorMessage: string | null;
  errorDetail: string | null;
  /** Tamamlanan işte gösterilecek uyarı kodu (ör. altyazı indirilemedi). */
  notice: string | null;
  /** Duraklatılan indirmenin yarım dosya yolu; iptalde bu yolla silinir. */
  partialTarget: string | null;

  request: JobRequest;
  pendingSteps: ChainStep[];
  pauseRequested: boolean;
  createdAt: number;
}

export interface DownloadProgressPayload {
  jobId: string;
  percent: number | null;
  downloadedBytes: number;
  streamTotalBytes: number | null;
  speedBps: number | null;
  etaSeconds: number | null;
  stage: "downloading" | "post_processing";
  stream: "video" | "audio";
  streamIndex: number;
}

export interface FfmpegProgressPayload {
  jobId: string;
  percent: number | null;
  speed: number | null;
}

/** "edit-progress": yerel dışa aktarımda FFmpeg yüzdesi; linkten klip
 * birleştirmede önce indirilen bayt ("downloading"), sonra "merging". */
export interface EditProgressPayload {
  jobId: string;
  percent: number | null;
  speed?: number | null;
  stage?: "downloading" | "merging";
  downloadedBytes?: number | null;
  speedBps?: number | null;
}

export interface JobCompletePayload {
  jobId: string;
  filePath: string;
  fileSizeBytes: number;
  /** Başarılı ama bildirilecek bir durum; ör. "subtitlesFailed". */
  notice: string | null;
}

export interface JobErrorPayload {
  jobId: string;
  message: string;
  rawDetail: string | null;
  /** Tanınan hatalarda `backendError.<code>` çevirisi gösterilir. */
  code: string | null;
}

export interface JobCanceledPayload {
  jobId: string;
  /** Duraklatılan indirmenin yarım dosya yolu (iptalde null). */
  partialTarget: string | null;
}
