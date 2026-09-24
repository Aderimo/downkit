import i18n from "../i18n";
import { findJobByBackendId, getJob, useJobsStore } from "../store/jobsStore";
import { useHistoryStore, type HistoryOperation } from "./downloadHistory";
import { getSettings, useSettingsStore } from "./appSettings";
import { localizeError } from "./errors";
import { loadSavedJobs, scheduleSaveJobs } from "./jobPersistence";
import {
  buildChainSteps,
  downloadProgress,
  estimateDownloadSize,
  findDuplicateDownload,
  formatLabel,
  qualityLabel,
} from "./jobPlanning";
import {
  analyzeUrl,
  cancelBackendJob,
  discardPartialDownload,
  isWindowFocused,
  listenJobEvents,
  notify,
  revealInFolder,
  setTaskbarProgress,
  startCompress,
  startConvert,
  startDownload,
  startResize,
  startTrim,
  updateYtdlp,
} from "./tauri-api";
import { isAudioFormat, type MediaMetadata } from "../types/media";
import { formatClock, rangeLabel, type TimeRange } from "./timeRange";
import { PLATFORM_LABEL, isSupportedPlatform } from "./platforms";
import type { LocalMediaInfo } from "../types/convert";
import {
  ACTIVE_STATUSES,
  FINISHED_STATUSES,
  type ChainStep,
  type DownloadOptions,
  type Job,
  type JobRequest,
} from "../types/jobs";

// Tüm işleri (indirme, dönüştürme, sıkıştırma, boyutlandırma) yöneten tek motor.
// Olaylara uygulama başında bir kez abone olunur; hangi sayfanın açık olduğu
// önemli değildir, böylece sayfa değiştirince ilerleme/bitiş kaybolmaz.

const update = (id: string, patch: Partial<Job>) => useJobsStore.getState().update(id, patch);

// Çok kısa bir iş, `invoke` iş kimliğini döndürmeden bitebilir; o anda eşleşecek
// satır olmadığı için terminal olay kaybolup satır "çalışıyor"da asılı kalırdı.
// Böyle olaylar kimlik atanana kadar bekletilir.
const unmatchedTerminal = new Map<string, (job: Job) => void>();

function onTerminal(backendJobId: string, handler: (job: Job) => void) {
  const job = findJobByBackendId(backendJobId);
  if (job) handler(job);
  else unmatchedTerminal.set(backendJobId, handler);
}

function assignBackendId(id: string, backendJobId: string, patch: Partial<Job> = {}) {
  update(id, { ...patch, backendJobId });
  const pending = unmatchedTerminal.get(backendJobId);
  const job = getJob(id);
  if (pending && job) {
    unmatchedTerminal.delete(backendJobId);
    pending(job);
  }
}

function baseJob(request: JobRequest, fields: Partial<Job>): Job {
  return {
    id: crypto.randomUUID(),
    kind: request.kind,
    backendJobId: null,
    status: "queued",
    stageKey: null,
    stageParam: null,
    title: "",
    thumbnailUrl: null,
    platform: null,
    durationSeconds: null,
    qualityLabel: null,
    formatLabel: "",
    percent: null,
    downloadedBytes: null,
    totalBytesEstimate: null,
    audioBytesEstimate: null,
    speedBps: null,
    etaSeconds: null,
    outputs: [],
    fileSizeBytes: null,
    errorMessage: null,
    errorDetail: null,
    notice: null,
    partialTarget: null,
    request,
    pendingSteps: [],
    pauseRequested: false,
    createdAt: Date.now(),
    ...fields,
  };
}

export function enqueueDownload(input: {
  url: string;
  destinationDir: string;
  options: DownloadOptions;
  metadata: MediaMetadata | null;
  /** Oynatma listesinden eklenirken analizden önce görünecek başlık/küçük resim. */
  preview?: EntryPreview;
}): string {
  const { url, destinationDir, options, metadata, preview } = input;
  const job = baseJob(
    { kind: "download", url, destinationDir, options, needsAnalyze: metadata === null },
    {
      title: metadata?.title ?? preview?.title ?? url,
      thumbnailUrl: metadata?.thumbnailUrl ?? preview?.thumbnailUrl ?? null,
      platform: metadata?.platform ?? null,
      durationSeconds: options.section
        ? options.section.end - options.section.start
        : (metadata?.durationSeconds ?? preview?.durationSeconds ?? null),
      qualityLabel: qualityLabel(options),
      formatLabel: options.section
        ? `${formatLabel(options.outputFormat)} · ${formatClock(options.section.start)}–${formatClock(options.section.end)}`
        : formatLabel(options.outputFormat),
      totalBytesEstimate: metadata ? estimateDownloadSize(metadata, options) : null,
      audioBytesEstimate: metadata?.audioOption?.estimatedSizeBytes ?? null,
      pendingSteps: buildChainSteps(options),
    },
  );
  useJobsStore.getState().add(job);
  pump();
  return job.id;
}

