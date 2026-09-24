import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

const base =
  "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dk-accent)]";

const variants: Record<Variant, string> = {
  primary:
    "dk-gradient text-white shadow-[0_8px_24px_-12px_rgb(91_124_255/80%)] hover:brightness-110",
  secondary:
    "border border-[var(--dk-border-strong)] bg-[var(--dk-surface-2)] text-[var(--dk-text)] hover:border-[var(--dk-accent)]",
  ghost: "text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-[var(--dk-text)]",
  danger: "text-[var(--dk-error)] hover:bg-[var(--dk-error)]/10",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
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
