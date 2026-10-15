import { create } from "zustand";
import { newClipId, useEditorStore } from "../store/editorStore";
import { groupWords } from "./autoCaptions";
import { applyAutoEmoji, carryEmoji, clearEmoji, withEmoji } from "./captionEmoji";
import { applyLook, presetById, type CaptionLook } from "./captionPresets";
import type { WordTiming } from "./captionStyle";
import { newText, type TextItem } from "./textItems";
import { displayText } from "./captionStyle";
import { toSrt, toVtt, type SubtitleCue } from "./subtitles";
import { chooseSubtitleSavePath, textFileWrite } from "./tauri-api";

// Altyazı stüdyosu eylemleri: stil seç, tümüne uygula, satır başına kelime, ayrıntılı ayar.
// Değişiklikler otomatik altyazıların hepsine uygulanır; otomatik olmayan bir yazı
// seçiliyse yalnızca ona.

const STORAGE_KEY = "downkit.captionStudio";

interface CaptionStudio {
  presetId: string;
  /** Satır başına kelime (1 = kelime kelime). */
  words: number;
  /** Anahtar kelimelere emoji eklensin (yeni oluşturulan altyazılarda da). */
  emoji: boolean;
}

function load(): CaptionStudio {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<CaptionStudio>;
    const preset = presetById(typeof raw.presetId === "string" ? raw.presetId : "yellowWord");
    const words =
      typeof raw.words === "number" && raw.words >= 1 && raw.words <= 8
        ? Math.round(raw.words)
        : preset.words;
    return { presetId: preset.id, words, emoji: raw.emoji === true };
  } catch {
    return { presetId: "yellowWord", words: presetById("yellowWord").words, emoji: false };
  }
}

export const useCaptionStudio = create<
  CaptionStudio & { set: (patch: Partial<CaptionStudio>) => void }
>((set, get) => ({
  ...load(),
  set: (patch) => {
    set(patch);
    try {
      const { presetId, words, emoji } = get();
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ presetId, words, emoji }));
    } catch {
      // Saklanamazsa yalnızca bu oturumda geçerli.
    }
  },
}));

const editor = () => useEditorStore.getState();

/** Stüdyonun düzenlediği yazılar: seçili otomatik olmayan yazı varsa o, yoksa tüm otomatik altyazılar. */
export function captionTargets(texts: readonly TextItem[], selectedId: string | null): string[] {
  const selected = texts.find((t) => t.id === selectedId);
  if (selected && !selected.auto) return [selected.id];
  return texts.filter((t) => t.auto).map((t) => t.id);
}

/** Yeni oluşturulan altyazının görünümü: seçili stil. */
export function currentCaptionLook(): CaptionLook {
  return presetById(useCaptionStudio.getState().presetId).look;
}

/** Hazır stili seçer ve hedef yazılara uygular; stilin önerdiği kelime sayısı da gelir. */
export function applyCaptionPreset(id: string) {
  const preset = presetById(id);
  useCaptionStudio.getState().set({ presetId: preset.id });
  const s = editor();
  const ids = captionTargets(s.texts, s.selectedTextId);
  if (ids.length === 0) return;
  s.applyTexts((texts) =>
    texts.map((t) =>
      ids.includes(t.id) ? { ...applyLook(t, preset.look), preset: preset.id } : t,
    ),
  );
  // Kelime kelime stilleri satırları yeniden böler.
  if (
    preset.words !== useCaptionStudio.getState().words &&
    ids.every((x) => s.texts.find((t) => t.id === x)?.auto)
  ) {
    setCaptionWords(preset.words);
  }
}

/** Ayrıntılı ayar (yazı tipi, renk, kontur…): hedef yazıların hepsine. */
export function patchCaptionLook(patch: Partial<CaptionLook>) {
  const s = editor();
  const ids = captionTargets(s.texts, s.selectedTextId);
  if (ids.length === 0) return;
  s.applyTexts((texts) =>
    texts.map((t) => (ids.includes(t.id) ? applyLook(t, { ...pickLook(t), ...patch }) : t)),
  );
}

const LOOK_KEYS: (keyof CaptionLook)[] = [
  "x",
  "y",
  "size",
  "color",
  "box",
  "bold",
  "anim",
  "font",
  "stroke",
  "strokeColor",
  "shadow",
  "glow",
  "bg",
  "bgOpacity",
  "upper",
  "italic",
  "spacing",
  "highlight",
];

