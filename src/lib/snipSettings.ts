import { create } from "zustand";
import type { TranslateDirection } from "./snip";

const STORAGE_KEY = "downkit.snip";

export type ShotFormat = "png" | "jpg" | "webp";
/** Seçim penceresinde Enter'ın (ve bölge kısayolunun) yapacağı iş. */
export type EnterAction = "edit" | "copy" | "save";

export const SHOT_FORMATS: ShotFormat[] = ["png", "jpg", "webp"];
export const ENTER_ACTIONS: EnterAction[] = ["edit", "copy", "save"];
export const CAPTURE_DELAYS = [0, 3, 5, 10] as const;
export const TRANSLATE_DIRECTIONS: TranslateDirection[] = ["auto", "en-tr", "tr-en"];
/** JPEG/WebP kalitesi (yüzde). */
export const QUALITY_MIN = 50;
export const QUALITY_MAX = 100;

export interface SnipSettings {
  /** Boşsa Resimler\DownKit. */
  outputDir: string | null;
  format: ShotFormat;
  quality: number;
  enterAction: EnterAction;
  /** Kaydederken görüntü panoya da kopyalanır. */
  copyOnSave: boolean;
  /** Sayfadaki düğmelerle yakalamadan önce beklenecek saniye (menü açmak için). */
  delaySeconds: number;
  translateDirection: TranslateDirection;
}

export const DEFAULT_SNIP_SETTINGS: SnipSettings = {
  outputDir: null,
  format: "png",
  quality: 92,
  enterAction: "edit",
  copyOnSave: true,
  delaySeconds: 0,
  translateDirection: "auto",
};

function pick<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Kayıtlı ayarları okur; eksik ya da bozuk alanlar varsayılana döner. */
export function normalizeSnipSettings(raw: unknown): SnipSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SNIP_SETTINGS;
  return {
    outputDir: typeof r.outputDir === "string" && r.outputDir ? r.outputDir : null,
    format: pick(r.format, SHOT_FORMATS, d.format),
    quality:
      typeof r.quality === "number" && Number.isFinite(r.quality)
        ? Math.min(QUALITY_MAX, Math.max(QUALITY_MIN, Math.round(r.quality)))
        : d.quality,
    enterAction: pick(r.enterAction, ENTER_ACTIONS, d.enterAction),
    copyOnSave: typeof r.copyOnSave === "boolean" ? r.copyOnSave : d.copyOnSave,
    delaySeconds: pick<number>(r.delaySeconds, CAPTURE_DELAYS, d.delaySeconds),
    translateDirection: pick(r.translateDirection, TRANSLATE_DIRECTIONS, d.translateDirection),
  };
}

function load(): SnipSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return normalizeSnipSettings(raw ? JSON.parse(raw) : {});
  } catch {
    return { ...DEFAULT_SNIP_SETTINGS };
  }
}

interface SnipSettingsStore extends SnipSettings {
  update: (patch: Partial<SnipSettings>) => void;
}

export const useSnipSettings = create<SnipSettingsStore>((set, get) => ({
  ...load(),
  update: (patch) => {
    set(patch);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeSnipSettings(get())));
    } catch {
      // Kaydedilemezse bu oturumda geçerli kalır.
    }
  },
}));

export function getSnipSettings(): SnipSettings {
  return normalizeSnipSettings(useSnipSettings.getState());
}
