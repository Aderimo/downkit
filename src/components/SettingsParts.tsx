import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/Button";
import { Switch } from "./ui/Switch";

// Ayarlar sayfasının ortak parçaları: başlıklı bölüm, açıklamalı satır, anahtarlı
// satır ve iki adımlı onay düğmesi.

export function Section({
  icon,
  title,
  tour,
  children,
}: {
  icon: ReactNode;
  title: string;
  /** Tanıtım turunda vurgulanacak bölümün adı. */
  tour?: string;
  children: ReactNode;
}) {
  return (
    <section className="dk-card space-y-4 p-5" data-tour={tour}>
      <h2 className="flex items-center gap-2.5 text-base font-semibold text-white">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--dk-accent)]/15 text-[var(--dk-accent-hover)]">
          {icon}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-white">{label}</p>
        {hint ? (
          <p className="mt-0.5 truncate text-xs text-[var(--dk-text-muted)]" title={hint}>
            {hint}
          </p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-white">{label}</p>
        {hint ? <p className="mt-0.5 text-xs text-[var(--dk-text-muted)]">{hint}</p> : null}
      </div>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

/** Geri alınamayan işlemler için iki adımlı düğme: önce sor, sonra yap. */
export function ConfirmButton({
  active,
  disabled,
  onAsk,
  onCancel,
  onConfirm,
  icon,
  label,
  confirmLabel,
}: {
  active: boolean;
  disabled?: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  icon: ReactNode;
  label: string;
  confirmLabel: string;
}) {
  const { t } = useTranslation();
  if (!active) {
    return (
      <Button variant="secondary" size="sm" icon={icon} disabled={disabled} onClick={onAsk}>
        {label}
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <Button variant="ghost" size="sm" onClick={onCancel}>
        {t("history.cancelClear")}
      </Button>
      <Button variant="danger" size="sm" icon={icon} onClick={onConfirm}>
        {confirmLabel}
      </Button>
    </div>
  );
}
