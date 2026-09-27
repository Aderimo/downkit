import type { ReactNode } from "react";

export interface RailItem<T extends string> {
  id: T;
  label: string;
  icon: ReactNode;
}

/** Clipchamp'taki gibi dikey araç sütunu: simge ve altında kısa ad. */
export function ToolRail<T extends string>({
  items,
  value,
  onChange,
  side,
  tour,
}: {
  items: RailItem<T>[];
  value: T | null;
  onChange: (id: T) => void;
  side: "left" | "right";
  tour?: string;
}) {
  return (
    <nav
      data-tour={tour}
      className={`flex w-16 shrink-0 flex-col items-stretch gap-1 bg-[var(--dk-surface-2)]/50 p-1.5 ${
        side === "left" ? "border-r" : "border-l"
      } border-[var(--dk-border)]`}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-pressed={value === item.id}
          title={item.label}
          onClick={() => onChange(item.id)}
          className={`flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10px] leading-tight transition ${
            value === item.id
              ? "bg-[var(--dk-accent)]/15 text-white"
              : "text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-white"
          }`}
        >
          <span className={value === item.id ? "text-[var(--dk-accent-hover)]" : ""}>
            {item.icon}
          </span>
          <span className="w-full truncate text-center">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
