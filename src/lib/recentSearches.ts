import { create } from "zustand";
import { checkSupportedUrl } from "./validation";

const STORAGE_KEY = "downkit.recentUrls";
const MAX_ENTRIES = 50;

export interface SearchEntry {
  url: string;
  title: string | null;
  thumbnailUrl: string | null;
  platform: string | null;
  searchedAt: string | null;
}

function detectPlatform(url: string): string | null {
  const result = checkSupportedUrl(url);
  return result.status === "ok" ? result.platform : null;
}

/** İlk sürüm yalnızca URL dizisi (string[]) kaydediyordu; onları da okur.
 * Platformu kaydedilmemişse linkten tespit edilir (ikon gösterebilmek için). */
export function normalizeSearchEntry(raw: unknown): SearchEntry | null {
  if (typeof raw === "string") {
    return {
      url: raw,
      title: null,
      thumbnailUrl: null,
      platform: detectPlatform(raw),
      searchedAt: null,
    };
  }
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Partial<SearchEntry>;
  if (typeof e.url !== "string") return null;
  return {
    url: e.url,
    title: e.title ?? null,
    thumbnailUrl: e.thumbnailUrl ?? null,
    platform: e.platform ?? detectPlatform(e.url),
    searchedAt: e.searchedAt ?? null,
  };
}

// localStorage bu cihaza özel bir kolaylık; erişim her zaman try/catch ile korunur.
function load(): SearchEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.map(normalizeSearchEntry).filter((e): e is SearchEntry => e !== null)
      : [];
  } catch {
    return [];
  }
}

function save(entries: SearchEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Depolama kullanılamıyorsa aramalar yalnızca bu oturumda tutulur.
  }
}

interface SearchState {
  entries: SearchEntry[];
  add: (entry: Omit<SearchEntry, "searchedAt">) => void;
  remove: (url: string) => void;
  clear: () => void;
}

export const useSearchStore = create<SearchState>((set, get) => ({
  entries: load(),
  add: (entry) => {
    const entries = [
      { ...entry, searchedAt: new Date().toISOString() },
      ...get().entries.filter((e) => e.url !== entry.url),
    ].slice(0, MAX_ENTRIES);
    save(entries);
    set({ entries });
  },
  remove: (url) => {
    const entries = get().entries.filter((e) => e.url !== url);
    save(entries);
    set({ entries });
  },
  clear: () => {
    save([]);
    set({ entries: [] });
  },
}));
