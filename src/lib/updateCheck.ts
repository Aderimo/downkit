import { create } from "zustand";
import { getAppVersion } from "./tauri-api";
import { getSettings } from "./appSettings";
import { GITHUB_REPO, RELEASES_URL } from "./links";

// Yeni sürüm denetimi. Program kendiliğinden güncelleme KURMAZ: yeni sürüm
// bulununca durum çubuğunda haber verilir; kullanıcı isterse (üst üste iki
// onayla) sürüm sayfası tarayıcıda açılır, indirip kurmak ona kalır.

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

export const useUpdateStore = create<UpdateState>((set) => ({
  status: "idle",
  latest: null,
  dialog: null,
  check: async () => {
    set({ status: "checking" });
    try {
      const [current, response] = await Promise.all([
        getAppVersion(),
        fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
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
      const release = (await response.json()) as { tag_name?: string; html_url?: string };
      if (release.tag_name && isNewerVersion(release.tag_name, current)) {
        set({
          status: "available",
          latest: {
            version: release.tag_name.replace(/^v/i, ""),
            url: release.html_url ?? RELEASES_URL,
          },
        });
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
