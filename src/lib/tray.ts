import { TrayIcon } from "@tauri-apps/api/tray";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import i18n from "../i18n";
import { getSettings } from "./appSettings";
import { showHud } from "./hud";
import { flushPrefs } from "./prefsFile";
import { useJobsStore } from "../store/jobsStore";
import { ACTIVE_STATUSES } from "../types/jobs";
import { isRecorderActive } from "../store/recorderStore";
import { saveReplay, toggleRecording } from "./recorder";
import { capture } from "./snipActions";

const TRAY_ID = "downkit";
let trayReady = false;
let hintShown = false;

function hasWork(): boolean {
  return (
    isRecorderActive() ||
    useJobsStore
      .getState()
      .jobs.some((j) => ACTIVE_STATUSES.includes(j.status) || j.status === "queued")
  );
}

/** Tepsi simgesi ve menüsü Rust tarafında kurulur (arayüzden bağımsız, her
 * zaman çalışır). Buradaki görevler: menüdeki kayıt eylemlerini arayüzdeki
 * duruma bağlamak, çıkıştan önce ayarları diske yazdırmak, dil değişince menü
 * başlıklarını güncellemek ve pencere kapatılınca ne olacağına karar vermek
 * (Ayarlar > "Pencereyi kapatınca"). */
export async function initTray(): Promise<void> {
  try {
    trayReady = (await TrayIcon.getById(TRAY_ID)) !== null;
  } catch {
    // Tauri dışında (tarayıcı önizlemesi) tepsi yok; pencere normal kapanır.
    trayReady = false;
  }

  if (trayReady) {
    // Menüdeki "Kaydı başlat / durdur" ve "Anlık tekrarı kaydet" arayüzdeki
    // duruma bağlı; Rust menüsü tıklamayı buraya olay olarak iletir.
    void listen<string>("tray-action", (event) => {
      if (event.payload === "toggle-record") void toggleRecording();
      else if (event.payload === "save-replay") void saveReplay();
      else if (event.payload === "snip") void capture("region");
    });
    // Çıkış isteğinde bekleyen ayar yazımını bitir, sonra Rust çıkışı tamamlar.
    // (Arayüz bu olayı kaçırırsa Rust'taki süre aşımı yine de çıkar.)
    void listen("tray-quit-requested", () => {
      void flushPrefs().finally(() => void invoke("force_quit").catch(() => {}));
    });
    // Menü başlıkları Rust'ta sabit başlar; arayüzün diliyle senkronlanır ve
    // dil her değiştiğinde yeniden gönderilir.
    const pushLabels = () =>
      void invoke("tray_set_labels", {
        show: i18n.t("tray.show"),
        snip: i18n.t("tray.snip"),
        record: i18n.t("tray.record"),
        replay: i18n.t("tray.saveReplay"),
        quit: i18n.t("tray.quit"),
      }).catch(() => {});
    i18n.on("languageChanged", pushLabels);
    pushLabels();
  }

  await getCurrentWindow().onCloseRequested(async (event) => {
    const behavior = getSettings().closeBehavior;
    const busy = hasWork();
    const toTray = trayReady && (behavior === "always" || (behavior === "whileBusy" && busy));
    if (!toTray) {
      // Kapanmadan önce son ayar değişiklikleri dosyaya yazılsın.
      await flushPrefs();
      return;
    }
    event.preventDefault();
    await getCurrentWindow().hide();
    // Kullanıcı programın kapandığını sanmasın. Kayıt ya da anlık tekrar sürüyorsa
    // (ekran arka planda kaydediliyor) her seferinde, yoksa oturumda bir kez
    // köşedeki bilgi penceresinde söylenir.
    const recording = isRecorderActive();
    if (recording || !hintShown) {
      hintShown = true;
      await showHud(
        "info",
        i18n.t("tray.hiddenTitle"),
        recording
          ? i18n.t("tray.hiddenRecording")
          : busy
            ? i18n.t("tray.hiddenBusy")
            : i18n.t("tray.hiddenIdle"),
      );
    }
  });
}
