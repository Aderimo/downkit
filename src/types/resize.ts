export type FitMode = "crop" | "pad";

export interface ResizeRequest {
  inputPath: string;
  destinationDir: string;
  targetWidth: number;
  targetHeight: number;
  fitMode: FitMode;
}

export interface AspectRatio {
  id: string;
  labelKey: string;
  ratioW: number;
  ratioH: number;
}

export const ASPECT_RATIOS: AspectRatio[] = [
  { id: "16:9", labelKey: "resize.ratio16x9", ratioW: 16, ratioH: 9 },
  { id: "9:16", labelKey: "resize.ratio9x16", ratioW: 9, ratioH: 16 },
  { id: "1:1", labelKey: "resize.ratio1x1", ratioW: 1, ratioH: 1 },
  { id: "4:5", labelKey: "resize.ratio4x5", ratioW: 4, ratioH: 5 },
  { id: "4:3", labelKey: "resize.ratio4x3", ratioW: 4, ratioH: 3 },
];

export interface PlatformPreset {
  id: string;
  labelKey: string;
  /** İkon için marka. */
  brand: "tiktok" | "instagram" | "youtube";
  ratio: AspectRatio;
  longEdge: number;
}

export const PLATFORM_PRESETS: PlatformPreset[] = [
  {
    id: "reels",
    labelKey: "resize.presetReels",
    brand: "instagram",
    ratio: ASPECT_RATIOS[1],
    longEdge: 1920,
  },
  {
    id: "tiktok",
    labelKey: "resize.presetTiktok",
    brand: "tiktok",
    ratio: ASPECT_RATIOS[1],
    longEdge: 1920,
  },
  {
    id: "youtube",
    labelKey: "resize.presetYoutube",
    brand: "youtube",
    ratio: ASPECT_RATIOS[0],
    longEdge: 1920,
  },
  {
    id: "shorts",
    labelKey: "resize.presetShorts",
    brand: "youtube",
    ratio: ASPECT_RATIOS[1],
    longEdge: 1920,
  },
  {
    id: "instagram-post",
    labelKey: "resize.presetInstagramPost",
    brand: "instagram",
    ratio: ASPECT_RATIOS[2],
    longEdge: 1080,
  },
];

export function findPlatformPreset(id: string): PlatformPreset | undefined {
  return PLATFORM_PRESETS.find((p) => p.id === id);
}

/// Oran ve "uzun kenar" değerinden hedef genişlik/yükseklik hesaplar.
export function resolveTargetSize(
  ratio: AspectRatio,
  longEdge: number,
): { width: number; height: number } {
  if (ratio.ratioW === ratio.ratioH) {
    return { width: longEdge, height: longEdge };
  }
  if (ratio.ratioW > ratio.ratioH) {
    return { width: longEdge, height: Math.round((longEdge * ratio.ratioH) / ratio.ratioW) };
  }
  return { width: Math.round((longEdge * ratio.ratioW) / ratio.ratioH), height: longEdge };
}
