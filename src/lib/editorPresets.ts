// Düzenleyici hazır ayarları ("modlama"): kullanıcı bir klibin görünümünü
// (filtre, renk, efekt) ya da bir yazının stilini adıyla kaydeder, sonra tek
// tıkla uygular. Hazır ayarlar .json dosyası olarak dışa/içe aktarılıp
// paylaşılabilir.

import { isTextAnim, isTextStyle } from "./textFx";
import { create } from "zustand";
import { normalizeLook, type ClipLook } from "./clipLook";
import type { TextItem } from "./textItems";
import { parseGradient, parseSplit, type SplitLayout } from "./splitLayout";

const STORAGE_KEY = "downkit.editorPresets";

export type TextStyle = Pick<
  TextItem,
  "x" | "y" | "size" | "color" | "box" | "bold" | "style" | "anim"
>;

/** Çıkış çerçevesi (editorStore `FrameAspect` ile aynı değerler). */
export const CHANNEL_FRAMES = ["original", "9:16", "1:1", "4:5", "16:9"] as const;
export type ChannelFrame = (typeof CHANNEL_FRAMES)[number];

/** Kanal şablonu: bir kanalın bütün kliplerinde aynı kalan görünüm. Bir kez
 * kaydedilir, her yeni projeye tek tıkla uygulanır. */
export interface ChannelTemplate {
  frame: {
    aspect: ChannelFrame;
    fit: boolean;
    blur: boolean;
    position: number;
    /** Kamera + oyun düzeni (yayın kaydından dikey video). */
    split?: SplitLayout;
    gradient?: [string, string];
  };
  look?: ClipLook;
  text?: TextStyle;
  logo?: { path: string; name: string; x: number; y: number; size: number; opacity: number };
}

export type EditorPreset =
  | { id: string; name: string; kind: "look"; look: ClipLook }
  | { id: string; name: string; kind: "text"; style: TextStyle }
  | { id: string; name: string; kind: "channel"; channel: ChannelTemplate };

/** Paylaşılan dosyanın biçimi (başka DownKit'lerde açılabilsin; eski DownKit dosyaları da okunur). */
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
    ...(isTextStyle(r.style) ? { style: r.style } : {}),
    ...(isTextAnim(r.anim) ? { anim: r.anim } : {}),
  };
}

function channel(raw: unknown): ChannelTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const f = (r.frame && typeof r.frame === "object" ? r.frame : {}) as Record<string, unknown>;
  const out: ChannelTemplate = {
    frame: {
      aspect: CHANNEL_FRAMES.includes(f.aspect as ChannelFrame)
        ? (f.aspect as ChannelFrame)
        : "original",
      fit: f.fit === true,
      blur: f.blur === true,
      position: clamp(f.position, 0, 1, 0.5),
      ...(parseSplit(f.split) ? { split: parseSplit(f.split)! } : {}),
      ...(parseGradient(f.gradient) ? { gradient: parseGradient(f.gradient)! } : {}),
    },
  };
  if (r.look && typeof r.look === "object") out.look = normalizeLook(r.look as ClipLook);
  const text = textStyle(r.text);
  if (r.text && text) out.text = text;
  const l = r.logo as Record<string, unknown> | undefined;
  if (l && typeof l === "object" && typeof l.path === "string" && l.path) {
    out.logo = {
      path: l.path,
      name: typeof l.name === "string" ? l.name : "",
      x: clamp(l.x, 0, 1, 0.88),
      y: clamp(l.y, 0, 1, 0.1),
      size: clamp(l.size, 0.02, 1, 0.18),
      opacity: clamp(l.opacity, 0, 1, 1),
    };
  }
  return out;
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
    } else if (p.kind === "channel") {
      const template = channel(p.channel);
      if (template) out.push({ id, name, kind: "channel", channel: template });
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
