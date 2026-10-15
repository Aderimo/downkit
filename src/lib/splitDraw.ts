import { bandShare, layoutStyle, type Rect, type SplitLayout } from "./splitLayout";

// Kamera + oyun düzenini tuvale çizer (telefon önizlemeleri): dışa aktarmadaki
// Rust `Frame::filter` hesabıyla aynı yerleşim.

/** Kaynak bölgesini hedef kutuyu kaplayacak kadar ortadan kırpıp çizer
 * (dışa aktarımdaki "increase,crop" gibi). */
function paintCover(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  r: Rect,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const sw = r.w * video.videoWidth;
  const sh = r.h * video.videoHeight;
  const scale = Math.max(w / sw, h / sh);
  const cw = w / scale;
  const ch = h / scale;
  ctx.drawImage(
    video,
    r.x * video.videoWidth + (sw - cw) / 2,
    r.y * video.videoHeight + (sh - ch) / 2,
    cw,
    ch,
    x,
    y,
    w,
    h,
  );
}

/** Telefondaki görünüm: dışa aktarmanın düzeniyle aynı hesap (Rust `Frame::filter`). */
export function drawLayout(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  l: SplitLayout,
  W: number,
  H: number,
) {
  const style = layoutStyle(l);
  if (style === "circle" || style === "pip") {
    paintCover(ctx, video, l.game, 0, 0, W, H);
    const spot = l.spot ?? { x: 0.5, y: 0.8, size: 0.42 };
    const cw = W * spot.size;
    const ch = style === "circle" ? cw : cw * 0.75;
    const x = Math.min(Math.max(W * spot.x - cw / 2, 0), W - cw);
    const y = Math.min(Math.max(H * spot.y - ch / 2, 0), H - ch);
    const radius = style === "circle" ? cw / 2 : ch * 0.12;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, cw, ch, radius);
    ctx.clip();
    paintCover(ctx, video, l.cam, x, y, cw, ch);
    ctx.restore();
    if (l.ring) {
      const border = Math.max(2 * (W / 1080), Math.min(cw, ch) * 0.025);
      ctx.beginPath();
      ctx.roundRect(
        x + border / 2,
        y + border / 2,
        cw - border,
        ch - border,
        Math.max(0, radius - border / 2),
      );
      ctx.lineWidth = border;
      ctx.strokeStyle = l.ring;
      ctx.stroke();
    }
    return;
  }
  const camH = Math.round(H * l.camShare);
  const bandH = Math.round(H * bandShare(l));
  const gameH = H - camH - bandH;
  // Sıra: kamera, şerit, oyun (kamera altta ise tersi).
  const slotsY = l.camTop
    ? { cam: 0, band: camH, game: camH + bandH }
    : { game: 0, band: gameH, cam: gameH + bandH };
  if (bandH > 0 && l.band) {
    ctx.fillStyle = l.band.color;
    ctx.fillRect(0, slotsY.band, W, bandH);
  }
  if (style === "duo") {
    const half = Math.round(W / 2);
    paintCover(ctx, video, l.cam, 0, slotsY.cam, half, camH);
    paintCover(ctx, video, l.cam2 ?? l.cam, half, slotsY.cam, W - half, camH);
  } else {
    paintCover(ctx, video, l.cam, 0, slotsY.cam, W, camH);
  }
  paintCover(ctx, video, l.game, 0, slotsY.game, W, gameH);
}
