import type { ReactNode } from "react";
import { usePlayerStore } from "../../store/playerStore";
import { fxPreview, hasTimedFx, type LookFx } from "../../lib/lookFx";

// Film greni: SVG gürültüsü (küçük, tekrarlanan); her karede yeri değişir.
const GRAIN_SVG =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 1 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

/** Görünüm efektlerinin önizlemesi: içeriği filtre/dönüşümle sarar, üstüne gren,
 * tarama çizgisi ve ışık sızması katmanlarını çizer. Zamanla değişen efekt varsa oynatma
 * saatini izler (dışa aktarımdaki FFmpeg formülüyle aynı). */
export function LookFxLayer({
  fx,
  time: fixed,
  children,
}: {
  fx: LookFx | undefined;
  /** Verilirse oynatma saati yerine bu an (efekt kartının kendi saati). */
  time?: number;
  children: ReactNode;
}) {
  const timed =
    fixed === undefined && (hasTimedFx(fx) || (fx?.grain ?? 0) > 0 || (fx?.vhs ?? 0) > 0);
  const clock = usePlayerStore((s) => (timed ? s.currentTime : 0));
  const time = fixed ?? clock;
  // Efekt yokken de aynı sarmalayıcı döner: ağaç yapısı değişirse içerideki video
  // oynatıcısı yeniden kurulur ve oynatma blok sınırında durur.
  const view = fxPreview(fx, time);
  // Gren her 1/24 sn'de bir yer değiştirir (film gibi titreşir).
  const frame = Math.floor(time * 24);
  return (
    <div
      className="absolute inset-0"
      data-look-fx={fx ? "" : undefined}
      style={{ filter: view.filter || undefined, transform: view.transform || undefined }}
    >
      {children}
      {view.grain > 0 ? (
        <div
          className="pointer-events-none absolute inset-0 mix-blend-overlay"
          style={{
            backgroundImage: GRAIN_SVG,
            opacity: 0.25 + 0.5 * view.grain,
            backgroundPosition: `${(frame * 37) % 160}px ${(frame * 61) % 160}px`,
          }}
        />
      ) : null}
      {view.scanlines > 0 ? (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "repeating-linear-gradient(to bottom, rgb(0 0 0 / 0.9) 0 1px, transparent 1px 4px)",
            opacity: 0.3 * view.scanlines,
          }}
        />
      ) : null}
      {view.leak ? (
        <div
          className="pointer-events-none absolute inset-0 mix-blend-screen"
          style={{
            background: `radial-gradient(ellipse at ${Math.round(view.leak.x * 100)}% 25%, rgb(255 150 60 / 0.9), rgb(255 80 40 / 0.35) 35%, transparent 70%)`,
            opacity: view.leak.opacity,
          }}
        />
      ) : null}
    </div>
  );
}
