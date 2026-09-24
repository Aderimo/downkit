import { TrayIcon } from "@tauri-apps/api/tray";
import { Menu } from "@tauri-apps/api/menu";
import { defaultWindowIcon } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import i18n from "../i18n";
import { getSettings } from "./appSettings";
import { notify } from "./tauri-api";
import { useJobsStore } from "../store/jobsStore";
import { ACTIVE_STATUSES } from "../types/jobs";

const TRAY_ID = "downkit";
let trayReady = false;
let hintShown = false;

async function showWindow() {
  const window = getCurrentWindow();
  await window.show();
  await window.unminimize();
  await window.setFocus();
}

function buildMenu() {
  return Menu.new({
    items: [
      { id: "show", text: i18n.t("tray.show"), action: () => void showWindow() },
      // destroy: kapatma isteğini (tepsiye küçültme) atlayıp programı gerçekten kapatır.
      { id: "quit", text: i18n.t("tray.quit"), action: () => void getCurrentWindow().destroy() },
    ],
  });
}

function hasWork(): boolean {
  return useJobsStore
    .getState()
    .jobs.some((j) => ACTIVE_STATUSES.includes(j.status) || j.status === "queued");
}

/** Sistem tepsisi simgesi (sol tık: pencereyi göster; sağ tık: Göster / Çıkış) ve
 * pencere kapatılınca ne olacağı (Ayarlar > "Pencereyi kapatınca"). */
export async function initTray(): Promise<void> {
  try {
    const existing = await TrayIcon.getById(TRAY_ID);
    const tray =
      existing ??
      (await TrayIcon.new({
        id: TRAY_ID,
        icon: (await defaultWindowIcon()) ?? undefined,
        tooltip: "DownKit",
        menu: await buildMenu(),
        showMenuOnLeftClick: false,
        action: (event) => {
          if (event.type === "Click" && event.button === "Left" && event.buttonState === "Up") {
            void showWindow();
          }
        },
      }));
    trayReady = true;
    i18n.on("languageChanged", () => {
      void buildMenu().then((menu) => tray.setMenu(menu));
    });
  } catch {
    // Tauri dışında (tarayıcı önizlemesi) ya da tepsi desteklenmiyorsa normal kapanır.
    return;
  }

  await getCurrentWindow().onCloseRequested(async (event) => {
    const behavior = getSettings().closeBehavior;
    const busy = hasWork();
    const toTray = trayReady && (behavior === "always" || (behavior === "whileBusy" && busy));
    if (!toTray) return;
    event.preventDefault();
    await getCurrentWindow().hide();
    // Kullanıcı programın kapandığını sanmasın: oturumda bir kez hatırlatılır.
    if (!hintShown) {
      hintShown = true;
      await notify(
        i18n.t("tray.hiddenTitle"),
        busy ? i18n.t("tray.hiddenBusy") : i18n.t("tray.hiddenIdle"),
      );
    }
  });
}