export interface EntryPreview {
  title: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
}

/** Birden çok linki kuyruğa ekler (toplu işlem, oynatma listesi). Listede tekrar
 * eden ya da aynı ayarlarla zaten sırada/inmekte olan linkler atlanır. */
export function enqueueMany(
  urls: string[],
  destinationDir: string,
  options: DownloadOptions,
  previews?: Map<string, EntryPreview>,
): { added: number; skipped: number } {
  const seen = new Set<string>();
  let added = 0;
  let skipped = 0;
  for (const url of urls) {
    if (seen.has(url) || findDuplicateDownload(useJobsStore.getState().jobs, url, options)) {
      skipped += 1;
      continue;
    }
    seen.add(url);
    enqueueDownload({ url, destinationDir, options, metadata: null, preview: previews?.get(url) });
    added += 1;
  }
  return { added, skipped };
}

export function enqueueLocal(
  request: Exclude<JobRequest, { kind: "download" }>,
  info: LocalMediaInfo,
): string {
  const format =
    request.kind === "convert"
      ? request.targetContainer.toUpperCase()
      : request.kind === "trim" && !request.precise
        ? info.container.toUpperCase()
        : "MP4";
  const quality =
    request.kind === "resize"
      ? `${request.targetWidth}×${request.targetHeight}`
      : request.kind === "trim"
        ? `${formatClock(request.startSeconds)}–${formatClock(request.endSeconds)}`
        : null;
  const job = baseJob(request, {
    title: info.fileName,
    platform: "local",
    durationSeconds:
      request.kind === "trim" ? request.endSeconds - request.startSeconds : info.durationSeconds,
    qualityLabel: quality,
    formatLabel: format,
  });
  useJobsStore.getState().add(job);
  pump();
  return job.id;
}

function activeCount(): number {
  return useJobsStore.getState().jobs.filter((j) => ACTIVE_STATUSES.includes(j.status)).length;
}

// Açılıştaki yt-dlp güncellemesi sürerken yeni iş başlatılmaz: güncelleyici
// yt-dlp.exe'yi değiştirirken aynı anda başlatılan bir süreç hata verebilir.
let toolsUpdate: Promise<void> | null = null;

export function pump() {
  if (toolsUpdate) return;
  const limit = Math.max(1, getSettings().concurrency);
  // En eski bekleyen iş önce başlar (liste en yeni en üstte tutuluyor).
  const queued = [...useJobsStore.getState().jobs].reverse().filter((j) => j.status === "queued");
  for (const job of queued) {
    if (activeCount() >= limit) break;
    void startJob(job.id);
  }
  refreshTaskbar();
}

// Her başlatma denemesine numara verilir. Analiz sürerken iptal edilip yeniden
// denenen bir işte eski deneme geri döndüğünde ikinci bir indirme başlatmasın.
const attempts = new Map<string, number>();

function isStale(id: string, attempt: number): boolean {
  const job = getJob(id);
  return (
    !job || attempts.get(id) !== attempt || (job.status !== "preparing" && job.status !== "running")
  );
}

