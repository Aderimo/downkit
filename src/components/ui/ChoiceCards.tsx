import type { ReactNode } from "react";
import { Check } from "lucide-react";

export interface Choice<T extends string> {
  value: T;
  title: string;
  desc?: string;
  icon?: ReactNode;
}

interface ChoiceCardsProps<T extends string> {
  label?: string;
  value: T | null;
  choices: Choice<T>[];
  onChange: (value: T) => void;
  columns?: 2 | 3 | 4 | 5 | 6;
}

const COLS = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  // Altı kart dar pencerede iki sıra üçlü olur.
  6: "grid-cols-3 xl:grid-cols-6",
};

/** Tek seçimli kart grubu — seçili kart belirgin kenar ve onay işaretiyle görünür. */
export function ChoiceCards<T extends string>({
  label,
  value,
  choices,
  onChange,
  columns = 4,
}: ChoiceCardsProps<T>) {
  return (
    <div>
      {label ? <p className="mb-2 text-sm text-[var(--dk-text-muted)]">{label}</p> : null}
      <div className={`grid gap-2.5 ${COLS[columns]}`} role="radiogroup">
        {choices.map((choice) => {
          const active = choice.value === value;
          return (
            <button
              key={choice.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(choice.value)}
              className={`relative flex items-center gap-2.5 rounded-xl border bg-[var(--dk-surface-2)] p-3 text-left transition ${
                active
                  ? "dk-selected"
                  : "border-[var(--dk-border)] hover:border-[var(--dk-border-strong)]"
              }`}
            >
              {choice.icon}
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-white">
                  {choice.title}
                </span>
                {choice.desc ? (
                  <span className="block truncate text-xs text-[var(--dk-text-muted)]">
                    {choice.desc}
                  </span>
                ) : null}
              </span>
              {active ? (
                <span className="dk-gradient absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full">
                  <Check size={11} strokeWidth={3} color="white" />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
