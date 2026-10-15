const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const MIN = 0.03;

/** Kutunun 8 tutamacı: köşeler ve kenar ortaları. */
export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** Tutamaçla sürüklenen kutunun yeni yeri (kenarlar kare dışına çıkmaz). */
export function resizeRect(
  r: { x: number; y: number; w: number; h: number },
  handle: Handle,
  dx: number,
  dy: number,
) {
  let { x, y, w, h } = r;
  if (handle.includes("e")) w = clamp(r.w + dx, MIN, 1 - r.x);
  if (handle.includes("s")) h = clamp(r.h + dy, MIN, 1 - r.y);
  if (handle.includes("w")) {
    x = clamp(r.x + dx, 0, r.x + r.w - MIN);
    w = r.x + r.w - x;
  }
  if (handle.includes("n")) {
    y = clamp(r.y + dy, 0, r.y + r.h - MIN);
    h = r.y + r.h - y;
  }
  return { x, y, w, h };
}