async function startJob(id: string) {
  const job = getJob(id);
  if (!job || job.status !== "queued") return;
  const request = job.request;
  const attempt = (attempts.get(id) ?? 0) + 1;
  attempts.set(id, attempt);

  update(id, {
    status: request.kind === "download" && request.needsAnalyze ? "preparing" : "running",
    stageKey: request.kind === "download" && request.needsAnalyze ? "jobs.stagePreparing" : null,
    errorMessage: null,
    errorDetail: null,
    pauseRequested: false,
  });

  try {
    let backendJobId: string;
    switch (request.kind) {
      case "download": {
        if (request.needsAnalyze) {
          const result = await analyzeUrl(request.url);
          if (isStale(id, attempt)) return;
          // Toplu işleme bir oynatma listesi linki yapıştırılmış olabilir.
          if (result.kind === "playlist") {
            throw Object.assign(new Error(i18n.t("backendError.isPlaylist")), {
              code: "isPlaylist",
            });
          }
          update(id, {
            title: result.title,
            thumbnailUrl: result.thumbnailUrl,
            platform: result.platform,
            durationSeconds: result.durationSeconds,
            totalBytesEstimate: estimateDownloadSize(result, request.options),
            audioBytesEstimate: result.audioOption?.estimatedSizeBytes ?? null,
            request: { ...request, needsAnalyze: false },
          });
        }
        const { options } = request;
        const settings = getSettings();
        backendJobId = await startDownload({
          url: request.url,
          destinationDir: request.destinationDir,
          filenameTemplate: downloadTemplate(
            settings.filenameTemplate,
            getJob(id)?.platform ?? null,
            options.section,
          ),
          maxHeight: options.maxHeight,
          formatId: options.formatId,
          outputFormat: options.outputFormat,
          audioBitrateKbps: options.audioBitrateKbps,
          subtitles: options.subtitles,
          subtitleLangs: settings.subtitleLangs,
          autoSubtitles: settings.autoSubtitles,
          rateLimitKbps: settings.rateLimitKbps,
          sectionStart: options.section?.start ?? null,
          sectionEnd: options.section?.end ?? null,
        });
        break;
      }
      case "convert":
        backendJobId = await startConvert(request);
        break;
      case "compress":
        backendJobId = await startCompress(request);
        break;
      case "resize":
        backendJobId = await startResize(request);
        break;
      case "trim":
        backendJobId = await startTrim(request);
        break;
    }
    // Süreç başlatılırken İptal/Duraklat'a basıldıysa arka uçtaki işi de durdur.
    if (isStale(id, attempt)) {
      void cancelBackendJob(request.kind, backendJobId, getJob(id)?.status !== "paused");
      return;
    }
    assignBackendId(id, backendJobId, {
      status: "running",
      stageKey: stageKeyForKind(request.kind),
      partialTarget: null,
    });
  } catch (err) {
    if (isStale(id, attempt)) return;
    failJob(id, localizeError(err, "error.downloadFailed"));
  }
}

/** yt-dlp dosya adı şablonu. Bölüm indirilirken adına aralık eklenir ("Video
 * (01.05-02.30).mp4"); "platforma göre klasörle" açıksa "YouTube/Video.mp4". */
function downloadTemplate(
  base: string,
  platform: string | null,
  section: TimeRange | null,
): string {
  const name = section ? `${base} (${rangeLabel(section)})` : base;
  const folder =
    getSettings().groupByPlatform && isSupportedPlatform(platform)
      ? `${PLATFORM_LABEL[platform]}/`
      : "";
  return `${folder}${name}.{ext}`;
}

function stageKeyForKind(kind: Job["kind"]): string {
  return {
    download: "jobs.stageStarting",
    convert: "jobs.stageConverting",
    compress: "jobs.stageCompressing",
    resize: "jobs.stageResizing",
    trim: "jobs.stageTrimming",
  }[kind];
}

function failJob(id: string, error: { message: string; detail: string | null }) {
  update(id, {
    status: "error",
    stageKey: null,
    errorMessage: error.message,
    errorDetail: error.detail,
    backendJobId: null,
    speedBps: null,
    etaSeconds: null,
  });
  const job = getJob(id);
  if (job) void notifyIfBackground(i18n.t("jobs.notifyFailed"), job.title);
  pump();
}

async function startChainStep(id: string, step: ChainStep, inputPath: string) {
  const job = getJob(id);
  if (!job) return;
  // İndirilen dosyanın klasörüne yazılır: "platforma göre klasörle" açıksa alt klasör.
  const destinationDir = parentDir(inputPath) ?? job.request.destinationDir;
  update(id, {
    status: "postprocessing",
    stageKey: step.kind === "resize" ? "jobs.stageResizingFor" : "jobs.stageCompressing",
    stageParam: step.kind === "resize" ? step.labelKey : null,
    percent: 0,
    speedBps: null,
    etaSeconds: null,
    downloadedBytes: null,
  });
  try {
    const backendJobId =
      step.kind === "resize"
        ? await startResize({
            inputPath,
            destinationDir,
            targetWidth: step.targetWidth,
            targetHeight: step.targetHeight,
            fitMode: step.fitMode,
          })
        : await startCompress({
            inputPath,
            destinationDir,
            mode: step.mode,
            targetSizeMb: step.targetSizeMb,
            preset: step.preset,
          });
    if (getJob(id)?.status !== "postprocessing") {
      void cancelBackendJob(step.kind, backendJobId);
      return;
    }
    assignBackendId(id, backendJobId);
  } catch (err) {
    failJob(id, localizeError(err, "error.resizeFailed"));
  }
}

