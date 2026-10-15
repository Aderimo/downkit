import type { Job } from "../types/jobs";

const STORAGE_KEY = "downkit.jobs";
const MAX_SAVED = 100;
const SAVE_DELAY_MS = 1000;

/** Önceki oturumdan kalan dışa aktarımları güvenle geri yükler. Uygulama
 * kapanınca süreçler de kapanır (bkz. Rust `process_guard`): sırada ya da
 * çalışır durumda kalan işler "Duraklatıldı" olur ve "Devam et" ile biten
 * bölümlerden sürer. Bitmiş/başarısız/iptal edilmiş işler olduğu gibi kalır. */
export function restoreJobs(raw: unknown, _interruptedMessage: string): Job[] {
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
    };
    return job.status === "queued" || job.status === "running"
      ? { ...job, ...reset, status: "paused" }
      : { ...job, ...reset };
  });
}

function isJobLike(value: unknown): value is Job {
  if (!value || typeof value !== "object") return false;
  const j = value as Partial<Job>;
  // Eski DownKit indirme işleri (kind !== "edit") DownKit'e taşınmaz.
  return (
    j.kind === "edit" &&
    typeof j.id === "string" &&
    typeof j.status === "string" &&
    typeof j.title === "string" &&
    !!j.request &&
    typeof j.request === "object" &&
    Array.isArray(j.outputs)
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
