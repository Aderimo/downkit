import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, RotateCcw, X } from "lucide-react";
import { Button } from "./ui/Button";

interface ErrorBannerProps {
  message: string;
  detail?: string | null;
  hint?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}

export function ErrorBanner({ message, detail, hint, onRetry, onDismiss }: ErrorBannerProps) {
  const { t } = useTranslation();
  const [showDetail, setShowDetail] = useState(false);

  return (
    <div className="rounded-2xl border border-[var(--dk-error)]/40 bg-[var(--dk-error)]/10 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle size={20} className="mt-0.5 shrink-0 text-[var(--dk-error)]" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white">{message}</p>
          {hint ? <p className="mt-0.5 text-sm text-[var(--dk-text-muted)]">{hint}</p> : null}
          {detail ? (
            <button
              type="button"
              onClick={() => setShowDetail((v) => !v)}
              className="mt-2 text-xs text-[var(--dk-text-muted)] underline hover:text-white"
            >
              {showDetail ? t("error.hideDetails") : t("error.showDetails")}
            </button>
          ) : null}
        </div>
        {onRetry ? (
          <Button size="sm" variant="secondary" icon={<RotateCcw size={14} />} onClick={onRetry}>
            {t("error.retry")}
          </Button>
        ) : null}
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            aria-label={t("clipboard.dismiss")}
            className="rounded p-1 text-[var(--dk-text-muted)] hover:text-white"
          >
            <X size={16} />
          </button>
        ) : null}
      </div>
      {showDetail && detail ? (
        <pre className="dk-scroll mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-black/40 p-2 text-xs text-[var(--dk-text-muted)]">
          {detail}
        </pre>
      ) : null}
    </div>
  );
}
