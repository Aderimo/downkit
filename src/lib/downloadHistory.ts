import { create } from "zustand";

const STORAGE_KEY = "downkit.history";
const MAX_ENTRIES = 200;

export type HistoryOperation = "download" | "convert" | "compress" | "resize" | "trim" | "edit";

export interface HistoryEntry {
  id: string;
  filePath: string;
  fileName: string;
  fileSizeBytes: number;
  title: string;
  thumbnailUrl: string | null;
  /** SupportedPlatform ya da yerel dosyalar için "local". */
  platform: string;
  operation: HistoryOperation;
  formatLabel: string | null;
  sourceUrl: string | null;
  completedAt: string;
}

function extensionOf(path: string): string | null {
  const match = /\.([a-z0-9]+)$/i.exec(path);
  return match ? match[1].toUpperCase() : null;
}

/** İlk sürümün kaydettiği (id/operation/sourceUrl içermeyen) girdileri de okur. */
export function normalizeHistoryEntry(raw: unknown): HistoryEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Partial<HistoryEntry>;
  if (typeof e.filePath !== "string") return null;
  const completedAt = typeof e.completedAt === "string" ? e.completedAt : new Date(0).toISOString();
  const fileName = e.fileName ?? e.filePath.split(/[\\/]/).pop() ?? e.filePath;
  const platform = e.platform ?? "local";
  return {
    id: typeof e.id === "string" ? e.id : `${e.filePath}|${completedAt}`,
    filePath: e.filePath,
    fileName,
    fileSizeBytes: typeof e.fileSizeBytes === "number" ? e.fileSizeBytes : 0,
    title: e.title ?? fileName,
    thumbnailUrl: e.thumbnailUrl ?? null,
    platform,
    operation: e.operation ?? (platform === "local" ? "convert" : "download"),
    formatLabel: e.formatLabel ?? extensionOf(e.filePath),
    sourceUrl: e.sourceUrl ?? null,
    completedAt,
  };
}

// Yerel geçmiş — bu cihaza özel bir kolaylık, backend'e yazılmıyor.
function load(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.map(normalizeHistoryEntry).filter((e): e is HistoryEntry => e !== null)
      : [];
  } catch {
    return [];
  }
}

function save(entries: HistoryEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Depolama kullanılamıyorsa geçmiş yalnızca bu oturumda tutulur.
  }
}

interface HistoryState {
  entries: HistoryEntry[];
  add: (entry: Omit<HistoryEntry, "id">) => void;
  remove: (id: string) => void;
  clear: () => void;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  entries: load(),
  add: (entry) => {
    const entries = [{ ...entry, id: crypto.randomUUID() }, ...get().entries].slice(0, MAX_ENTRIES);
    save(entries);
    set({ entries });
  },
  remove: (id) => {
    const entries = get().entries.filter((e) => e.id !== id);
    save(entries);
    set({ entries });
  },
  clear: () => {
    save([]);
    set({ entries: [] });
  },
}));