function parentDir(path: string): string | null {
  const index = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return index > 0 ? path.slice(0, index) : null;
}

function operationFor(job: Job, chainStepKind: ChainStep["kind"] | null): HistoryOperation {
  if (chainStepKind) return chainStepKind;
  return job.kind;
}

async function notifyIfBackground(title: string, body: string) {
  if (!getSettings().notifyOnComplete) return;
  if (await isWindowFocused()) return;
  await notify(title, body);
}

function refreshTaskbar() {
  const active = useJobsStore
    .getState()
    .jobs.filter((j) => ACTIVE_STATUSES.includes(j.status) || j.status === "queued");
  if (active.length === 0) {
    void setTaskbarProgress(null);
    return;
  }
  const known = active.map((j) => j.percent ?? 0);
  void setTaskbarProgress(known.reduce((a, b) => a + b, 0) / known.length);
}

const YTDLP_CHECK_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;

/** Platformlar sık değiştiği için yt-dlp birkaç günde bir kendiliğinden
 * güncellenir (Ayarlar'dan kapatılabilir). yt-dlp'nin kendi güncelleyicisi yeni
 * sürüm yoksa hiçbir şey indirmez. */
function scheduleYtdlpUpdateCheck() {
  const settings = getSettings();
  if (!settings.autoUpdateYtdlp) return;
  const last = settings.lastYtdlpUpdateCheck;
  if (last && Date.now() - last < YTDLP_CHECK_INTERVAL_MS) return;

  toolsUpdate = updateYtdlp()
    .then(() => useSettingsStore.getState().update({ lastYtdlpUpdateCheck: Date.now() }))
    .catch(() => {
      // Çevrimdışıysa bir sonraki açılışta yeniden denenir.
    })
    .finally(() => {
      toolsUpdate = null;
      pump();
    });
}

export async function initJobEngine() {
  // Önceki oturumdan kalan işler geri yüklenir; yarıda kalanlar "Duraklatıldı" olur.
  const saved = loadSavedJobs(i18n.t("jobs.interrupted"));
  if (saved.length > 0) useJobsStore.setState({ jobs: saved });
  useJobsStore.subscribe((state) => scheduleSaveJobs(state.jobs));

  await listenJobEvents({
    onDownloadProgress: (p) => {
      const job = findJobByBackendId(p.jobId);
      if (!job || job.request.kind !== "download") return;
      const audioOutput = isAudioFormat(job.request.options.outputFormat);
      const stageKey =
        p.stage === "post_processing"
          ? audioOutput
            ? "jobs.stageConvertingAudio"
            : "jobs.stageMerging"
          : p.stream === "audio"
            ? "jobs.stageAudio"
            : "jobs.stageVideo";
      const progress = downloadProgress(
        { totalBytes: job.totalBytesEstimate, audioBytes: job.audioBytesEstimate },
        p,
      );
      update(job.id, {
        stageKey,
        stageParam: p.percent === null ? null : String(Math.round(p.percent)),
        percent: progress.percent,
        totalBytesEstimate: progress.totalBytes,
        downloadedBytes: p.downloadedBytes,
        speedBps: p.stage === "post_processing" ? null : p.speedBps,
        etaSeconds:
          p.stage === "post_processing"
            ? null
            : (p.etaSeconds ??
              (progress.totalBytes && p.speedBps && progress.totalBytes > p.downloadedBytes
                ? (progress.totalBytes - p.downloadedBytes) / p.speedBps
                : null)),
      });
      refreshTaskbar();
    },
    onFfmpegProgress: (p) => {
      const job = findJobByBackendId(p.jobId);
      if (!job) return;
      update(job.id, { percent: p.percent, speedBps: null, etaSeconds: null });
      refreshTaskbar();
    },
    onComplete: (p) =>
      onTerminal(p.jobId, (job) => {
        const runningStep = job.status === "postprocessing" ? job.pendingSteps[0] : null;
        const remaining = runningStep ? job.pendingSteps.slice(1) : job.pendingSteps;

        if (getSettings().keepHistory) {
          const sourceUrl = job.request.kind === "download" ? job.request.url : null;
          useHistoryStore.getState().add({
            filePath: p.filePath,
            fileName: p.filePath.split(/[\\/]/).pop() ?? p.filePath,
            fileSizeBytes: p.fileSizeBytes,
            title: job.title,
            thumbnailUrl: job.thumbnailUrl,
            platform: job.platform ?? "local",
            operation: operationFor(job, runningStep?.kind ?? null),
            formatLabel: p.filePath.split(".").pop()?.toUpperCase() ?? null,
            sourceUrl,
            completedAt: new Date().toISOString(),
          });
        }

        update(job.id, {
          outputs: [...job.outputs, p.filePath],
          fileSizeBytes: p.fileSizeBytes,
          pendingSteps: remaining,
          // Zincirin sonraki adımları bildirimi silmez (ör. altyazı notu korunur).
          notice: p.notice ?? job.notice,
          backendJobId: null,
          partialTarget: null,
        });

        if (remaining.length > 0) {
          void startChainStep(job.id, remaining[0], job.outputs[0] ?? p.filePath);
          return;
        }

        update(job.id, {
          status: "done",
          stageKey: null,
          stageParam: null,
          percent: 100,
          speedBps: null,
          etaSeconds: null,
        });
        void notifyIfBackground(i18n.t("jobs.notifyDone"), job.title);
        if (getSettings().revealOnComplete) void revealInFolder(p.filePath);
        pump();
      }),
    onError: (p) =>
      onTerminal(p.jobId, (job) => failJob(job.id, localizeError(p, "error.downloadFailed"))),
    onCanceled: (p) =>
      onTerminal(p.jobId, (job) => {
        update(job.id, {
          status: job.pauseRequested ? "paused" : "canceled",
          // Duraklatmada yarım dosyaların yolu saklanır; sonradan "İptal" edilirse silinir.
          partialTarget: job.pauseRequested ? p.partialTarget : null,
          stageKey: null,
          backendJobId: null,
          speedBps: null,
          etaSeconds: null,
        });
        pump();
      }),
  });

  scheduleYtdlpUpdateCheck();
  pump();
}

