// Düzenleyici hazır ayarları ("modlama"): kullanıcı bir klibin görünümünü
// (filtre, renk, efekt) ya da bir yazının stilini adıyla kaydeder, sonra tek
// tıkla uygular. Hazır ayarlar .json dosyası olarak dışa/içe aktarılıp
// paylaşılabilir.

import { create } from "zustand";
import { normalizeLook, type ClipLook } from "./clipLook";
import type { TextItem } from "./textItems";

const STORAGE_KEY = "downkit.editorPresets";

export type TextStyle = Pick<TextItem, "x" | "y" | "size" | "color" | "box" | "bold">;

export type EditorPreset =
  | { id: string; name: string; kind: "look"; look: ClipLook }
  | { id: string; name: string; kind: "text"; style: TextStyle };

/** Paylaşılan dosyanın biçimi (başka DownKit'lerde açılabilsin). */
export interface PresetFile {
  app: "DownKit";
  type: "editor-presets";
  version: 1;
  presets: EditorPreset[];
}

const clamp = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

function textStyle(raw: unknown): TextStyle | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    x: clamp(r.x, 0, 1, 0.5),
    y: clamp(r.y, 0, 1, 0.82),
    size: clamp(r.size, 0.02, 0.25, 0.07),
    color: typeof r.color === "string" && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : "#ffffff",
    box: r.box === true,
    bold: r.bold !== false,
  };
}

/** Dosyadan ya da depodan gelen listeyi doğrular; bozuk kayıtlar atlanır. */
export function parsePresets(raw: unknown): EditorPreset[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as PresetFile).presets)
      ? (raw as PresetFile).presets
      : [];
  const out: EditorPreset[] = [];
  for (const item of list as unknown[]) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    const name = typeof p.name === "string" ? p.name.trim().slice(0, 60) : "";
    if (!name) continue;
    const id = typeof p.id === "string" && p.id ? p.id : crypto.randomUUID();
    if (p.kind === "look")
      out.push({ id, name, kind: "look", look: normalizeLook(p.look as ClipLook) });
    else if (p.kind === "text") {
      const style = textStyle(p.style);
      if (style) out.push({ id, name, kind: "text", style });
    }
  }
  return out;
}

export function toPresetFile(presets: readonly EditorPreset[]): PresetFile {
  return { app: "DownKit", type: "editor-presets", version: 1, presets: [...presets] };
}

function load(): EditorPreset[] {
  try {
    return parsePresets(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

interface PresetStore {
  presets: EditorPreset[];
  add: (preset: EditorPreset) => void;
  remove: (id: string) => void;
  /** İçe aktarılanlar eklenir (aynı kimlik varsa yeni kimlik alır). */
  merge: (incoming: EditorPreset[]) => number;
}

function save(presets: EditorPreset[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Kaydedilemezse bu oturumda geçerli kalır.
  }
}

export const usePresetStore = create<PresetStore>((set, get) => ({
  presets: load(),
  add: (preset) => {
    const presets = [...get().presets, preset];
    set({ presets });
    save(presets);
  },
  remove: (id) => {
    const presets = get().presets.filter((p) => p.id !== id);
    set({ presets });
    save(presets);
  },
  merge: (incoming) => {
    const ids = new Set(get().presets.map((p) => p.id));
    const fresh = incoming.map((p) => (ids.has(p.id) ? { ...p, id: crypto.randomUUID() } : p));
    const presets = [...get().presets, ...fresh];
    set({ presets });
    save(presets);
    return fresh.length;
  },
}));
