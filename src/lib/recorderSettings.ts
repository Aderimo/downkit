import { create } from "zustand";
import type { RecordQuality } from "../types/recorder";

const STORAGE_KEY = "downkit.recorder";

/** Kaynak seçimi. Monitör sırayla (0 = birincil ekran), birden çok ekran masaüstü
 * sıralarıyla, pencere programı ve başlığıyla saklanır: pencere tutamacı her
 * açılışta değişir. */
export type RecorderSource =
  | { kind: "monitor"; number: number }
  | { kind: "monitors"; numbers: number[] }
  | { kind: "window"; exe: string; title: string };

/** Sistem geneli kısayollar (kayıt ve ekran görüntüsü aynı düzende kaydedilir). */
export type RecorderHotkey = "record" | "saveReplay" | "toggleReplay" | "snip" | "snipFull" | "snipTranslate";

/** Anlık tekrar süresi kaydırıcıyla: 10 sn – 10 dk, 5 sn adım. */
export const REPLAY_MIN_SECONDS = 10;
export const REPLAY_MAX_SECONDS = 600;
export const REPLAY_STEP_SECONDS = 5;
export const RECORD_FPS = [30, 60] as const;
export const RECORD_HEIGHTS = [null, 2160, 1440, 1080, 720, 480] as const;
/** Özel bit hızı kaydırıcısı (kbps). */
export const BITRATE_MIN_KBPS = 2_000;
export const BITRATE_MAX_KBPS = 80_000;
export const BITRATE_STEP_KBPS = 500;

export function clampReplaySeconds(v: number): number {
  const stepped = Math.round(v / REPLAY_STEP_SECONDS) * REPLAY_STEP_SECONDS;
  return Math.min(REPLAY_MAX_SECONDS, Math.max(REPLAY_MIN_SECONDS, stepped));
}

export function clampBitrate(v: number): number {
  const stepped = Math.round(v / BITRATE_STEP_KBPS) * BITRATE_STEP_KBPS;
  return Math.min(BITRATE_MAX_KBPS, Math.max(BITRATE_MIN_KBPS, stepped));
}
export const RECORD_QUALITIES: RecordQuality[] = ["high", "balanced", "small"];

export interface RecorderSettings {
  /** Boşsa Videolar\DownKit\Kayıtlar. */
  outputDir: string | null;
  source: RecorderSource;
  fps: number;
  maxHeight: number | null;
  quality: RecordQuality;
  /** Verilirse kalite ön ayarı yerine bu bit hızı (kbps). */
  bitrateKbps: number | null;
  cursor: boolean;
  systemAudio: boolean;
  /** Sistem sesinin alınacağı çıkış aygıtı; boşsa Windows'un varsayılanı. */
  systemAudioId: string | null;
  /** 0–2 (1 = olduğu gibi). */
  systemVolume: number;
  microphone: boolean;
  /** Boşsa Windows'un varsayılan mikrofonu. */
  microphoneId: string | null;
  microphoneVolume: number;
  /** Mikrofonda gürültü engelleme (fan, klavye, uğultu). */
  noiseSuppression: boolean;
  /** Kayıtlar oyuna / uygulamaya göre alt klasörlere (NVIDIA'daki gibi). */
  byApp: boolean;
  /** Kayıtlarım'da eskiden yeniye (en yeni en altta); kapalıysa yeniden eskiye. */
  libraryNewestLast: boolean;
  replaySeconds: number;
  /** Program açılınca anlık tekrarı kendiliğinden başlat (NVIDIA'daki gibi hep açık). */
  replayOnStartup: boolean;
  hotkeys: Record<RecorderHotkey, string | null>;
}

/** NVIDIA'nın Alt+F9/F10'u çoğu bilgisayarda dolu olduğu için Ctrl eklendi.
 * Tam ekran görüntüsünün varsayılanı yok: sık kullanılan birleşimleri (ör. VS
 * Code'un Alt+Shift+F'si) başka programlardan çalmasın. */
export const DEFAULT_HOTKEYS: Record<RecorderHotkey, string | null> = {
  record: "Ctrl+Alt+F9",
  saveReplay: "Ctrl+Alt+F10",
  toggleReplay: "Ctrl+Alt+Shift+F10",
  snip: "Alt+Shift+S",
  snipFull: null,
  snipTranslate: "Alt+Shift+T",
};

