// Kamera + oyun düzenleri: yatay yayın kaydından dikey video (Rust `ffmpeg::edit::Split`).
// - stack: kamera üstte (ya da altta), oyun öbür yarıda
// - duo: iki kamera yan yana üstte, oyun altta
// - circle: oyun bütün karede, kamera daire içinde (çerçeveli)
// - pip: oyun bütün karede, kamera köşede yuvarlatılmış kutuda
// - podcast: iki kişi alt alta, yarı yarıya (yatay iki kişilik çekimden)
// Bölgeler kaynağın 0–1 oranıyla tutulur ve her biri çıkıştaki yuvasının en/boy
// oranına kilitlidir: önizlemede seçilen bölge dışa aktarımda birebir aynı çıkar.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SplitStyle = "stack" | "duo" | "circle" | "pip" | "podcast";

/** Daire / köşe kamerasının çıkıştaki yeri: merkez (0–1) ve genişlik payı. */
export interface Spot {
  x: number;
  y: number;
  size: number;
}

export interface SplitLayout {
  cam: Rect;
  game: Rect;
  /** Kameranın çıkış yüksekliğindeki payı (alt alta düzenlerde). */
  camShare: number;
  camTop: boolean;
  /** Yoksa alt alta. */
  style?: SplitStyle;
  /** İki kamera düzeninde ikinci kamera. */
  cam2?: Rect;
  /** Daire / köşe düzeninde kameranın yeri. */
  spot?: Spot;
  /** Daire / köşe kamerasının çerçeve rengi (null: çerçevesiz). */
  ring?: string | null;
  /** Alt alta düzenlerde kamera ile oyun arasında renkli şerit (logo, başlık için). */
  band?: Band | null;
}

export interface Band {
  /** Çıkış yüksekliğindeki payı. */
  share: number;
  color: string;
}

export const CAM_SHARE_RANGE = { min: 0.2, max: 0.6 };
export const BAND_RANGE = { min: 0.04, max: 0.25 };
export const DEFAULT_BAND: Band = { share: 0.1, color: "#000000" };
/** Oyuna en az bu pay kalır (şerit ve kamera büyüyünce). */
const MIN_GAME_SHARE = 0.3;
export const DEFAULT_CAM_SHARE = 0.35;
export const SPOT_SIZE_RANGE = { min: 0.2, max: 0.7 };
export const RING_COLORS = ["#ffffff", "#ffd43b", "#4f7bff", "#ff4d6d", "#4ade80", "#000000"];

/** Hazır kamera yerleri (daire / köşe). */
export const SPOT_PRESETS = {
  topLeft: { x: 0.24, y: 0.14 },
  topRight: { x: 0.76, y: 0.14 },
  center: { x: 0.5, y: 0.5 },
  bottomLeft: { x: 0.24, y: 0.82 },
  bottomCenter: { x: 0.5, y: 0.8 },
  bottomRight: { x: 0.76, y: 0.82 },
} as const;
export type SpotPreset = keyof typeof SPOT_PRESETS;

