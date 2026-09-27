import { useTranslation } from "react-i18next";
import { formatPercent } from "../../lib/format";
import { Bold, SquareDashed, Trash2, Type } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { TEXT_COLORS, TEXT_SIZE, updateText, type TextItem } from "../../lib/textItems";
import { formatTimecode } from "../../lib/timeline";
import { deleteSelected } from "../../lib/editorActions";

const POSITIONS = [
  { id: "top", y: 0.12 },
  { id: "middle", y: 0.5 },
  { id: "bottom", y: 0.85 },
] as const;

/** Seçili yazının ayarları: metin, boyut, renk, arka plan, konum. */
export function TextPanel({ item }: { item: TextItem }) {
  const { t, i18n } = useTranslation();

  // Yazarken ve kaydırırken her tuş ayrı adım olmasın: odak boyunca tek geri alma adımı.
  const begin = () => useEditorStore.getState().beginDrag();
  const end = () => useEditorStore.getState().endDrag();
  const live = (patch: Partial<TextItem>) => {
    const store = useEditorStore.getState();
    store.dragTexts(updateText(store.texts, item.id, patch));
  };
  const commit = (patch: Partial<TextItem>) =>
    useEditorStore.getState().applyTexts((texts) => updateText(texts, item.id, patch));

  return (
    <div className="space-y-4" data-tour="editor-text-panel">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Type size={15} className="text-[#c084fc]" />
          {t("editor.textTitle")}
        </p>
        <button
          type="button"
          onClick={deleteSelected}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-[var(--dk-error)] hover:bg-[var(--dk-error)]/10"
        >
          <Trash2 size={13} />
          {t("editor.deleteText")}
        </button>
      </div>

      <textarea
        value={item.text}
        rows={3}
        aria-label={t("editor.textContent")}
        onFocus={begin}
        onBlur={end}
        onChange={(e) => live({ text: e.target.value })}
        className="w-full resize-none rounded-xl border border-[var(--dk-border)] bg-[var(--dk-surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--dk-accent)]"
      />

      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-[var(--dk-text-muted)]">
          <span>{t("editor.textSize")}</span>
          <span className="font-mono">{formatPercent(item.size, i18n.language)}</span>
        </div>
        <input
          type="range"
          min={TEXT_SIZE.min}
          max={TEXT_SIZE.max}
          step={0.005}
          value={item.size}
          aria-label={t("editor.textSize")}
          onPointerDown={begin}
          onPointerUp={end}
          onChange={(e) => live({ size: Number(e.target.value) })}
          className="dk-volume w-full"
        />
      </div>

      <div className="space-y-1.5">
        <p className="text-xs text-[var(--dk-text-muted)]">{t("editor.textColor")}</p>
        <div className="flex gap-2">
          {TEXT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={color}
              onClick={() => commit({ color })}
              className={`h-7 w-7 rounded-full border-2 ${
                item.color.toLowerCase() === color
                  ? "border-white"
                  : "border-[var(--dk-border-strong)]"
              }`}
              style={{ background: color }}
            />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => commit({ box: !item.box })}
          className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs ${
            item.box ? "bg-[var(--dk-accent)] text-white" : "bg-[var(--dk-bg)] hover:bg-white/10"
          }`}
        >
          <SquareDashed size={13} />
          {t("editor.textBox")}
        </button>
        <button
          type="button"
          onClick={() => commit({ bold: !item.bold })}
          className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs ${
            item.bold ? "bg-[var(--dk-accent)] text-white" : "bg-[var(--dk-bg)] hover:bg-white/10"
          }`}
        >
          <Bold size={13} />
          {t("editor.textBold")}
        </button>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs text-[var(--dk-text-muted)]">{t("editor.textPosition")}</p>
        <div className="flex gap-1">
          {POSITIONS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => commit({ x: 0.5, y: p.y })}
              className={`flex-1 rounded-lg py-1 text-xs ${
                Math.abs(item.y - p.y) < 0.01 && Math.abs(item.x - 0.5) < 0.01
                  ? "bg-[var(--dk-accent)] text-white"
                  : "bg-[var(--dk-bg)] hover:bg-white/10"
              }`}
            >
              {t(`editor.pos.${p.id}`)}
            </button>
          ))}
        </div>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-xl bg-[var(--dk-bg)]/60 p-3 text-xs">
        <dt className="text-[var(--dk-text-muted)]">{t("editor.clipOnTimeline")}</dt>
        <dd className="text-right font-mono tabular-nums">
          {formatTimecode(item.start, 1)} → {formatTimecode(item.end, 1)}
        </dd>
      </dl>
      <p className="text-xs text-[var(--dk-text-muted)]">{t("editor.textHint")}</p>
    </div>
  );
}
