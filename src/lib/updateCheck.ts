import { create } from "zustand";
import { check as checkForUpdate, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getAppVersion, getInstallKind } from "./tauri-api";
import { getSettings } from "./appSettings";
import { GITHUB_REPO, RELEASES_URL } from "./links";

// Yeni sürüm denetimi. Kurulumla gelmiş DownKit güncellemeyi imzasını doğrulayarak
// indirip kurar ve yeniden başlar (Tauri updater); kurulumsuz exe'de yalnızca
// haber verilir ve sürüm sayfası açılır. Otomatik kurulum yok: kullanıcı onaylar.

export interface UpdateInfo {
  version: string;
  url: string;
}

type UpdateStatus = "idle" | "checking" | "upToDate" | "available" | "installing" | "error";

interface UpdateState {
  status: UpdateStatus;
  latest: UpdateInfo | null;
  /** Kurulumlu sürümde güncelleme uygulamanın içinden kurulabilir. */
  canInstall: boolean;
  /** Kurulum sırasında indirme yüzdesi. */
  progress: number | null;
  check: () => Promise<void>;
  install: () => Promise<void>;
}

// Bulunan güncelleme (Tauri updater); "Güncelle"ye basılınca kurulur.
let pending: Update | null = null;

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

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: "idle",
  latest: null,
  canInstall: false,
  progress: null,
  check: async () => {
    set({ status: "checking" });
    if ((await getInstallKind()) === "installed") {
      try {
        const update = await checkForUpdate();
        pending = update;
        set(
          update
            ? {
                status: "available",
                latest: { version: update.version, url: RELEASES_URL },
                canInstall: true,
              }
            : { status: "upToDate", latest: null, canInstall: false },
        );
        return;
      } catch {
        // Güncelleme dosyası (latest.json) yoksa sürüm sayfasına bakılır.
      }
    }
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
  install: async () => {
    if (!pending) return;
    let total = 0;
    let received = 0;
    set({ status: "installing", progress: 0 });
    try {
      await pending.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") {
          received += event.data.chunkLength;
          if (total > 0) set({ progress: Math.min(100, (received / total) * 100) });
        }
      });
      await relaunch();
    } catch {
      set({ status: "available", progress: null });
      if (get().latest) set({ canInstall: false });
    }
  },
}));

export async function initUpdateCheck(): Promise<void> {
  if (getSettings().checkUpdates) await useUpdateStore.getState().check();
}