const DEFAULT_SPOT: Record<"circle" | "pip", Spot> = {
  circle: { x: 0.5, y: 0.8, size: 0.42 },
  pip: { x: 0.76, y: 0.14, size: 0.4 },
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const layoutStyle = (l: SplitLayout): SplitStyle => l.style ?? "stack";

/** Şerit alt alta düzenlerde (alt alta, iki kamera, podcast) olur. */
export const stacked = (style: SplitStyle) =>
  style === "stack" || style === "duo" || style === "podcast";

/** Şeridin payı (yoksa ya da düzen alt alta değilse 0). */
export function bandShare(l: Pick<SplitLayout, "band" | "style">): number {
  if (!l.band || !stacked(l.style ?? "stack")) return 0;
  return clamp(l.band.share, BAND_RANGE.min, BAND_RANGE.max);
}

/** Yuvaların en/boy oranı (genişlik / yükseklik, piksel). */
export function slotAspects(
  camShare: number,
  frameW: number,
  frameH: number,
  style: SplitStyle = "stack",
  band = 0,
) {
  const share = clamp(
    camShare,
    CAM_SHARE_RANGE.min,
    Math.min(CAM_SHARE_RANGE.max, 1 - band - MIN_GAME_SHARE),
  );
  const game = frameW / (frameH * (1 - share - band));
  switch (style) {
    case "duo":
      return { cam: frameW / 2 / (frameH * share), game };
    case "circle":
      return { cam: 1, game: frameW / frameH };
    case "pip":
      return { cam: 4 / 3, game: frameW / frameH };
    default:
      return { cam: frameW / (frameH * share), game };
  }
}

/** Bölgeyi piksel en/boy oranı `aspect` olacak şekilde düzeltir; merkez korunur,
 * kaynağın dışına taşmaz. `sourceAspect`: kaynağın genişlik/yüksekliği. */
export function fitRect(r: Rect, aspect: number, sourceAspect: number): Rect {
  // Piksel oranı (w*SW)/(h*SH) = (w/h)*sourceAspect.
  let w = clamp(r.w, 0.03, 1);
  let h = (w * sourceAspect) / aspect;
  if (h > 1) {
    h = 1;
    w = (aspect / sourceAspect) * h;
  }
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  return {
    x: clamp(cx - w / 2, 0, 1 - w),
    y: clamp(cy - h / 2, 0, 1 - h),
    w,
    h,
  };
}

/** Başlangıç düzeni: kamera sağ üst köşede (yayıncıların çoğu oraya koyar), oyun ortada. */
export function defaultSplit(
  sourceAspect: number,
  frameW: number,
  frameH: number,
  style: SplitStyle = "stack",
): SplitLayout {
  const slots = slotAspects(DEFAULT_CAM_SHARE, frameW, frameH, style);
  const cam = fitRect({ x: 0.72, y: 0.03, w: 0.26, h: 0.3 }, slots.cam, sourceAspect);
  const game = fitRect({ x: 0, y: 0, w: 1, h: 1 }, slots.game, sourceAspect);
  const base: SplitLayout = {
    cam: { ...cam, x: 1 - cam.w - 0.02, y: 0.03 },
    game: { ...game, x: (1 - game.w) / 2, y: (1 - game.h) / 2 },
    camShare: DEFAULT_CAM_SHARE,
    camTop: true,
  };
  if (style === "stack") return base;
  if (style === "podcast") return podcastDefault(sourceAspect, frameW, frameH);
  if (style === "duo") {
    return { ...base, style, cam2: { ...base.cam, x: 0.02 } };
  }
  return { ...base, style, spot: { ...DEFAULT_SPOT[style] }, ring: "#ffffff" };
}

/** Pay ya da düzen değişince bölgeler yeni yuva oranlarına uyarlanır. */
export function withShare(
  layout: SplitLayout,
  camShare: number,
  sourceAspect: number,
  frameW: number,
  frameH: number,
): SplitLayout {
  const style = layoutStyle(layout);
  const band = bandShare(layout);
  const share = clamp(
    camShare,
    CAM_SHARE_RANGE.min,
    Math.min(CAM_SHARE_RANGE.max, 1 - band - MIN_GAME_SHARE),
  );
  const slots = slotAspects(share, frameW, frameH, style, band);
  const next: SplitLayout = {
    ...layout,
    camShare: share,
    cam: fitRect(layout.cam, slots.cam, sourceAspect),
    game: fitRect(layout.game, slots.game, sourceAspect),
  };
  if (style === "duo") {
    next.cam2 = fitRect(layout.cam2 ?? { ...layout.cam, x: 0.02 }, slots.cam, sourceAspect);
  }
  if (style === "circle" || style === "pip") {
    const spot = layout.spot ?? DEFAULT_SPOT[style];
    next.spot = {
      x: clamp(spot.x, 0, 1),
      y: clamp(spot.y, 0, 1),
      size: clamp(spot.size, SPOT_SIZE_RANGE.min, SPOT_SIZE_RANGE.max),
    };
    if (next.ring === undefined) next.ring = "#ffffff";
  }
  return next;
}

/** Düzen türünü değiştirir; bölgelerin yeri korunur, oranlar yeni yuvalara uyar. */
export function withStyle(
  layout: SplitLayout,
  style: SplitStyle,
  sourceAspect: number,
  frameW: number,
  frameH: number,
): SplitLayout {
  const next: SplitLayout = { ...layout, style };
  if (style === "stack") delete next.style;
  if (style === "duo" && !next.cam2) next.cam2 = { ...layout.cam, x: 0.02 };
  if (style === "podcast" && layoutStyle(layout) !== "podcast") {
    return podcastDefault(sourceAspect, frameW, frameH);
  }
  if ((style === "circle" || style === "pip") && layoutStyle(layout) !== style) {
    next.spot = { ...DEFAULT_SPOT[style] };
  }
  return withShare(next, next.camShare, sourceAspect, frameW, frameH);
}

/** Podcast başlangıcı: soldaki kişi üstte, sağdaki altta; yarı yarıya. */
function podcastDefault(sourceAspect: number, frameW: number, frameH: number): SplitLayout {
  const slots = slotAspects(0.5, frameW, frameH, "podcast");
  return {
    style: "podcast",
    camShare: 0.5,
    camTop: true,
    cam: fitRect({ x: 0.05, y: 0.1, w: 0.4, h: 0.8 }, slots.cam, sourceAspect),
    game: fitRect({ x: 0.55, y: 0.1, w: 0.4, h: 0.8 }, slots.game, sourceAspect),
  };
}

/**
 * İki kişiyi yüzlerine göre yerleştirir: örnek karelerdeki yüzler soldakiler ve
 * sağdakiler diye ikiye ayrılır (en büyük yatay boşluktan), her grubun ortanca yüzü
 * etrafına yuvaya uyan bir bölge çizilir (yüz üst üçte bire yakın, omuzlar görünsün).
 */
export function podcastFromFaces(
  layout: SplitLayout,
  faces: readonly [number, number, number, number][],
  sourceAspect: number,
  frameW: number,
  frameH: number,
): SplitLayout | null {
  if (faces.length < 2) return null;
  const centers = faces.map((f) => ({ cx: f[0] + f[2] / 2, cy: f[1] + f[3] / 2, h: f[3] }));
  const xs = [...centers].sort((a, b) => a.cx - b.cx);
  let gap = 0;
  let cut = -1;
  for (let i = 1; i < xs.length; i += 1) {
    if (xs[i].cx - xs[i - 1].cx > gap) {
      gap = xs[i].cx - xs[i - 1].cx;
      cut = i;
    }
  }
  // İki kişi yan yana değilse (tek kişi ya da üst üste) yerleştirilmez.
  if (cut < 0 || gap < 0.15) return null;
  const median = (list: number[]) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
  const slots = slotAspects(layout.camShare, frameW, frameH, "podcast");
  const around = (group: typeof centers, aspect: number): Rect => {
    const cx = median(group.map((g) => g.cx));
    const cy = median(group.map((g) => g.cy));
    const h = Math.min(1, median(group.map((g) => g.h)) * 3.2);
    const w = (h * aspect) / sourceAspect;
    // Yüz bölgenin üstten %40'ında dursun.
    return fitRect({ x: cx - w / 2, y: cy - h * 0.4, w, h }, aspect, sourceAspect);
  };
  return {
    ...layout,
    style: "podcast",
    cam: around(xs.slice(0, cut), slots.cam),
    game: around(xs.slice(cut), slots.game),
  };
}

/** Bölgeyi taşır (kaynağın içinde kalır). */
export function moveRect(r: Rect, dx: number, dy: number): Rect {
  return { ...r, x: clamp(r.x + dx, 0, 1 - r.w), y: clamp(r.y + dy, 0, 1 - r.h) };
}

/** Sağ alt tutamaçla büyütüp küçültür; oran kilitli, sol üst köşe sabit. */
export function resizeRect(r: Rect, dw: number, aspect: number, sourceAspect: number): Rect {
  let w = clamp(r.w + dw, 0.05, 1 - r.x);
  let h = (w * sourceAspect) / aspect;
  if (r.y + h > 1) {
    h = 1 - r.y;
    w = (aspect / sourceAspect) * h;
  }
  return { ...r, w, h };
}

/** Dışa aktarımda ve önizlemede kullanılan düzen: kayıtlı düzen (yoksa varsayılan)
 * o anki kaynak ve çerçeve oranına uyarlanır. */
export function effectiveSplit(
  layout: SplitLayout | null,
  sourceAspect: number,
  frameW: number,
  frameH: number,
): SplitLayout {
  const base = layout ?? defaultSplit(sourceAspect, frameW, frameH);
  return withShare(base, base.camShare, sourceAspect, frameW, frameH);
}

const isColor = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

/** Kayıttan/dosyadan gelen düzeni doğrular. */
export function parseSplit(raw: unknown): SplitLayout | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (o: Record<string, unknown>, k: string) =>
    typeof o[k] === "number" && Number.isFinite(o[k]) ? (o[k] as number) : NaN;
  const rect = (v: unknown): Rect | null => {
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    const out = { x: num(o, "x"), y: num(o, "y"), w: num(o, "w"), h: num(o, "h") };
    return Object.values(out).some(Number.isNaN) ? null : out;
  };
  const cam = rect(r.cam);
  const game = rect(r.game);
  if (!cam || !game) return null;
  const out: SplitLayout = {
    cam,
    game,
    camShare:
      typeof r.camShare === "number" && Number.isFinite(r.camShare)
        ? clamp(r.camShare, CAM_SHARE_RANGE.min, CAM_SHARE_RANGE.max)
        : DEFAULT_CAM_SHARE,
    camTop: r.camTop !== false,
  };
  if (r.style === "duo" || r.style === "circle" || r.style === "pip" || r.style === "podcast") {
    out.style = r.style;
  }
  const cam2 = rect(r.cam2);
  if (cam2) out.cam2 = cam2;
  if (r.spot && typeof r.spot === "object") {
    const o = r.spot as Record<string, unknown>;
    const spot = { x: num(o, "x"), y: num(o, "y"), size: num(o, "size") };
    if (!Object.values(spot).some(Number.isNaN)) {
      out.spot = {
        x: clamp(spot.x, 0, 1),
        y: clamp(spot.y, 0, 1),
        size: clamp(spot.size, SPOT_SIZE_RANGE.min, SPOT_SIZE_RANGE.max),
      };
    }
  }
  if (r.ring === null || isColor(r.ring)) out.ring = r.ring as string | null;
  if (r.band && typeof r.band === "object") {
    const b = r.band as Record<string, unknown>;
    const share = num(b, "share");
    if (!Number.isNaN(share) && isColor(b.color)) {
      out.band = { share: clamp(share, BAND_RANGE.min, BAND_RANGE.max), color: b.color };
    }
  }
  return out;
}

// ——— Arka plan geçişi (sığdırınca boşluklar) ———

export const GRADIENTS: readonly [string, string][] = [
  ["#1e3a8a", "#9333ea"],
  ["#0f172a", "#334155"],
  ["#f97316", "#db2777"],
  ["#064e3b", "#0ea5e9"],
  ["#facc15", "#f97316"],
  ["#111111", "#4f7bff"],
];

/** Kayıttan gelen geçiş renklerini doğrular. */
export function parseGradient(raw: unknown): [string, string] | null {
  return Array.isArray(raw) && raw.length === 2 && raw.every(isColor)
    ? [raw[0] as string, raw[1] as string]
    : null;
}
