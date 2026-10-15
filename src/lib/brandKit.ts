import { create } from "zustand";
import i18n from "../i18n";
import { newClipId, useEditorStore } from "../store/editorStore";
import { applyCaptionPreset } from "./captionActions";
import { presetById } from "./captionPresets";
import { FONTS, type FontId } from "./captionStyle";
import { newImage, type ImageItem } from "./layers";
import { ensureMediaUrl } from "./layerActions";
import { templateById, templateTexts } from "./reelTemplates";
import { sequenceEnd } from "./sequence";
import type { TextItem } from "./textItems";

// Marka kiti: yazı tipi, iki renk (ana / vurgu), logo, altyazı stili, açılış (kanca) ve
// kapanış yazısı, ilerleme çubuğu. Bir kez kaydedilir, her projeye tek tıkla uygulanır
// (yazılar tek geri alma adımı). Birden çok kit tutulabilir (ör. iki kanal).

export interface BrandKit {
  id: string;
  name: string;
  font: FontId;
  primary: string;
  accent: string;
  logo?: Pick<ImageItem, "path" | "name" | "x" | "y" | "size" | "opacity">;
  captionPreset?: string;
  intro?: string;
  outro?: string;
  progress: boolean;
}

const STORAGE_KEY = "downkit.brandKits";
const isColor = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
const isFont = (v: unknown): v is FontId => FONTS.some((f) => f.id === v);
const num = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;

export function parseKits(raw: unknown): BrandKit[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r: Record<string, unknown>) => {
    if (!r || typeof r.id !== "string" || typeof r.name !== "string" || !r.name.trim()) return [];
    const kit: BrandKit = {
      id: r.id,
      name: r.name.slice(0, 40),
      font: isFont(r.font) ? r.font : "segoeBlack",
      primary: isColor(r.primary) ? r.primary : "#4f7bff",
      accent: isColor(r.accent) ? r.accent : "#ffd43b",
      progress: r.progress === true,
    };
    const logo = r.logo as Record<string, unknown> | undefined;
    if (logo && typeof logo.path === "string") {
      kit.logo = {
        path: logo.path,
        name: typeof logo.name === "string" ? logo.name : "logo",
        x: num(logo.x, 0, 1, 0.88),
        y: num(logo.y, 0, 1, 0.08),
        size: num(logo.size, 0.02, 1, 0.16),
        opacity: num(logo.opacity, 0.05, 1, 1),
      };
    }
    if (typeof r.captionPreset === "string" && presetById(r.captionPreset).id === r.captionPreset) {
      kit.captionPreset = r.captionPreset;
    }
    if (typeof r.intro === "string" && r.intro.trim()) kit.intro = r.intro.slice(0, 80);
    if (typeof r.outro === "string" && r.outro.trim()) kit.outro = r.outro.slice(0, 80);
    return [kit];
  });
}

function load(): BrandKit[] {
  try {
    return parseKits(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

interface KitState {
  kits: BrandKit[];
  save: (kit: BrandKit) => void;
  remove: (id: string) => void;
}

export const useBrandKits = create<KitState>((set, get) => {
  const persist = (kits: BrandKit[]) => {
    set({ kits });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(kits));
    } catch {
      // Saklanamazsa yalnızca bu oturumda.
    }
  };
  return {
    kits: load(),
    save: (kit) => {
      const kits = get().kits;
      persist(
        kits.some((k) => k.id === kit.id)
          ? kits.map((k) => (k.id === kit.id ? kit : k))
          : [...kits, kit],
      );
    },
    remove: (id) => persist(get().kits.filter((k) => k.id !== id)),
  };
});

/** Şu anki projeden kit taslağı: seçili ya da ilk yazının yazı tipi, ilk logo, altyazı stili. */
export function kitFromProject(name: string): BrandKit {
  const s = useEditorStore.getState();
  const text =
    s.texts.find((x) => x.id === s.selectedTextId) ?? s.texts.find((x) => x.font) ?? s.texts[0];
  const caption = s.texts.find((x) => x.auto && x.preset);
  const logo = s.images[0];
  return {
    id: crypto.randomUUID(),
    name: name.trim().slice(0, 40),
    font: text?.font ?? "segoeBlack",
    primary: text?.bg ?? "#4f7bff",
    accent: caption?.highlight?.color ?? "#ffd43b",
    ...(logo
      ? {
          logo: {
            path: logo.path,
            name: logo.name,
            x: logo.x,
            y: logo.y,
            size: logo.size,
            opacity: logo.opacity,
          },
        }
      : {}),
    ...(caption?.preset ? { captionPreset: caption.preset } : {}),
    progress: s.exportOptions.progressBar !== null,
  };
}

/** Yazıyı kitin renk ve yazı tipine boyar (şerit varsa ana renk, vurgu rengi korunur). */
export function brandText(t: TextItem, kit: BrandKit): TextItem {
  const next: TextItem = { ...t, font: kit.font };
  if (t.bg) next.bg = kit.primary;
  if (t.highlight) next.highlight = { ...t.highlight, color: kit.accent };
  return next;
}

/** Kiti projeye uygular. Logo projede yoksa eklenir; açılış / kapanış yazıları değişir. */
export function applyBrandKit(kit: BrandKit) {
  const editor = useEditorStore.getState();
  const duration = sequenceEnd(editor.clips);
  // Seçili yazı varsa stil yalnız ona gitmesin: kit bütün otomatik altyazılara.
  editor.selectText(null);
  if (kit.captionPreset && editor.texts.some((x) => x.auto)) applyCaptionPreset(kit.captionPreset);
  const extra: TextItem[] = [];
  const add = (templateId: string, text: string | undefined) => {
    const tpl = templateById(templateId);
    if (!tpl || !text) return;
    extra.push(
      ...templateTexts(tpl, duration, newClipId, () => text).map((x) => ({
        ...x,
        font: kit.font,
        ...(x.bg ? { bg: kit.primary } : { color: kit.accent }),
      })),
    );
  };
  add("hookStop", kit.intro);
  add("endFollow", kit.outro);
  useEditorStore.getState().applyTexts((texts) => [
    ...texts
      .filter((x) => !(kit.intro && x.tpl === "hook") && !(kit.outro && x.tpl === "end"))
      .map((x) =>
        x.auto
          ? {
              ...x,
              font: kit.font,
              ...(x.highlight ? { highlight: { ...x.highlight, color: kit.accent } } : {}),
            }
          : brandText(x, kit),
      ),
    ...extra,
  ]);
  if (kit.progress) {
    const bar = useEditorStore.getState().exportOptions.progressBar;
    editor.setExportOptions({
      progressBar: { color: kit.accent, height: bar?.height ?? 0.012, top: bar?.top ?? false },
    });
  }
  if (kit.logo && !useEditorStore.getState().images.some((i) => i.path === kit.logo!.path)) {
    const s = useEditorStore.getState();
    const item = { ...newImage(newClipId(), kit.logo.path, 0, Math.max(1, duration)), ...kit.logo };
    s.applyLayers({ images: [...s.images, item] });
    ensureMediaUrl(kit.logo.path, "image");
  }
}

export const defaultKitName = () => i18n.t("brand.defaultName");
