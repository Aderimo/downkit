import { create } from "zustand";
import { onToolDownload, prepareTools, type ToolDownloadPayload } from "./tauri-api";

// İlk açılışta indirilen araçların (yt-dlp, FFmpeg, Deno) ilerlemesi; durum
// çubuğunda gösterilir ki program donmuş sanılmasın.

interface ToolDownloadState {
  active: Record<string, ToolDownloadPayload>;
}

export const useToolDownloads = create<ToolDownloadState>(() => ({ active: {} }));

const HIDE_AFTER_MS = 4000;

export async function initToolDownloads() {
  await onToolDownload((payload) => {
    useToolDownloads.setState((s) => ({ active: { ...s.active, [payload.tool]: payload } }));
    if (payload.state !== "downloading") {
      setTimeout(() => {
        useToolDownloads.setState((s) => {
          const current = s.active[payload.tool];
          if (!current || current.state === "downloading") return s;
          const rest = { ...s.active };
          delete rest[payload.tool];
          return { active: rest };
        });
      }, HIDE_AFTER_MS);
    }
  });
  // İlk iş araçları beklemesin: yoksa açılışta arka planda indirilir.
  prepareTools().catch(() => {
    // Çevrimdışıysa ilk iş yeniden dener; hata o işin satırında görünür.
  });
}
