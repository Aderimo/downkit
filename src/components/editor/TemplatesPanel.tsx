import { useTranslation } from "react-i18next";
import { ImagePlus, Trash2 } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import {
  applyTemplate,
  PROGRESS_COLORS,
  REEL_TEMPLATES,
  removeTemplateTexts,
  type ReelTemplate,
  type TemplateKind,
} from "../../lib/reelTemplates";
import { addImage } from "../../lib/layerActions";
import { HelpTip } from "../ui/HelpTip";
import { Switch } from "../ui/Switch";
import { CoverSection } from "./CoverSection";

// Şablonlar: düzen şablonları (başlık + soru, sinematik, eğitim, alıntı), kanca yazıları
// (ilk saniyeler), bitiş ekranları, ilerleme çubuğu ve logo köşesi. Tıkla → uygulanır,
// her şey sonradan düzenlenir.

/** Kartın küçük şeması: çerçeve, arka plan ve yazıların yeri. */
function Preview({ tpl }: { tpl: ReelTemplate }) {
  const square = tpl.frame === "1:1";
  const bg = tpl.gradient
    ? `linear-gradient(${tpl.gradient[0]}, ${tpl.gradient[1]})`
    : tpl.layout === "blur"
      ? "linear-gradient(#334155, #1e293b)"
      : "#1f2a44";
  return (
    <div
      className="relative mx-auto overflow-hidden rounded-md border border-white/15"
      style={{ width: square ? 54 : 40, height: square ? 54 : 70, background: bg }}
      aria-hidden
    >
      {tpl.layout === "blur" || tpl.layout === "gradient" ? (
        <div className="absolute inset-x-0 top-1/2 h-[30%] -translate-y-1/2 bg-[#4f7bff]/90" />
      ) : (
        <div className="absolute inset-0 bg-[#4f7bff]/60" />
      )}
      {tpl.texts.map((x, i) => (
        <div
          key={i}
          className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[2px]"
          style={{
            top: `${(x.style.y ?? 0.5) * 100}%`,
            width: `${Math.min(90, (x.style.size ?? 0.06) * 900)}%`,
            height: Math.max(3, (x.style.size ?? 0.06) * 60),
            background: x.style.bg ?? x.style.color ?? "#ffffff",
            opacity: x.style.bg ? 1 : 0.9,
          }}
        />
      ))}
      {tpl.progress ? (
        <div
          className="absolute left-0 w-1/2"
          style={{
            [tpl.progress.top ? "top" : "bottom"]: 0,
            height: 3,
            background: tpl.progress.color,
          }}
        />
      ) : null}
    </div>
  );
}

function Section({ kind, sourceAspect }: { kind: TemplateKind; sourceAspect: number }) {
  const { t } = useTranslation();
  const has = useEditorStore((s) => s.texts.some((x) => x.tpl === kind));
  const list = REEL_TEMPLATES.filter((x) => x.kind === kind);
  return (
    <div className="space-y-1.5" data-template-section={kind}>
      <div className="flex items-center gap-1.5">
        <p className="text-xs font-semibold text-white">{t(`templates.section.${kind}`)}</p>
        <HelpTip title={t(`templates.section.${kind}`)} text={t(`templates.sectionHint.${kind}`)} />
        <span className="flex-1" />
        {has ? (
          <button
            type="button"
            aria-label={t("templates.remove", { section: t(`templates.section.${kind}`) })}
            title={t("templates.remove", { section: t(`templates.section.${kind}`) })}
            onClick={() => removeTemplateTexts(kind)}
            className="rounded p-0.5 text-[var(--dk-text-muted)] hover:text-[var(--dk-error)]"
          >
            <Trash2 size={13} />
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {list.map((tpl) => (
          <button
            key={tpl.id}
            type="button"
            data-template={tpl.id}
            onClick={() => applyTemplate(tpl.id, sourceAspect)}
            className="flex flex-col items-center gap-1 rounded-lg border border-[var(--dk-border)] bg-[var(--dk-bg)]/40 px-1 py-1.5 text-[10px] leading-tight text-[var(--dk-text-muted)] hover:border-[var(--dk-accent)] hover:text-white"
          >
            <Preview tpl={tpl} />
            <span className="text-center">{t(`templates.name.${tpl.id}`)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** İlerleme çubuğu: aç/kapa, renk, üstte/altta. */
function ProgressControls() {
  const { t } = useTranslation();
  const bar = useEditorStore((s) => s.exportOptions.progressBar);
  const set = useEditorStore((s) => s.setExportOptions);
  return (
    <div
      className="space-y-1.5 rounded-lg border border-[var(--dk-border)] p-2"
      data-progress-controls
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs">{t("templates.progress")}</span>
        <Switch
          checked={bar !== null}
          label={t("templates.progress")}
          onChange={(on) =>
            set({ progressBar: on ? { color: "#ffd43b", height: 0.012, top: false } : null })
          }
        />
      </div>
      {bar ? (
        <div className="flex items-center gap-1.5">
          {PROGRESS_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              aria-pressed={bar.color === c}
              onClick={() => set({ progressBar: { ...bar, color: c } })}
              className={`h-5 w-5 rounded-full border border-white/30 ${bar.color === c ? "ring-2 ring-[var(--dk-accent)]" : ""}`}
              style={{ background: c }}
            />
          ))}
          <span className="flex-1" />
          <button
            type="button"
            aria-pressed={bar.top}
            onClick={() => set({ progressBar: { ...bar, top: !bar.top } })}
            className="rounded-md bg-[var(--dk-bg)] px-2 py-0.5 text-[11px] hover:bg-white/10"
          >
            {bar.top ? t("templates.progressTop") : t("templates.progressBottom")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function TemplatesPanel() {
  const { t } = useTranslation();
  const info = useEditorStore((s) => s.source?.info);
  const sourceAspect = info?.width && info.height ? info.width / info.height : 16 / 9;
  return (
    <div className="space-y-3" data-templates>
      <div className="flex items-center gap-1.5">
        <h2 className="text-sm font-semibold text-white">{t("editor.toolTemplates")}</h2>
        <HelpTip title={t("editor.toolTemplates")} text={t("templates.hint")} />
      </div>
      <Section kind="layout" sourceAspect={sourceAspect} />
      <Section kind="hook" sourceAspect={sourceAspect} />
      <Section kind="end" sourceAspect={sourceAspect} />
      <ProgressControls />
      <CoverSection />
      <button
        type="button"
        onClick={() => void addImage()}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--dk-border)] py-1.5 text-xs hover:bg-white/5"
      >
        <ImagePlus size={13} />
        {t("templates.logo")}
      </button>
    </div>
  );
}
