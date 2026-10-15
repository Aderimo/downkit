import { FRAME_SIZES, useEditorStore, type FrameAspect } from "../store/editorStore";
import { usePlayerStore } from "../store/playerStore";
import { buildAss } from "./captionAss";
import { currentCropPosition } from "./faceActions";
import { frameRequest } from "./frameRequest";
import { flatten, segmentAt, sourceTimeAt } from "./sequence";
import { saveCoverImage } from "./tauri-api";
import { newText, type TextItem } from "./textItems";

// Kapak görseli: imleçteki kare, dışa aktarmanın düzeniyle (kırpma, arka plan, kamera
// düzenleri) tam çözünürlükte; üstüne başlık altyazı motoruyla (ASS) yazılır. Resimler
// klasörüne JPEG olarak kaydedilir.

export const COVER_STYLES = ["bold", "band", "clean"] as const;
export type CoverStyle = (typeof COVER_STYLES)[number];

/** Başlık yazısı: kapakta büyük ve okunaklı. */
export function coverText(title: string, style: CoverStyle): TextItem {
  const base = { ...newText("cover", 0, title), end: 10, box: false, bold: true };
  switch (style) {
    case "band":
      return {
        ...base,
        y: 0.2,
        size: 0.075,
        font: "segoeBlack",
        color: "#ffffff",
        bg: "#e11d48",
        bgOpacity: 1,
      };
    case "clean":
      return {
        ...base,
        y: 0.78,
        size: 0.065,
        font: "bahnschrift",
        color: "#ffffff",
        shadow: 0.8,
        spacing: 0.04,
      };
    default:
      return {
        ...base,
        y: 0.22,
        size: 0.1,
        font: "impact",
        color: "#ffd43b",
        stroke: 0.09,
        upper: true,
      };
  }
}

/** İmleçteki karenin kaynağı ve kaynak saniyesi (boşluktaysa null). */
export function frameAtPlayhead(): { path: string; seconds: number } | null {
  const s = useEditorStore.getState();
  const t = usePlayerStore.getState().currentTime;
  const segment = segmentAt(flatten(s.clips, s.tracks), t);
  if (!segment) return null;
  const entry = s.sources.find((x) => x.id === segment.sourceId) ?? s.sources[0];
  if (!entry) return null;
  return { path: entry.source.path, seconds: sourceTimeAt(segment, t) };
}

/** Kapağı kaydeder; dosya yolu döner. İmleç boşluktaysa null. */
export async function saveCover(title: string, style: CoverStyle): Promise<string | null> {
  const at = frameAtPlayhead();
  if (!at) return null;
  const s = useEditorStore.getState();
  const info = s.sources.find((x) => x.source.path === at.path)?.source.info;
  const sourceAspect = info?.width && info.height ? info.width / info.height : 16 / 9;
  // Yüz takibi açıksa kadraj imleçteki yerinde sabitlenir.
  const options = {
    ...s.exportOptions,
    framePosition: currentCropPosition(usePlayerStore.getState().currentTime),
  };
  const frame = frameRequest(options, sourceAspect, null);
  const size =
    options.frame === "original"
      ? { width: info?.width ?? 1920, height: info?.height ?? 1080 }
      : {
          width: FRAME_SIZES[options.frame as Exclude<FrameAspect, "original">][0],
          height: FRAME_SIZES[options.frame as Exclude<FrameAspect, "original">][1],
        };
  const ass = title.trim()
    ? buildAss([coverText(title.trim(), style)], [{ tStart: 0, tEnd: 10 }], size)
    : null;
  const name = `${s.exportOptions.outputName.trim() || "kapak"} - kapak`;
  return saveCoverImage(at.path, at.seconds, frame, ass, name);
}
