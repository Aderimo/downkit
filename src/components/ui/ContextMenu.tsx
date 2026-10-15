import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const MARGIN = 8;

/**
 * Sağ tık menüsünün kabı: gerçek boyutu ölçülüp pencereye sığdırılır (altta yer yoksa
 * yukarı, sağda yer yoksa sola açılır), pencereden uzunsa içi kaydırılır. Dışarı
 * tıklayınca, Esc'e basınca, pencere kaydırılınca ya da odak gidince kapanır.
 */
export function ContextMenu({
  x,
  y,
  width,
  onClose,
  children,
}: {
  x: number;
  y: number;
  width: number;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = Math.min(el.scrollHeight, window.innerHeight - MARGIN * 2);
    const top = y + h + MARGIN > window.innerHeight ? Math.max(MARGIN, y - h) : y;
    const left = x + width + MARGIN > window.innerWidth ? Math.max(MARGIN, x - width) : x;
    setPos({ left, top: Math.min(top, window.innerHeight - h - MARGIN) });
  }, [x, y, width]);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("wheel", close, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("wheel", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="dk-scroll fixed z-[60] overflow-y-auto rounded-xl border border-[var(--dk-border-strong)] bg-[var(--dk-surface-2)] p-1 shadow-2xl shadow-black/60"
      style={{
        width,
        maxHeight: `calc(100vh - ${MARGIN * 2}px)`,
        left: pos?.left ?? x,
        top: pos?.top ?? y,
        visibility: pos ? "visible" : "hidden",
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}
