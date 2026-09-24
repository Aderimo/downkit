import { isAudioFormat, type MediaMetadata, type OutputFormat } from "../types/media";
import {
  FINISHED_STATUSES,
  type ChainStep,
  type DownloadOptions,
  type DownloadProgressPayload,
  type Job,
} from "../types/jobs";
import { findPlatformPreset, resolveTargetSize } from "../types/resize";

// Bu dosya yan etkisizdir (Tauri'ye dokunmaz) — birim testleri buradan yazılır.

export function defaultDownloadOptions(): DownloadOptions {
  return {
    outputFormat: "mp4",
    maxHeight: null,
    formatId: null,
    audioBitrateKbps: 192,
    subtitles: false,
    platformTargets: [],
    fitMode: "crop",
    shrink: false,
    shrinkPreset: "balanced",
    shrinkTargetMb: null,
    section: null,
  };
}

/** İndirmeden sonra sırayla çalışacak adımlar. Aynı boyutu üreten platformlar
 * (TikTok, Reels, Shorts hepsi 1080×1920) tek bir çıktıda birleştirilir. */
export function buildChainSteps(options: DownloadOptions): ChainStep[] {
  const steps: ChainStep[] = [];
  if (isAudioFormat(options.outputFormat)) return steps;

  const seen = new Set<string>();
  for (const id of options.platformTargets) {
    const preset = findPlatformPreset(id);
    if (!preset) continue;
    const { width, height } = resolveTargetSize(preset.ratio, preset.longEdge);
    const key = `${width}x${height}`;
    if (seen.has(key)) continue;
    seen.add(key);
    steps.push({
      kind: "resize",
      labelKey: preset.labelKey,
      targetWidth: width,
      targetHeight: height,
      fitMode: options.fitMode,
    });
  }

  if (options.shrink) {
    steps.push(
      options.shrinkTargetMb
        ? {
            kind: "compress",
            mode: "targetSize",
            preset: null,
            targetSizeMb: options.shrinkTargetMb,
          }
        : { kind: "compress", mode: "preset", preset: options.shrinkPreset, targetSizeMb: null },
    );
  }
  return steps;
}

/** Seçilen kalite için beklenen toplam boyut (video+ses); bilinmiyorsa null. */
export function estimateDownloadSize(
  metadata: MediaMetadata,
  options: DownloadOptions,
): number | null {
  const full = estimateFullSize(metadata, options);
  if (full === null || !options.section || !metadata.durationSeconds) return full;
  const fraction = (options.section.end - options.section.start) / metadata.durationSeconds;
  return Math.round(full * Math.min(1, Math.max(0, fraction)));
}

function estimateFullSize(metadata: MediaMetadata, options: DownloadOptions): number | null {
  if (isAudioFormat(options.outputFormat)) {
    if (metadata.durationSeconds && !["wav", "flac"].includes(options.outputFormat)) {
      return Math.round(((options.audioBitrateKbps * 1000) / 8) * metadata.durationSeconds);
    }
    return metadata.audioOption?.estimatedSizeBytes ?? null;
  }

  if (options.formatId) {
    const format = metadata.formats.find((f) => f.formatId === options.formatId);
    if (!format?.estimatedSizeBytes) return null;
    return format.estimatedSizeBytes + (metadata.audioOption?.estimatedSizeBytes ?? 0);
  }

  const candidates = metadata.qualityOptions.filter(
    (q) => options.maxHeight === null || q.height <= options.maxHeight,
  );
  const best = candidates.reduce<(typeof candidates)[number] | null>(
    (acc, q) => (acc === null || q.height > acc.height ? q : acc),
    null,
  );
  return best?.estimatedSizeBytes ?? null;
}

/** Kuyruk satırında gösterilecek kalite. "best" ve "lossless" arayüzde çevrilir. */
export function qualityLabel(options: DownloadOptions): string {
  if (isAudioFormat(options.outputFormat)) {
    return ["wav", "flac"].includes(options.outputFormat)
      ? "lossless"
      : `${options.audioBitrateKbps} kbps`;
  }
  return options.maxHeight ? `${options.maxHeight}p` : "best";
}

export function formatLabel(format: OutputFormat): string {
  return format.toUpperCase();
}

