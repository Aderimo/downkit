import { FRAME_SIZES, type ExportOptions } from "../store/editorStore";
import { effectiveSplit, GRADIENTS, layoutStyle, withStyle, type SplitStyle } from "./splitLayout";

// Dikey düzen galerisinin seçenekleri: her kart dışa aktarma seçeneklerinin bir
// birleşimidir (kırp / sığdır + arka plan / kamera + oyun düzeni).

export type FrameLayoutId =
  | "crop"
  | "fit"
  | "blur"
  | "gradient"
  | "stackTop"
  | "stackBottom"
  | "duo"
  | "podcast"
  | "circle"
  | "pip";

export const FRAME_LAYOUTS: readonly FrameLayoutId[] = [
  "crop",
  "blur",
  "fit",
  "gradient",
  "stackTop",
  "stackBottom",
  "duo",
  "podcast",
  "circle",
  "pip",
];

/** Şimdiki seçeneklerden seçili düzen. */
export function currentLayout(o: ExportOptions): FrameLayoutId {
  if (o.frameSplit) {
    const style = o.split ? layoutStyle(o.split) : "stack";
    if (style === "stack") return o.split?.camTop === false ? "stackBottom" : "stackTop";
    return style;
  }
  if (!o.frameFit) return "crop";
  if (o.frameBlur) return "blur";
  return o.frameGradient ? "gradient" : "fit";
}

/** Düzeni seçince değişecek dışa aktarma seçenekleri. */
export function layoutOptions(
  id: FrameLayoutId,
  o: ExportOptions,
  sourceAspect: number,
): Partial<ExportOptions> {
  if (o.frame === "original") return {};
  const [fw, fh] = FRAME_SIZES[o.frame];
  const split = (style: SplitStyle, camTop = true): Partial<ExportOptions> => ({
    frameSplit: true,
    split: {
      ...withStyle(effectiveSplit(o.split, sourceAspect, fw, fh), style, sourceAspect, fw, fh),
      camTop,
    },
  });
  switch (id) {
    case "crop":
      return { frameSplit: false, frameFit: false, frameBlur: false };
    case "fit":
      return { frameSplit: false, frameFit: true, frameBlur: false, frameGradient: null };
    case "blur":
      return { frameSplit: false, frameFit: true, frameBlur: true };
    case "gradient":
      return {
        frameSplit: false,
        frameFit: true,
        frameBlur: false,
        frameGradient: o.frameGradient ?? [...GRADIENTS[0]],
      };
    case "stackTop":
      return split("stack", true);
    case "stackBottom":
      return split("stack", false);
    default:
      return split(id);
  }
}
