import { create } from "zustand";
import type { MediaMetadata, PlaylistInfo } from "../types/media";
import type { DownloadOptions } from "../types/jobs";
import { defaultDownloadOptions } from "../lib/jobPlanning";
import { getSettings } from "../lib/appSettings";

export type AnalyzePhase = "idle" | "analyzing" | "ready" | "error";
export type WorkspaceAction = "download" | "convert" | "compress" | "resize";
export type OptionsTab = "basic" | "advanced" | "batch";
export type PresetsTab = "video" | "audio" | "quick";

interface WorkspaceState {
  url: string;
  phase: AnalyzePhase;
  metadata: MediaMetadata | null;
  /** Link bir oynatma listesiyse (metadata yerine) bu dolar. */
  playlist: PlaylistInfo | null;
  /** Listede kuyruğa eklenecek videoların URL'leri. */
  playlistSelection: string[];
  analyzedUrl: string | null;
  errorMessage: string | null;
  errorDetail: string | null;

  action: WorkspaceAction;
  options: DownloadOptions;
  optionsTab: OptionsTab;
  presetsTab: PresetsTab;

  setUrl: (url: string) => void;
  startAnalyze: () => void;
  analyzeSucceeded: (url: string, metadata: MediaMetadata) => void;
  playlistLoaded: (url: string, playlist: PlaylistInfo) => void;
  setPlaylistSelection: (urls: string[]) => void;
  togglePlaylistEntry: (url: string) => void;
  analyzeFailed: (message: string, detail: string | null) => void;
  clearError: () => void;
  resetMedia: () => void;
  setAction: (action: WorkspaceAction) => void;
  setOptions: (patch: Partial<DownloadOptions>) => void;
  replaceOptions: (options: DownloadOptions) => void;
  setOptionsTab: (tab: OptionsTab) => void;
  setPresetsTab: (tab: PresetsTab) => void;
}

/** Açılıştaki seçenekler: Ayarlar'daki varsayılan format ve kalite. */
export function initialOptions(): DownloadOptions {
  const settings = getSettings();
  return {
    ...defaultDownloadOptions(),
    outputFormat: settings.defaultOutputFormat,
    maxHeight: settings.defaultMaxHeight,
  };
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  url: "",
  phase: "idle",
  metadata: null,
  playlist: null,
  playlistSelection: [],
  analyzedUrl: null,
  errorMessage: null,
  errorDetail: null,

  action: "download",
  options: initialOptions(),
  optionsTab: "basic",
  presetsTab: "video",

  setUrl: (url) => set({ url }),
  startAnalyze: () => set({ phase: "analyzing", errorMessage: null, errorDetail: null }),
  analyzeSucceeded: (url, metadata) =>
    set((state) => ({
      phase: "ready",
      metadata,
      playlist: null,
      playlistSelection: [],
      analyzedUrl: url,
      // Yeni medyanın kendi format listesi ve süresi var; eski gelişmiş seçim ve
      // bölüm geçersiz kalır.
      options: { ...state.options, formatId: null, section: null },
    })),
  playlistLoaded: (url, playlist) =>
    set((state) => ({
      phase: "ready",
      metadata: null,
      playlist,
      playlistSelection: playlist.entries.map((e) => e.url),
      analyzedUrl: url,
      // Listedeki her video kendi formatlarına ve süresine sahip; gelişmiş seçim
      // ve bölüm uygulanamaz.
      options: { ...state.options, formatId: null, section: null },
      optionsTab: state.optionsTab === "advanced" ? "basic" : state.optionsTab,
    })),
  setPlaylistSelection: (playlistSelection) => set({ playlistSelection }),
  togglePlaylistEntry: (url) =>
    set((state) => ({
      playlistSelection: state.playlistSelection.includes(url)
        ? state.playlistSelection.filter((u) => u !== url)
        : [...state.playlistSelection, url],
    })),
  analyzeFailed: (errorMessage, errorDetail) =>
    set({
      phase: "error",
      errorMessage,
      errorDetail,
      metadata: null,
      playlist: null,
      playlistSelection: [],
      analyzedUrl: null,
    }),
  clearError: () => set({ errorMessage: null, errorDetail: null }),
  resetMedia: () =>
    set({
      phase: "idle",
      metadata: null,
      playlist: null,
      playlistSelection: [],
      analyzedUrl: null,
      errorMessage: null,
      errorDetail: null,
    }),
  setAction: (action) =>
    set((state) => {
      const options = { ...state.options };
      if (action === "convert" && options.outputFormat === "mp4") options.outputFormat = "mp3";
      if (action === "compress") options.shrink = true;
      return { action, options };
    }),
  setOptions: (patch) => set((state) => ({ options: { ...state.options, ...patch } })),
  replaceOptions: (options) => set({ options }),
  setOptionsTab: (optionsTab) => set({ optionsTab }),
  setPresetsTab: (presetsTab) => set({ presetsTab }),
}));
