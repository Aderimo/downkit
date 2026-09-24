import type { Job } from "../types/jobs";

const STORAGE_KEY = "downkit.jobs";
const MAX_SAVED = 100;
const SAVE_DELAY_MS = 1000;

/** Önceki oturumdan kalan işleri güvenle geri yükler.
 *
 * Uygulama kapanınca çalışan süreçler de kapanır (bkz. Rust `process_guard`), bu
 * yüzden yarıda kalan işler "çalışıyor" olarak geri gelemez:
 * - sırada/çalışan indirmeler ve dosya işleri → Duraklatıldı ("Devam et" ile
 *   indirme yarım `.part` dosyasından sürer, dosya işi baştan başlar);
 * - indirme bitmiş ama zincir adımı (boyutlandır/sıkıştır) yarıda kalmışsa →
 *   Başarısız (`interruptedMessage`), "Tekrar dene" ile baştan yapılır.
 * Bitmiş/başarısız/iptal edilmiş işler olduğu gibi kalır. */
export function restoreJobs(raw: unknown, interruptedMessage: string): Job[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isJobLike).map((job): Job => {
    const reset = {
      backendJobId: null,
      speedBps: null,
      etaSeconds: null,
      stageKey: null,
      stageParam: null,
      pauseRequested: false,
      notice: job.notice ?? null,
      partialTarget: job.partialTarget ?? null,
      audioBytesEstimate: job.audioBytesEstimate ?? null,
    };
    switch (job.status) {
      case "queued":
      case "preparing":
      case "running":
        return { ...job, ...reset, status: "paused" };
      case "postprocessing":
        return {
          ...job,
          ...reset,
          status: "error",
          errorMessage: interruptedMessage,
          errorDetail: null,
        };
      default:
        return { ...job, ...reset };
    }
  });
}

function isJobLike(value: unknown): value is Job {
  if (!value || typeof value !== "object") return false;
  const j = value as Partial<Job>;
  return (
    typeof j.id === "string" &&
    typeof j.status === "string" &&
    typeof j.kind === "string" &&
    typeof j.title === "string" &&
    !!j.request &&
    typeof j.request === "object" &&
    Array.isArray(j.outputs) &&
    Array.isArray(j.pendingSteps)
  );
}

export function loadSavedJobs(interruptedMessage: string): Job[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? restoreJobs(JSON.parse(raw), interruptedMessage) : [];
  } catch {
    return [];
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** İlerleme saniyede birkaç kez güncellendiği için yazma bir saniye geciktirilir. */
export function scheduleSaveJobs(jobs: Job[]) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs.slice(0, MAX_SAVED)));
    } catch {
      // Depolama doluysa ya da kullanılamıyorsa kuyruk yalnızca bu oturumda kalır.
    }
  }, SAVE_DELAY_MS);
}
