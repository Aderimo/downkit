import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, ImageDown, Loader2 } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { COVER_STYLES, saveCover, type CoverStyle } from "../../lib/cover";
import { localizeError } from "../../lib/errors";
import { revealInFolder } from "../../lib/tauri-api";
import { HelpTip } from "../ui/HelpTip";

/** Kapak görseli: imleçteki kare + başlık, dışa aktarmanın düzeniyle. */
export function CoverSection() {
  const { t } = useTranslation();
  const projectName = useEditorStore((s) => s.exportOptions.outputName);
  const [title, setTitle] = useState("");
  const [style, setStyle] = useState<CoverStyle>("bold");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-1.5 rounded-lg border border-[var(--dk-border)] p-2" data-cover>
      <div className="flex items-center gap-1.5">
        <p className="text-xs font-semibold text-white">{t("cover.title")}</p>
        <HelpTip title={t("cover.title")} text={t("cover.hint")} />
      </div>
      <input
        value={title}
        maxLength={80}
        placeholder={projectName || t("cover.placeholder")}
        aria-label={t("cover.text")}
        onChange={(e) => setTitle(e.target.value)}
        className="h-7 w-full rounded-md border border-[var(--dk-border)] bg-[var(--dk-bg)] px-2 text-xs outline-none focus:border-[var(--dk-accent)]"
      />
      <div className="flex gap-1" role="group" aria-label={t("cover.style")}>
        {COVER_STYLES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={style === s}
            onClick={() => setStyle(s)}
            className={`flex-1 rounded-md py-1 text-[11px] font-semibold ${
              style === s
                ? "bg-[var(--dk-accent)] text-white"
                : "bg-[var(--dk-bg)] hover:bg-white/10"
            }`}
          >
            {t(`cover.styles.${s}`)}
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setSaved(null);
          setError(null);
          void saveCover(title || projectName, style)
            .then((path) => (path ? setSaved(path) : setError(t("cover.gap"))))
            .catch((err: unknown) => setError(localizeError(err, "cover.failed").message))
            .finally(() => setBusy(false));
        }}
        className="flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--dk-accent)] py-1.5 text-xs font-bold text-white disabled:opacity-50"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <ImageDown size={13} />}
        {t("cover.save")}
      </button>
      {saved ? (
        <p className="flex items-center gap-1 text-[11px] text-[#4ade80]" role="status">
          <span className="min-w-0 flex-1 truncate">
            {t("cover.saved", { name: saved.split(/[\\/]/).pop() })}
          </span>
          <button
            type="button"
            aria-label={t("cover.reveal")}
            title={t("cover.reveal")}
            onClick={() => void revealInFolder(saved).catch(() => {})}
            className="rounded p-0.5 hover:bg-white/10"
          >
            <FolderOpen size={12} />
          </button>
        </p>
      ) : null}
      {error ? <p className="text-[11px] text-[var(--dk-error)]">{error}</p> : null}
    </div>
  );
}
