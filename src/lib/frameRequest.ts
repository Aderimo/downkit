import { FRAME_SIZES, type ExportOptions, type FrameAspect } from "../store/editorStore";
import type { EditRequest } from "../types/edit";
import { effectiveSplit } from "./splitLayout";
import type { Track } from "./faceTrack";

// Dışa aktarmanın çerçeve isteği (Rust `Frame`): video ve kapak görseli aynı düzenle
// çıksın diye tek yerde kurulur.

export function frameRequest(
  options: ExportOptions,
  sourceAspect: number,
  /** Yüz takibi açıksa çıktı saniyesinde kırpma izi. */
  track: Track | null,
): NonNullable<EditRequest["frame"]> | null {
  if (options.frame === "original") return null;
  const [width, height] = FRAME_SIZES[options.frame as Exclude<FrameAspect, "original">];
  const fit = options.frameFit && !options.frameSplit;
  return {
    width,
    height,
    fit,
    blur: fit && options.frameBlur,
    gradient: fit && !options.frameBlur ? options.frameGradient : null,
    track: !options.frameFit && !options.frameSplit ? track : null,
    position: options.framePosition,
    ...(options.frameSplit
      ? { split: effectiveSplit(options.split, sourceAspect, width, height) }
      : {}),
  };
}
