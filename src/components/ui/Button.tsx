import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "edit" | "success" | "successLight";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

// C tasarımı: dolu düğmeler kalın çerçeveli ve düz gölgeli; basınca gölgeye oturur.
const base =
  "inline-flex items-center justify-center gap-2 rounded-xl font-bold disabled:cursor-not-allowed disabled:opacity-40";

const variants: Record<Variant, string> = {
  primary: "dk-press bg-[var(--dk-accent)] text-white",
  secondary: "dk-press bg-[var(--dk-surface)] text-[var(--dk-text)]",
  ghost: "text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-[var(--dk-text)]",
  danger: "text-[var(--dk-error)] hover:bg-[var(--dk-error)]/10",
  // Renkler temadan (--dk-edit, --dk-save…): açık ve koyu temada okunur kalır.
  edit: "dk-press bg-[var(--dk-edit)] text-white",
  success: "dk-press bg-[var(--dk-save)] text-white",
  successLight: "dk-press bg-[var(--dk-save-soft)] text-[var(--dk-save-soft-text)]",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3 text-xs",
  md: "h-11 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  icon,
  className = "",
  children,
  ...props
}: ButtonProps) {
  return (
    <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props}>
      {icon}
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  tone?: "default" | "danger" | "accent";
}

export function IconButton({ label, tone = "default", className = "", ...props }: IconButtonProps) {
  const tones = {
    default: "text-[var(--dk-text-muted)] hover:text-[var(--dk-text)]",
    danger: "text-[var(--dk-text-muted)] hover:text-[var(--dk-error)]",
    accent: "text-[var(--dk-accent)] hover:text-[var(--dk-accent-hover)]",
  };
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--dk-border)] bg-[var(--dk-surface-2)] transition-colors hover:border-[var(--dk-border-strong)] disabled:opacity-40 ${tones[tone]} ${className}`}
      {...props}
    />
  );
}
