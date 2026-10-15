import { create } from "zustand";
import { getAppVersion } from "./tauri-api";
import { getSettings } from "./appSettings";
import { LATEST_RELEASE_API, REPO_URL } from "./links";

// Yeni sürüm denetimi. Program kendiliğinden güncelleme KURMAZ: yeni sürüm
// bulununca durum çubuğunda haber verilir; kullanıcı isterse (üst üste iki
// onayla) sürümün GitHub sayfası tarayıcıda açılır, indirip kurmak ona kalır.
// Son sürüm GitHub'dan okunur (taslak ve ön sürümler sayılmaz).

export interface UpdateInfo {
  version: string;
  url: string;
}

type UpdateStatus = "idle" | "checking" | "upToDate" | "available" | "error";

/** Onay penceresinin adımı: sor → emin misin → (onayda sayfa açılır). */
export type UpdateDialogStep = "ask" | "confirm";

interface UpdateState {
  status: UpdateStatus;
  latest: UpdateInfo | null;
  /** Onay penceresi bu adımla açık; null: kapalı. */
  dialog: UpdateDialogStep | null;
  check: () => Promise<void>;
  openDialog: () => void;
  setDialog: (step: UpdateDialogStep | null) => void;
}

/** "v0.2.0" > "0.1.9" gibi karşılaştırma; ilk üç sayısal parça kullanılır. */
export function isNewerVersion(latest: string, current: string): boolean {
  const parse = (version: string) =>
    version
      .trim()
      .replace(/^v/i, "")
      .split(/[.+-]/)
      .slice(0, 3)
      .map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/** GitHub "son sürüm" yanıtı: { tag_name, html_url, draft, prerelease }. Sayfa yalnızca
 * kendi depomuzdan kabul edilir; değilse sürümler sayfası. */
export function parseLatest(raw: unknown): UpdateInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.draft === true || r.prerelease === true) return null;
  if (typeof r.tag_name !== "string" || !/^v?\d+\.\d+\.\d+/.test(r.tag_name)) return null;
  const page =
    typeof r.html_url === "string" && r.html_url.startsWith(`${REPO_URL}/releases/`)
      ? r.html_url
      : `${REPO_URL}/releases/latest`;
  return { version: r.tag_name.replace(/^v/i, ""), url: page };
}

export const useUpdateStore = create<UpdateState>((set) => ({
  status: "idle",
  latest: null,
  dialog: null,
  check: async () => {
    set({ status: "checking" });
    try {
      const [current, response] = await Promise.all([
        getAppVersion(),
        fetch(LATEST_RELEASE_API, {
          cache: "no-store",
          headers: { Accept: "application/vnd.github+json" },
        }),
      ]);
      // Henüz yayınlanmış sürüm yoksa GitHub 404 döner: güncel sayılır.
      if (response.status === 404) {
        set({ status: "upToDate", latest: null });
        return;
      }
      if (!response.ok) {
        set({ status: "error" });
        return;
      }
      const latest = parseLatest(await response.json());
      if (latest && isNewerVersion(latest.version, current)) {
        set({ status: "available", latest });
      } else {
        set({ status: "upToDate", latest: null });
      }
    } catch {
      set({ status: "error" });
    }
  },
  openDialog: () => {
    // Yalnızca bulunmuş bir sürüm varken açılır.
    if (useUpdateStore.getState().latest) set({ dialog: "ask" });
  },
  setDialog: (dialog) => set({ dialog }),
}));

export async function initUpdateCheck(): Promise<void> {
  if (getSettings().checkUpdates) await useUpdateStore.getState().check();
}
