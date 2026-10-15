import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import {
  clearPlacements,
  exportFrames,
  FORMAT_FRAMES,
  FRAME_KEYS,
  placementsDiffer,
  previewFrame,
  toggleFrame,
} from "../../lib/multiFormat";
import { HelpTip } from "../ui/HelpTip";

/** Aynı projeyi başka biçimlerde de kaydet; yazıları her biçimde ayrı yerleştir. */
export function MultiFormatRow() {
  const { t } = useTranslation();
  const options = useEditorStore((s) => s.exportOptions);
  const setOptions = useEditorStore((s) => s.setExportOptions);
  const texts = useEditorStore((s) => s.texts);
  if (options.frame === "original") return null;
  const frames = exportFrames(options);
  const placed = frames.length > 1 && placementsDiffer(texts, frames);
  const name = (f: (typeof FORMAT_FRAMES)[number]) => t(`editor.frameOption.${FRAME_KEYS[f]}`);
  const chip = (active: boolean) =>
    `flex flex-1 items-center justify-center gap-1 rounded-md py-1 text-[11px] font-semibold ${
      active ? "bg-[var(--dk-accent)] text-white" : "bg-[var(--dk-bg)] hover:bg-white/10"
    }`;
  return (
    <div className="space-y-1.5 rounded-lg border border-[var(--dk-border)] p-2" data-multi-format>
      <div className="flex items-center gap-1.5">
        <p className="text-xs font-semibold text-white">{t("multiFormat.title")}</p>
        <HelpTip title={t("multiFormat.title")} text={t("multiFormat.hint")} />
      </div>
      <div className="flex gap-1" role="group" aria-label={t("multiFormat.formats")}>
        {FORMAT_FRAMES.map((f) => {
          const current = f === options.frame;
          const on = frames.includes(f);
          return (
            <button
              key={f}
              type="button"
              aria-pressed={on}
              disabled={current}
              title={current ? t("multiFormat.current", { name: name(f) }) : name(f)}
              aria-label={current ? t("multiFormat.current", { name: name(f) }) : name(f)}
              onClick={() => setOptions({ alsoFrames: toggleFrame(options, f) })}
              className={`${chip(on)} disabled:cursor-default`}
            >
              {on ? <Check size={11} aria-hidden /> : null}
              {f}
            </button>
          );
        })}
      </div>
      {frames.length > 1 ? (
        <>
          <p className="text-[11px] text-[var(--dk-text-muted)]">
            {t("multiFormat.editing", { count: frames.length })}
          </p>
          <div className="flex gap-1" role="group" aria-label={t("multiFormat.preview")}>
            {frames.map((f) =>
              f === "original" ? null : (
                <button
                  key={f}
                  type="button"
                  aria-pressed={f === options.frame}
                  aria-label={t("multiFormat.previewOne", { name: name(f) })}
                  onClick={() => setOptions(previewFrame(options, f))}
                  className={`${chip(f === options.frame)} border border-[var(--dk-border)]`}
                >
                  {f}
                </button>
              ),
            )}
          </div>
        </>
      ) : null}
      {placed ? (
        <button
          type="button"
          onClick={() => useEditorStore.getState().applyTexts(clearPlacements)}
          className="w-full rounded-md py-1 text-[11px] text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-white"
        >
          {t("multiFormat.same")}
        </button>
      ) : null}
    </div>
  );
}