/** Çubukta gösterilecek genel yüzde ve "412 MB / ~670 MB" satırındaki toplam.
 * Video ve ses ayrı indiği için akış yüzdesi 100→0 zıplar; bu yüzden birikimli
 * bayt kullanılır. Toplam, o anki akışın gerçek boyutu bilindiğinde ondan
 * (video akışındaysak ardından gelecek sesin tahmini eklenerek), bilinmiyorsa
 * analizdeki tahminden hesaplanır — tahmin yanlış çıksa da çubuk yarıda kalmaz. */
export function downloadProgress(
  estimates: { totalBytes: number | null; audioBytes: number | null },
  payload: Pick<
    DownloadProgressPayload,
    "stage" | "downloadedBytes" | "percent" | "stream" | "streamTotalBytes"
  >,
): { percent: number | null; totalBytes: number | null } {
  if (payload.stage === "post_processing") {
    return { percent: null, totalBytes: estimates.totalBytes };
  }

  let totalBytes: number | null = null;
  if (payload.streamTotalBytes && payload.percent !== null) {
    const streamRemaining = payload.streamTotalBytes * (1 - payload.percent / 100);
    const later = payload.stream === "video" ? (estimates.audioBytes ?? 0) : 0;
    totalBytes = Math.round(payload.downloadedBytes + streamRemaining + later);
  } else if (estimates.totalBytes && estimates.totalBytes > 0) {
    totalBytes = Math.max(estimates.totalBytes, payload.downloadedBytes);
  }

  if (!totalBytes) return { percent: payload.percent, totalBytes: null };
  return {
    percent: Math.min(99, (payload.downloadedBytes / totalBytes) * 100),
    totalBytes,
  };
}

/** Aynı link aynı çıktı ayarlarıyla zaten sıradaysa ya da iniyorsa onu döner.
 * İndir'e birkaç kez basılınca aynı video üç kez kuyruğa girmesin diye. Farklı
 * ayarla (ör. aynı videonun MP3'ü) eklemek serbesttir. */
export function findDuplicateDownload(
  jobs: Job[],
  url: string,
  options: DownloadOptions,
): Job | null {
  return (
    jobs.find(
      (job) =>
        job.request.kind === "download" &&
        job.request.url === url &&
        !FINISHED_STATUSES.includes(job.status) &&
        sameOutput(job.request.options, options),
    ) ?? null
  );
}

function sameOutput(a: DownloadOptions, b: DownloadOptions): boolean {
  return (
    a.outputFormat === b.outputFormat &&
    a.maxHeight === b.maxHeight &&
    a.formatId === b.formatId &&
    a.subtitles === b.subtitles &&
    a.shrink === b.shrink &&
    a.section?.start === b.section?.start &&
    a.section?.end === b.section?.end &&
    [...a.platformTargets].sort().join() === [...b.platformTargets].sort().join()
  );
}

export interface QuickPreset {
  id: string;
  labelKey: string;
  descKey: string;
  apply: (options: DownloadOptions) => DownloadOptions;
}

export const QUICK_PRESETS: QuickPreset[] = [
  {
    id: "best",
    labelKey: "presets.quickBest",
    descKey: "presets.quickBestDesc",
    apply: (o) => ({ ...o, outputFormat: "mp4", maxHeight: null, formatId: null, shrink: false }),
  },
  {
    id: "mp3",
    labelKey: "presets.quickMp3",
    descKey: "presets.quickMp3Desc",
    apply: (o) => ({
      ...o,
      outputFormat: "mp3",
      audioBitrateKbps: 192,
      formatId: null,
      platformTargets: [],
      shrink: false,
    }),
  },
  {
    id: "small",
    labelKey: "presets.quickSmall",
    descKey: "presets.quickSmallDesc",
    apply: (o) => ({
      ...o,
      outputFormat: "mp4",
      maxHeight: 720,
      formatId: null,
      shrink: true,
      shrinkPreset: "balanced",
      shrinkTargetMb: null,
    }),
  },
  {
    id: "discord",
    labelKey: "presets.quickDiscord",
    descKey: "presets.quickDiscordDesc",
    apply: (o) => ({
      ...o,
      outputFormat: "mp4",
      maxHeight: 720,
      formatId: null,
      shrink: true,
      shrinkTargetMb: 9.5,
    }),
  },
  {
    id: "tiktok",
    labelKey: "presets.quickTiktok",
    descKey: "presets.quickTiktokDesc",
    apply: (o) => ({
      ...o,
      outputFormat: "mp4",
      maxHeight: 1080,
      formatId: null,
      platformTargets: ["tiktok"],
      fitMode: "crop",
    }),
  },
];
