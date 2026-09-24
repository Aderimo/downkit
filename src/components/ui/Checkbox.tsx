import type { ReactNode } from "react";
import { Check } from "lucide-react";

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: string;
  disabled?: boolean;
}

export function Checkbox({ checked, onChange, label, hint, disabled }: CheckboxProps) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-2.5 text-sm ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
      title={hint}
    >
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--dk-accent)] ${
          checked
            ? "border-[var(--dk-accent)] bg-[var(--dk-accent)] text-white"
            : "border-[var(--dk-border-strong)] bg-[var(--dk-surface-2)]"
        }`}
      >
        {checked ? <Check size={12} strokeWidth={3} /> : null}
      </span>
      <span className="text-[var(--dk-text)]">{label}</span>
    </label>
  );
}