export const DEFAULT_RECORDER_SETTINGS: RecorderSettings = {
  outputDir: null,
  source: { kind: "monitor", number: 0 },
  fps: 60,
  maxHeight: null,
  quality: "balanced",
  bitrateKbps: null,
  cursor: true,
  systemAudio: true,
  systemAudioId: null,
  systemVolume: 1,
  microphone: false,
  microphoneId: null,
  microphoneVolume: 1,
  noiseSuppression: true,
  byApp: true,
  libraryNewestLast: true,
  replaySeconds: 30,
  replayOnStartup: false,
  hotkeys: { ...DEFAULT_HOTKEYS },
};

function volume(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(2, Math.max(0, v)) : fallback;
}

function source(v: unknown): RecorderSource {
  const s = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  if (s.kind === "window" && typeof s.exe === "string" && typeof s.title === "string") {
    return { kind: "window", exe: s.exe, title: s.title };
  }
  if (s.kind === "monitors" && Array.isArray(s.numbers)) {
    const numbers = s.numbers.filter(
      (n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0,
    );
    if (numbers.length > 1) return { kind: "monitors", numbers };
    if (numbers.length === 1) return { kind: "monitor", number: numbers[0] };
  }
  if (s.kind === "monitor" && typeof s.number === "number" && s.number >= 0) {
    return { kind: "monitor", number: Math.round(s.number) };
  }
  return DEFAULT_RECORDER_SETTINGS.source;
}

/** Kayıtlı ayarları okur; eksik ya da bozuk alanlar varsayılana döner. */
export function normalizeRecorderSettings(raw: unknown): RecorderSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_RECORDER_SETTINGS;
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  const hk = (r.hotkeys && typeof r.hotkeys === "object" ? r.hotkeys : {}) as Record<
    string,
    unknown
  >;
  const hotkey = (key: RecorderHotkey) =>
    hk[key] === null ? null : typeof hk[key] === "string" ? (hk[key] as string) : d.hotkeys[key];
  return {
    outputDir: typeof r.outputDir === "string" && r.outputDir ? r.outputDir : null,
    source: source(r.source),
    fps: RECORD_FPS.includes(r.fps as 30) ? (r.fps as number) : d.fps,
    maxHeight: RECORD_HEIGHTS.includes(r.maxHeight as 720)
      ? (r.maxHeight as number | null)
      : d.maxHeight,
    quality: RECORD_QUALITIES.includes(r.quality as RecordQuality)
      ? (r.quality as RecordQuality)
      : d.quality,
    bitrateKbps:
      typeof r.bitrateKbps === "number" && Number.isFinite(r.bitrateKbps)
        ? clampBitrate(r.bitrateKbps)
        : null,
    cursor: bool(r.cursor, d.cursor),
    systemAudio: bool(r.systemAudio, d.systemAudio),
    systemAudioId: typeof r.systemAudioId === "string" && r.systemAudioId ? r.systemAudioId : null,
    systemVolume: volume(r.systemVolume, d.systemVolume),
    microphone: bool(r.microphone, d.microphone),
    microphoneId: typeof r.microphoneId === "string" && r.microphoneId ? r.microphoneId : null,
    microphoneVolume: volume(r.microphoneVolume, d.microphoneVolume),
    noiseSuppression: bool(r.noiseSuppression, d.noiseSuppression),
    byApp: bool(r.byApp, d.byApp),
    libraryNewestLast: bool(r.libraryNewestLast, d.libraryNewestLast),
    replaySeconds:
      typeof r.replaySeconds === "number" && Number.isFinite(r.replaySeconds)
        ? clampReplaySeconds(r.replaySeconds)
        : d.replaySeconds,
    replayOnStartup: bool(r.replayOnStartup, d.replayOnStartup),
    hotkeys: {
      record: hotkey("record"),
      saveReplay: hotkey("saveReplay"),
      toggleReplay: hotkey("toggleReplay"),
      snip: hotkey("snip"),
      snipFull: hotkey("snipFull"),
      snipTranslate: hotkey("snipTranslate"),
    },
  };
}

function load(): RecorderSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return normalizeRecorderSettings(raw ? JSON.parse(raw) : {});
  } catch {
    return { ...DEFAULT_RECORDER_SETTINGS };
  }
}

interface RecorderSettingsStore extends RecorderSettings {
  update: (patch: Partial<RecorderSettings>) => void;
}

export const useRecorderSettings = create<RecorderSettingsStore>((set, get) => ({
  ...load(),
  update: (patch) => {
    set(patch);
    try {
      // Yalnızca ayar alanları (işlevler değil) yazılır.
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeRecorderSettings(get())));
    } catch {
      // Kaydedilemezse bu oturumda geçerli kalır.
    }
  },
}));

export function getRecorderSettings(): RecorderSettings {
  return normalizeRecorderSettings(useRecorderSettings.getState());
}
