import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
  hint?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

interface SelectProps<T extends string | number> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

// Yerel <select>'in açılır listesi WebView2'de koyu temayı izlemiyor (beyaz, okunmaz);
// bu bileşen listeyi kendimiz çizerek tutarlı görünüm sağlar.
export function Select<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
  className = "",
  ariaLabel,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function openList() {
    if (disabled) return;
    setHighlight(
      Math.max(
        0,
        options.findIndex((o) => o.value === value),
      ),
    );
    setOpen(true);
  }

  function choose(option: SelectOption<T>) {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === "Escape") setOpen(false);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(options.length - 1, h + 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const option = options[highlight];
      if (option) choose(option);
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className={`flex h-10 w-full items-center gap-2 rounded-xl border bg-[var(--dk-surface-2)] px-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          open
            ? "border-[var(--dk-accent)]"
            : "border-[var(--dk-border)] hover:border-[var(--dk-border-strong)]"
        }`}
      >
        {selected?.icon}
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? "—"}</span>
        {selected?.hint ? (
          <span className="shrink-0 text-xs text-[var(--dk-text-muted)]">{selected.hint}</span>
        ) : null}
        <ChevronDown size={16} className="shrink-0 text-[var(--dk-text-muted)]" />
      </button>

      {open ? (
        <ul
          role="listbox"
          className="dk-scroll absolute z-30 mt-1 max-h-72 w-full min-w-48 overflow-y-auto rounded-xl border border-[var(--dk-border-strong)] bg-[var(--dk-surface-2)] p-1 shadow-2xl shadow-black/50"
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            return (
              <li
                key={String(option.value)}
                role="option"
                aria-selected={isSelected}
                aria-disabled={option.disabled}
                onMouseEnter={() => setHighlight(index)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(option)}
                className={`flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm ${
                  option.disabled
                    ? "cursor-not-allowed opacity-40"
                    : index === highlight
                      ? "bg-[var(--dk-accent)]/15 text-[var(--dk-text)]"
                      : "text-[var(--dk-text)]"
                }`}
              >
                {option.icon}
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.hint ? (
                  <span className="shrink-0 text-xs text-[var(--dk-text-muted)]">
                    {option.hint}
                  </span>
                ) : null}
                {isSelected ? (
                  <Check size={14} className="shrink-0 text-[var(--dk-accent)]" />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