export function pauseJob(id: string) {
  const job = getJob(id);
  if (!job) return;
  if (job.status === "queued") {
    update(id, { status: "paused" });
    refreshTaskbar();
    return;
  }
  // Yalnızca indirme aşaması duraklatılabilir: yt-dlp yarım `.part` dosyasından sürdürür.
  if (job.kind === "download" && job.status === "running" && job.backendJobId) {
    update(id, { pauseRequested: true });
    void cancelBackendJob("download", job.backendJobId, false);
  }
}

export function resumeJob(id: string) {
  const job = getJob(id);
  if (!job || job.status !== "paused") return;
  update(id, { status: "queued", pauseRequested: false, stageKey: null });
  pump();
}

/** Önceki oturumdan kalan ya da elle duraklatılan tüm işleri sıraya alır. */
export function resumeAll() {
  for (const job of useJobsStore.getState().jobs) {
    if (job.status === "paused") {
      update(job.id, { status: "queued", pauseRequested: false, stageKey: null });
    }
  }
  pump();
}

export function cancelJob(id: string) {
  const job = getJob(id);
  if (!job || FINISHED_STATUSES.includes(job.status)) return;
  // Henüz arka uç kimliği yoksa (sırada, duraklatılmış, analiz ediliyor ya da süreç
  // tam başlatılıyor) iş burada iptal edilir; startJob dönünce bunu görüp süreci durdurur.
  if (job.status === "queued" || job.status === "paused" || !job.backendJobId) {
    // Duraklatılmış indirmenin yarım dosyaları artık işe yaramaz.
    if (job.partialTarget) void discardPartialDownload(job.partialTarget);
    update(id, {
      status: "canceled",
      stageKey: null,
      speedBps: null,
      etaSeconds: null,
      partialTarget: null,
    });
    pump();
    return;
  }
  const kind =
    job.status === "postprocessing" && job.pendingSteps[0] ? job.pendingSteps[0].kind : job.kind;
  update(id, { pauseRequested: false });
  void cancelBackendJob(kind, job.backendJobId, true);
}

export function retryJob(id: string) {
  const job = getJob(id);
  if (!job || (job.status !== "error" && job.status !== "canceled")) return;
  const pendingSteps = job.request.kind === "download" ? buildChainSteps(job.request.options) : [];
  update(id, {
    status: "queued",
    outputs: [],
    pendingSteps,
    percent: null,
    downloadedBytes: null,
    errorMessage: null,
    errorDetail: null,
    notice: null,
    partialTarget: null,
    stageKey: null,
  });
  pump();
}
