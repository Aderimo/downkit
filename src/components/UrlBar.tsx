import { forwardRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ClipboardPaste, Link2, Loader2, Sparkles, X } from "lucide-react";

interface UrlBarProps {
  value: string;
  onChange: (value: string) => void;
  onAnalyze: () => void;
  onPaste: () => void;
  canAnalyze: boolean;
  isAnalyzing: boolean;
  /** Düğme yazısı; verilmezse "Analiz Et". */
  actionLabel?: string;
  actionIcon?: ReactNode;
}

export const UrlBar = forwardRef<HTMLInputElement, UrlBarProps>(function UrlBar(
  { value, onChange, onAnalyze, onPaste, canAnalyze, isAnalyzing, actionLabel, actionIcon },
  ref,
) {
  const { t } = useTranslation();

  return (
    <div className="dk-card flex h-16 items-center gap-2 pl-5 pr-2 focus-within:border-[var(--dk-accent)]">
      <Link2 size={22} className="shrink-0 text-[var(--dk-text-muted)]" />
      <input
        ref={ref}
        type="text"
        value={value}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && canAnalyze && !isAnalyzing) onAnalyze();
        }}
        placeholder={t("analyze.placeholder")}
        className="h-full min-w-0 flex-1 truncate bg-transparent text-base text-[var(--dk-text)] outline-none placeholder:text-[var(--dk-text-muted)]"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          title={t("analyze.clear")}
          aria-label={t("analyze.clear")}
          className="rounded-lg p-2 text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-[var(--dk-text)]"
        >
          <X size={18} />
        </button>
      ) : (
        <button
          type="button"
          onClick={onPaste}
          className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-[var(--dk-text)]"
        >
          <ClipboardPaste size={16} />
          {t("analyze.pasteFromClipboard")}
        </button>
      )}
      <button
        type="button"
        onClick={onAnalyze}
        disabled={!canAnalyze || isAnalyzing}
        className="dk-gradient flex h-12 shrink-0 items-center gap-2 rounded-xl px-6 text-sm font-semibold text-white shadow-[0_8px_24px_-10px_color-mix(in_srgb,var(--dk-accent)_90%,transparent)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isAnalyzing ? (
          <Loader2 size={18} className="animate-spin" />
        ) : (
          (actionIcon ?? <Sparkles size={18} />)
        )}
        {isAnalyzing ? t("analyze.analyzing") : (actionLabel ?? t("analyze.analyzeButton"))}
      </button>
    </div>
  );
});
