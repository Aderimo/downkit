import { useEffect, useRef, useState, type ReactNode } from "react";

// Açılır menü: düğmeye tıklayınca açılır, dışarı tıklayınca ya da Escape'le kapanır.

export function Menu({
  trigger,
  children,
  align = "right",
  width = 240,
  label,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  width?: number;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative flex items-center">
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open ? (
        <div
          role="menu"
          aria-label={label}
          className={`dk-card absolute top-full z-40 mt-1 p-1 shadow-xl shadow-black/40 ${
            align === "right" ? "right-0" : "left-0"
          }`}
          style={{ width }}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

export function MenuItem({
  icon,
  label,
  hint,
  checked,
  onSelect,
  danger,
}: {
  icon?: ReactNode;
  label: string;
  hint?: string;
  checked?: boolean;
  onSelect: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={checked}
      onClick={onSelect}
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-white/5 ${
        danger ? "text-[var(--dk-error)]" : ""
      }`}
    >
      <span className="flex w-4 shrink-0 justify-center text-[var(--dk-text-muted)]" aria-hidden>
        {checked !== undefined ? (checked ? "✓" : "") : icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint ? (
        <kbd className="font-mono text-[10px] text-[var(--dk-text-muted)]">{hint}</kbd>
      ) : null}
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-2.5 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-[var(--dk-text-muted)] uppercase">
      {children}
    </p>
  );
}

export const MenuDivider = () => <div className="my-1 h-px bg-[var(--dk-border)]" />;
