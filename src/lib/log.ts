import { invoke } from "@tauri-apps/api/core";

// Hata günlüğü: iş hataları ve beklenmeyen hatalar diske yazılır (Rust tarafı
// dosyayı 1 MB'ta döndürür). "Hatayı bildir" raporu son satırları ekler.

type Level = "error" | "warn" | "info";

const MAX_DETAIL = 2000;
let queue: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  timer = null;
  const lines = queue;
  queue = [];
  if (lines.length === 0) return;
  invoke("log_write", { lines }).catch(() => {
    // Tauri dışında (tarayıcı önizlemesi) günlük yok.
  });
}

/** Günlüğe bir olay ekler; yazma birkaç satır biriktirilerek yapılır. */
export function logEvent(level: Level, message: string, detail?: string | null) {
  const time = new Date().toISOString();
  queue.push(`${time} [${level}] ${message.replace(/\s+/g, " ").trim()}`);
  const extra = detail?.trim();
  if (extra) {
    const cut = extra.length > MAX_DETAIL ? `…${extra.slice(-MAX_DETAIL)}` : extra;
    for (const line of cut.split(/\r?\n/)) if (line.trim()) queue.push(`    ${line}`);
  }
  if (!timer) timer = setTimeout(flush, 800);
}

/** Son satırlar (rapor için). */
export async function recentLog(lines = 30): Promise<string> {
  flush();
  try {
    return await invoke<string>("log_tail", { maxLines: lines });
  } catch {
    return "";
  }
}

export function openLogFolder(): Promise<void> {
  return invoke("open_log_dir");
}

let installed = false;

/** Yakalanmayan hatalar da günlüğe düşsün. */
export function initLogging(version: string | null) {
  if (installed) return;
  installed = true;
  logEvent("info", `DownKit${version ? ` v${version}` : ""} açıldı`);
  window.addEventListener("error", (e) => {
    logEvent(
      "error",
      e.message || "Beklenmeyen hata",
      e.error instanceof Error ? e.error.stack : null,
    );
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason: unknown = e.reason;
    if (reason instanceof Error) logEvent("error", reason.message, reason.stack);
    else if (reason && typeof reason === "object" && "message" in reason) {
      const r = reason as { message?: unknown; detail?: unknown };
      logEvent("error", String(r.message), typeof r.detail === "string" ? r.detail : null);
    } else logEvent("error", String(reason));
  });
  window.addEventListener("beforeunload", flush);
}
