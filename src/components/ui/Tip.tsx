import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Gecikmeli ipucu: üzerine gelince 0,5 sn sonra adı (ve kısayolu), 1,5 sn tutunca
// açıklaması ve varsa küçük örnek animasyonu açılır. Klavyeyle odaklanınca ad hemen
// görünür. Ekrana yazı gömmek yerine bilgi gerektiğinde gelir.

const NAME_DELAY = 500;
const DETAIL_DELAY = 1500;
/** Açıklamalı ipucunun genişliği: dar kenarda sıkışıp uzun bir şeride dönmesin. */
const DETAIL_WIDTH = 288;
const MEDIA_WIDTH = 320;
const EDGE = 8;

export interface TipProps {
  label: string;
  shortcut?: string;
  description?: string;
  /** Döngülü örnek (public/tips altındaki küçük video). */
  media?: string;
  side?: "right" | "left" | "bottom" | "top";
  /** Açıklama adla birlikte hemen görünsün (yardım "?" simgeleri). */
  instant?: boolean;
  children: ReactNode;
}

export function Tip({
  label,
  shortcut,
  description,
  media,
  side = "right",
  instant = false,
  children,
}: TipProps) {
  const [stage, setStage] = useState<0 | 1 | 2>(0);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  // Ölçülen kutuyla ekrana sığdırma: yatayda kaydırma, aşağıda yer yoksa yukarı açma.
  const [fit, setFit] = useState<{ dx: number; flip: boolean }>({ dx: 0, flip: false });
  const box = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  useEffect(
    () => () => {
      for (const id of timers.current) window.clearTimeout(id);
    },
    [],
  );

  function clear() {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  }
  function show(el: Element, immediate: boolean) {
    clear();
    setFit({ dx: 0, flip: false });
    setAnchor(el.getBoundingClientRect());
    if (instant) {
      timers.current.push(window.setTimeout(() => setStage(2), immediate ? 0 : 250));
      return;
    }
    if (immediate) setStage(1);
    else timers.current.push(window.setTimeout(() => setStage(1), NAME_DELAY));
    if (description || media) {
      timers.current.push(window.setTimeout(() => setStage(2), DETAIL_DELAY));
    }
  }
  function hide() {
    clear();
    setStage(0);
  }
  /** İpucu sarılan öğeye göre konumlanır (sarmalayıcının kutusu yok). */
  const target = (e: { currentTarget: HTMLElement }) =>
    (e.currentTarget.firstElementChild as HTMLElement | null) ?? e.currentTarget;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el || stage === 0) return;
    const r = el.getBoundingClientRect();
    let dx = 0;
    if (r.right > window.innerWidth - EDGE) dx = window.innerWidth - EDGE - r.right;
    if (r.left + dx < EDGE) dx = EDGE - r.left;
    const flip =
      (side === "bottom" && r.bottom > window.innerHeight - EDGE) ||
      (side === "top" && r.top < EDGE);
    if (Math.abs(dx) > 0.5 || flip) setFit((f) => ({ dx: f.dx + dx, flip: f.flip || flip }));
  }, [stage, anchor, side]);

  const wide = stage === 2 && (description || media);
  const width = wide
    ? Math.min(media ? MEDIA_WIDTH : DETAIL_WIDTH, window.innerWidth - 2 * EDGE)
    : undefined;
  const placement = fit.flip ? (side === "bottom" ? "top" : "bottom") : side;
  let style: React.CSSProperties = {};
  if (anchor) {
    const gap = 8;
    if (placement === "right")
      style = {
        left: anchor.right + gap,
        top: anchor.top + anchor.height / 2,
        transform: "translateY(-50%)",
      };
    if (placement === "left")
      style = {
        right: window.innerWidth - anchor.left + gap,
        top: anchor.top + anchor.height / 2,
        transform: "translateY(-50%)",
      };
    if (placement === "bottom")
      style = {
        left: anchor.left + anchor.width / 2,
        top: anchor.bottom + gap,
        transform: "translateX(-50%)",
      };
    if (placement === "top")
      style = {
        left: anchor.left + anchor.width / 2,
        bottom: window.innerHeight - anchor.top + gap,
        transform: "translateX(-50%)",
      };
    if (width) style.width = width;
    if (fit.dx) style.marginLeft = fit.dx;
  }

  return (
    <>
      <span
        className="contents"
        onMouseEnter={(e) => show(target(e), false)}
        onMouseLeave={hide}
        onFocus={(e) => {
          if ((e.target as HTMLElement).matches(":focus-visible")) show(target(e), true);
        }}
        onBlur={hide}
        onPointerDown={hide}
      >
        {children}
      </span>
      {stage > 0 && anchor
        ? createPortal(
            <div
              ref={box}
              role="tooltip"
              data-tip={label}
              className={`pointer-events-none fixed z-[60] rounded-lg border border-[var(--dk-border-strong)] bg-[var(--dk-surface-2)] text-xs text-[var(--dk-text)] shadow-xl shadow-black/40 ${
                wide ? "px-3 py-2.5" : "max-w-[260px] px-2.5 py-1.5"
              }`}
              style={style}
            >
              <p className="flex items-center gap-2 font-semibold">
                <span>{label}</span>
                {shortcut ? (
                  <kbd className="rounded bg-black/30 px-1 font-mono text-[10px] text-[var(--dk-text-muted)]">
                    {shortcut}
                  </kbd>
                ) : null}
              </p>
              {stage === 2 && description ? (
                <p
                  className="mt-1.5 leading-relaxed whitespace-pre-line text-[var(--dk-text-muted)]"
                  data-tip-detail
                >
                  {description}
                </p>
              ) : null}
              {stage === 2 && media ? (
                <video
                  src={media}
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="mt-2 w-full rounded-md border border-[var(--dk-border)]"
                />
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
