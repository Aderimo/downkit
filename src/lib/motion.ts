// Hareketli başlıklar: EffectCraft şablonundan çizilen saydam video, resim
// katmanı olarak (konum, boyut, saydamlık, zaman aynı) videonun üstüne biner.

import { create } from "zustand";
import i18n from "../i18n";
import { FRAME_SIZES, useEditorStore } from "../store/editorStore";
import { usePlayerStore } from "../store/playerStore";
import { fileName, type ImageItem, type MotionSpec } from "./layers";
import { ensureMediaUrl, nextId } from "./layerActions";
import { chooseFile, motionRender, motionTemplates, type MotionTemplate } from "./tauri-api";

/** Kullanıcının Lottie animasyonu: şablon adı bu, ilk değer dosya yolu. */
export const LOTTIE = "lottie";

/** Resim katmanı hareketli başlık mı. */
export function isMotion(item: ImageItem): boolean {
  return !!item.motion || item.path.toLowerCase().endsWith(".webm");
}

/** Şablonun bu dildeki varsayılan değerleri: çevirideki metinler, yoksa şablonunkiler. */
export function defaultValues(template: MotionTemplate): string[] {
  const texts = i18n.t(`motion.tpl.${template.id}.values`, { returnObjects: true });
  const list = Array.isArray(texts) ? (texts as string[]) : [];
  let k = 0;
  return template.controls.map((c) => (c.kind === "text" ? (list[k++] ?? c.value) : c.value));
}

/** Denetimin görünen adı ("Bar Color" → "Şerit rengi"). */
export function controlLabel(name: string): string {
  const key = `motion.control.${name.replace(/[^A-Za-z0-9]/g, "")}`;
  return i18n.exists(key) ? i18n.t(key) : name;
}

/** Çıkış karesinin en-boy oranı (çerçeve seçili değilse ilk kaynağınki). */
function outputAspect(): number {
  const s = useEditorStore.getState();
  const frame = s.exportOptions.frame;
  if (frame !== "original") return FRAME_SIZES[frame][0] / FRAME_SIZES[frame][1];
  const info = s.sources[0]?.source.info;
  return info?.width && info.height ? info.width / info.height : 16 / 9;
}

/** Şablon kareye sığsın: genişlik oranı (ImageItem.size). */
export function fitSize(template: { width: number; height: number }, aspect: number): number {
  const own = template.width / Math.max(1, template.height);
  return Math.min(1, own / aspect);
}

/** Şablon listesi bir kez yüklenir. */
export const useMotionTemplates = create<{
  list: MotionTemplate[] | null;
  failed: boolean;
}>(() => ({ list: null, failed: false }));

let loading: Promise<void> | null = null;
export function loadMotionTemplates(): Promise<void> {
  loading ??= motionTemplates()
    .then((list) => useMotionTemplates.setState({ list, failed: false }))
    .catch(() => {
      loading = null;
      useMotionTemplates.setState({ failed: true });
    });
  return loading;
}

/** Seçimi çizer ve imleçten başlayan yeni katman olarak ekler. */
export async function addMotionTitle(spec: MotionSpec): Promise<ImageItem> {
  const rendered = await motionRender(spec);
  const editor = useEditorStore.getState();
  const start = usePlayerStore.getState().currentTime;
  const item: ImageItem = {
    id: nextId("i"),
    path: rendered.path,
    name:
      spec.template === LOTTIE
        ? fileName(spec.values[0] ?? "")
        : i18n.t(`motion.tpl.${spec.template}.name`),
    start,
    end: start + Math.max(0.5, rendered.duration),
    x: 0.5,
    y: 0.5,
    size: fitSize(rendered, outputAspect()),
    opacity: 1,
    motion: spec,
  };
  editor.applyLayers({ images: [...editor.images, item] });
  ensureMediaUrl(rendered.path, "image");
  return item;
}

/** Lottie (.json) animasyonu seçtirir ve başlık gibi ekler. */
export async function addLottie(): Promise<ImageItem | null> {
  const path = await chooseFile(i18n.t("motion.lottieFiles"), ["json"]);
  if (!path) return null;
  return addMotionTitle({ template: LOTTIE, values: [path], background: false });
}

/** Var olan başlığın metnini/rengini değiştirir: yeniden çizer, yerini korur. */
export async function updateMotionTitle(id: string, spec: MotionSpec): Promise<void> {
  const { path } = await motionRender(spec);
  const editor = useEditorStore.getState();
  editor.applyLayers({
    images: editor.images.map((i) => (i.id === id ? { ...i, path, motion: spec } : i)),
  });
  ensureMediaUrl(path, "image");
}
