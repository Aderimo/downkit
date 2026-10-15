import type { ReactNode } from "react";
import { Tip } from "../ui/Tip";

export interface RailItem<T extends string> {
  id: T;
  label: string;
  icon: ReactNode;
  /** Üzerinde biraz bekleyince görünen açıklama. */
  description?: string;
  /** İpucunda döngülü örnek (public/tips). */
  media?: string;
}

/** Dikey araç şeridi: yalnız simgeler; ad ve açıklama üzerine gelince ipucunda. */
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
      className={`dk-scroll flex w-[52px] shrink-0 flex-col items-center gap-1 overflow-y-auto bg-[var(--dk-surface-2)]/50 py-1.5 ${
        side === "left" ? "border-r" : "border-l"
      } border-[var(--dk-border)]`}
    >
      {items.map((item) => (
        <Tip
          key={item.id}
          label={item.label}
          description={item.description}
          media={item.media}
          side={side === "left" ? "right" : "left"}
        >
          <button
            type="button"
            aria-pressed={value === item.id}
            aria-label={item.label}
            onClick={() => onChange(item.id)}
            className={`flex h-10 w-10 items-center justify-center rounded-lg transition ${
              value === item.id
                ? "bg-[var(--dk-accent)]/20 text-[var(--dk-accent-hover)]"
                : "text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-white"
            }`}
          >
            {item.icon}
          </button>
        </Tip>
      ))}
    </nav>
  );
}
