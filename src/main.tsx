import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./i18n";
import "@fontsource/nunito/latin-800.css";
import "@fontsource/nunito/latin-900.css";
import "./styles/globals.css";
import { initJobEngine } from "./lib/jobEngine";
import { initTray } from "./lib/tray";
import { initUpdateCheck } from "./lib/updateCheck";

// İş olaylarına uygulama başında bir kez abone olunur (StrictMode'un çift
// çalıştırdığı efektlerin dışında), böylece sayfa değişse de hiçbir olay kaçmaz.
initJobEngine().catch((err: unknown) => {
  // Yalnızca Tauri dışında (tarayıcıda arayüz önizlemesi) olur.
  console.warn("İş olaylarına abone olunamadı:", err);
});
void initTray();
void initUpdateCheck();

// README ekran görüntüleri için örnek durum (yalnızca geliştirme sunucusunda).
if (import.meta.env.DEV) {
  const params = new URLSearchParams(window.location.search);
  const scene = params.get("demo");
  if (scene) void import("./dev/demo").then((demo) => demo.applyDemo(scene, params.get("lang")));
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
