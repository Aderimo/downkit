// Resim ve müzik katmanı eylemleri: ekleme, güncelleme, silme ve önizleme
// için dosya adresleri (resim veri adresi, müzik için yerel önizleme sunucusu).

import { create } from "zustand";
import { useEditorStore } from "../store/editorStore";
import { usePlayerStore } from "../store/playerStore";
import {
  IMAGE_EXTENSIONS,
  MUSIC_EXTENSIONS,
  newBlur,
  newImage,
  newMusic,
  musicLane,
  type BlurItem,
  type ImageItem,
  type MusicItem,
} from "./layers";
import { MAX_AUDIO_LANES, sequenceEnd } from "./sequence";
import { chooseFile, imagePreview, openLocalPreview, probeLocalFile } from "./tauri-api";
import i18n from "../i18n";

let counter = 0;
export const nextId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(counter += 1)}`;

/** Önizleme adresleri: dosya yolu → veri adresi (resim) ya da akış adresi (müzik). */
interface LayerMediaState {
  urls: Record<string, string>;
  /** Müzik dosyalarının önizleme belirteci: dalga formu bununla istenir. */
  tokens: Record<string, string>;
  failed: Record<string, true>;
}

export const useLayerMedia = create<LayerMediaState>(() => ({ urls: {}, tokens: {}, failed: {} }));

const pending = new Set<string>();

/** Yolun önizleme adresini (bir kez) yükler. */
export function ensureMediaUrl(path: string, kind: "image" | "music"): void {
  const { urls, failed } = useLayerMedia.getState();
  if (urls[path] || failed[path] || pending.has(path)) return;
  pending.add(path);
  // Hareketli başlıklar video: resim gibi değil, akışla açılır.
  const task =
    kind === "image" && !path.toLowerCase().endsWith(".webm")
      ? imagePreview(path)
      : openLocalPreview(path).then((p) => {
          useLayerMedia.setState((s) => ({ tokens: { ...s.tokens, [path]: p.token } }));
          return p.url;
        });
  void task
    .then((url) => useLayerMedia.setState((s) => ({ urls: { ...s.urls, [path]: url } })))
    .catch(() => useLayerMedia.setState((s) => ({ failed: { ...s.failed, [path]: true } })))
    .finally(() => pending.delete(path));
}

function editor() {
  return useEditorStore.getState();
}

/** Logo ya da resim ekler. Varsayılan: bütün video boyunca, sağ üst köşe. */
export async function addImage(): Promise<ImageItem | null> {
  const path = await chooseFile(i18n.t("editor.imageFiles"), IMAGE_EXTENSIONS);
  return path ? addImageFile(path) : null;
}

/** Seçilen ya da pencereye bırakılan resmi ekler. */
export async function addImageFile(path: string): Promise<ImageItem | null> {
  const end = Math.max(sequenceEnd(editor().clips), 1);
  const item = newImage(nextId("i"), path, 0, end);
  editor().applyLayers({ images: [...editor().images, item] });
  ensureMediaUrl(path, "image");
  return item;
}

/** Bu aralıkta boş olan en üstteki ses izi (A1 = 0). */
export function freeAudioLane(music: readonly MusicItem[], start: number, end: number): number {
  for (let lane = 0; lane < MAX_AUDIO_LANES; lane++) {
    const busy = music.some(
      (m) => musicLane(m) === lane && m.start < end - 1e-6 && m.start + m.length > start + 1e-6,
    );
    if (!busy) return lane;
  }
  return MAX_AUDIO_LANES - 1;
}

/** Müzik ekler: imleçten başlar, video bitince biter (dosya kısaysa dosya kadar). */
export async function addMusic(): Promise<MusicItem | null> {
  const path = await chooseFile(i18n.t("editor.musicFiles"), MUSIC_EXTENSIONS);
  return path ? addMusicFile(path) : null;
}

/** Seçilen ya da pencereye bırakılan ses dosyasını müzik katmanı olarak ekler. */
export async function addMusicFile(path: string): Promise<MusicItem | null> {
  const info = await probeLocalFile(path);
  const duration = info.durationSeconds ?? 0;
  if (duration <= 0.2 || !info.audioCodec) throw new Error(i18n.t("editor.musicNoAudio"));
  const at = usePlayerStore.getState().currentTime;
  const end = sequenceEnd(editor().clips);
  const item = newMusic(nextId("m"), path, duration, at, end > at ? end - at : null);
  // İlk boş ses izine konur (A1 boşsa A1): boş bir iz açılıp müzik A2'ye düşmesin.
  item.lane = freeAudioLane(editor().music, item.start, item.start + item.length);
  editor().applyLayers({ music: [...editor().music, item] });
  ensureMediaUrl(path, "music");
  return item;
}

export function updateImage(id: string, patch: Partial<ImageItem>, live = false) {
  const images = editor().images.map((i) => (i.id === id ? { ...i, ...patch } : i));
  if (live) editor().dragLayers({ images });
  else editor().applyLayers({ images });
}

export function updateMusic(id: string, patch: Partial<MusicItem>, live = false) {
  const music = editor().music.map((m) => (m.id === id ? { ...m, ...patch } : m));
  if (live) editor().dragLayers({ music });
  else editor().applyLayers({ music });
}

export function removeImage(id: string) {
  editor().applyLayers({ images: editor().images.filter((i) => i.id !== id) });
}

export function removeMusic(id: string) {
  editor().applyLayers({ music: editor().music.filter((m) => m.id !== id) });
}

// ——— Gizleme bölgeleri ———

/** Seçili gizleme bölgesi: önizlemede kutusu tutamaçlı görünür. */
export type BlockKind = "text" | "music" | "image" | "blur" | "effect";
export interface BlockRef {
  kind: BlockKind;
  id: string;
}

/** Ctrl+A ya da kutu seçimiyle seçilen yazı ve katman blokları (kliplerle birlikte). */
export const useBlockSelection = create<{
  blocks: BlockRef[];
  set: (blocks: BlockRef[]) => void;
}>((set) => ({ blocks: [], set: (blocks) => set({ blocks }) }));

export const isBlockSelected = (blocks: readonly BlockRef[], kind: BlockKind, id: string) =>
  blocks.some((b) => b.kind === kind && b.id === id);

// Tek bir öğeye tıklanınca (seçim tek kliğe/yazıya ya da boşa düşünce) çoklu blok seçimi kalkar.
useEditorStore.subscribe((state, prev) => {
  const single =
    (state.selectedIds !== prev.selectedIds && state.selectedIds.length <= 1) ||
    (state.selectedTextId !== prev.selectedTextId && state.selectedTextId !== null);
  if (single && useBlockSelection.getState().blocks.length > 0)
    useBlockSelection.getState().set([]);
});

/** Zaman çizelgesinde seçili müzik ya da resim bloğu (Delete onu siler). */
export const useLayerSelection = create<{
  kind: "music" | "image" | null;
  id: string | null;
  select: (kind: "music" | "image" | null, id: string | null) => void;
}>((set) => ({ kind: null, id: null, select: (kind, id) => set({ kind, id }) }));

// Klip ya da yazı seçilince blok seçimi kalkar.
useEditorStore.subscribe((state, prev) => {
  if (
    (state.selectedIds !== prev.selectedIds && state.selectedIds.length > 0) ||
    (state.selectedTextId !== prev.selectedTextId && state.selectedTextId !== null)
  ) {
    if (useLayerSelection.getState().id) useLayerSelection.getState().select(null, null);
    if (useBlurSelection.getState().id) useBlurSelection.getState().select(null);
  }
});

/** Müzik, resim, gizleme ya da efekt bloğunu hemen arkasına kopyalar (tek geri alma). */
export function duplicateLayer(kind: "music" | "image" | "blur" | "effect", id: string) {
  const s = editor();
  const key =
    kind === "music"
      ? "music"
      : kind === "image"
        ? "images"
        : kind === "blur"
          ? "blurs"
          : "effects";
  const list = s[key] as { id: string; start: number; end?: number; length?: number }[];
  const item = list.find((i) => i.id === id);
  if (!item) return;
  const length = item.length ?? (item.end ?? item.start) - item.start;
  const copy = {
    ...item,
    id: nextId(kind[0]!),
    start: item.start + length,
    ...(item.end !== undefined ? { end: item.end + length } : {}),
  };
  delete (copy as { linkedClipId?: string }).linkedClipId;
  s.applyLayers({ [key]: [...list, copy] });
}

export const useBlurSelection = create<{ id: string | null; select: (id: string | null) => void }>(
  (set) => ({ id: null, select: (id) => set({ id }) }),
);

/** İmleçten başlayan 5 sn'lik bölge ekler (imleçteki klip daha kısaysa onun sonuna kadar). */
export function addBlur(): BlurItem {
  const at = usePlayerStore.getState().currentTime;
  const end = Math.min(at + 5, Math.max(sequenceEnd(editor().clips), at + 0.5));
  const item = newBlur(nextId("b"), at, end);
  editor().applyLayers({ blurs: [...editor().blurs, item] });
  useBlurSelection.getState().select(item.id);
  return item;
}

export function updateBlur(id: string, patch: Partial<BlurItem>, live = false) {
  const blurs = editor().blurs.map((b) => (b.id === id ? { ...b, ...patch } : b));
  if (live) editor().dragLayers({ blurs });
  else editor().applyLayers({ blurs });
}

export function removeBlur(id: string) {
  editor().applyLayers({ blurs: editor().blurs.filter((b) => b.id !== id) });
  if (useBlurSelection.getState().id === id) useBlurSelection.getState().select(null);
}
