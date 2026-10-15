import ReactDOM from "react-dom/client";
import { initPrefsFile } from "../lib/prefsFile";

/** Bölge seçim penceresi (?snip): ana uygulamanın açılış işlerini çalıştırmaz.
 * Dil ve tema kalıcı ayarlardan okunsun diye önce ayar dosyası yüklenir. */
export async function mountSnip() {
  await initPrefsFile().catch(() => {});
  const [{ SnipApp }, { applyTheme }, { getSettings }] = await Promise.all([
    import("./SnipApp"),
    import("../lib/themes"),
    import("../lib/appSettings"),
    import("../i18n"),
  ]);
  const settings = getSettings();
  applyTheme(settings.theme, document.documentElement, { custom: settings.customColors });
  document.body.style.background = "#000";
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<SnipApp />);
}