export function pickLook(t: TextItem): CaptionLook {
  const out = {} as Record<string, unknown>;
  for (const key of LOOK_KEYS) out[key] = t[key];
  return out as unknown as CaptionLook;
}

/**
 * Otomatik altyazıları satır başına `n` kelimeyle yeniden böler. Kelime zamanları
 * korunur; görünüm ilk altyazınınki olur. Düzeltilmiş metinler kelimelerden gelir.
 */
export function regroupCaptions(
  texts: readonly TextItem[],
  n: number,
  newId: () => string,
): TextItem[] {
  const autos = texts.filter((t) => t.auto).sort((a, b) => a.start - b.start);
  if (autos.length === 0) return [...texts];
  const words: WordTiming[] = autos.flatMap((t) =>
    t.words && t.words.length > 0 ? t.words : [{ text: t.text, start: t.start, end: t.end }],
  );
  // Her yeni satır, ilk kelimesinin eskiden bulunduğu satırın görünümünü alır: tek tek
  // değiştirilmiş satırların stili yeniden bölünce kaybolmaz.
  const owner = (t: number) =>
    autos.find((a) => t >= a.start - 1e-3 && t < a.end) ??
    [...autos].reverse().find((a) => a.start <= t) ??
    autos[0];
  const chunks = groupWords(words, n <= 1 ? "word" : "line", Math.max(1, n));
  const fresh = chunks.map((c) => {
    const from = owner(c.start);
    return {
      ...applyLook(newText(newId(), c.start, c.text), pickLook(from)),
      end: c.end,
      words: c.words,
      auto: true,
      ...(from.preset ? { preset: from.preset } : {}),
    };
  });
  return [...texts.filter((t) => !t.auto), ...carryEmoji(autos, fresh)];
}

export function setCaptionWords(n: number) {
  const words = Math.min(8, Math.max(1, Math.round(n)));
  useCaptionStudio.getState().set({ words });
  const s = editor();
  if (!s.texts.some((t) => t.auto)) return;
  s.applyTexts((texts) => regroupCaptions(texts, words, newClipId));
}

// ——— Emoji ———

/** Emojileri aç / kapat: açılınca anahtar kelimelere göre önerilir, kapanınca kaldırılır. */
export function setCaptionEmoji(on: boolean) {
  useCaptionStudio.getState().set({ emoji: on });
  const s = editor();
  if (!s.texts.some((t) => t.auto)) return;
  s.applyTexts((texts) => (on ? applyAutoEmoji(texts, true) : clearEmoji(texts)));
}

/** Tek satırın emojisi (undefined: kaldır). */
export function setLineEmoji(id: string, emoji: string | undefined) {
  editor().applyTexts((texts) => texts.map((t) => (t.id === id ? withEmoji(t, emoji) : t)));
}

// ——— Altyazı dosyası (SRT / VTT) ———

/** Dosyaya yazılacak satırlar: otomatik altyazılar; yoksa bütün yazılar. */
export function captionCues(texts: readonly TextItem[]): SubtitleCue[] {
  const autos = texts.filter((t) => t.auto && t.text.trim());
  const list = autos.length > 0 ? autos : texts.filter((t) => t.text.trim());
  return list.map((t) => ({ start: t.start, end: t.end, text: displayText(t.text, t.upper) }));
}

/** Altyazıları dosyaya kaydettirir. Kaydedildiyse yol, vazgeçildiyse null. */
export async function saveSubtitleFile(ext: "srt" | "vtt", name: string): Promise<string | null> {
  const cues = captionCues(editor().texts);
  if (cues.length === 0) return null;
  const path = await chooseSubtitleSavePath(name, ext);
  if (!path) return null;
  await textFileWrite(path, ext === "srt" ? toSrt(cues) : toVtt(cues));
  return path;
}

/** Dışa aktarmanın yanına aynı adla .srt (seçiliyse). */
export async function writeSideSrt(dir: string, name: string): Promise<void> {
  const cues = captionCues(editor().texts);
  if (cues.length === 0) return;
  const sep = /[\\/]$/.test(dir) ? "" : "\\";
  await textFileWrite(`${dir}${sep}${name}.srt`, toSrt(cues));
}
