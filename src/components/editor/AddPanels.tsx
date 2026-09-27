import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Download, FileText, Plus, Trash2, Upload } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import {
  addStyledText,
  applyLook,
  applyTransition,
  importSubtitleCues,
  type TransitionKind,
} from "../../lib/editorActions";
import {
  parsePresets,
  toPresetFile,
  usePresetStore,
  type TextStyle,
} from "../../lib/editorPresets";
import { isDefaultLook, normalizeLook } from "../../lib/clipLook";
import { parseSrt } from "../../lib/subtitles";
import {
  chooseJsonSavePath,
  chooseTextFile,
  textFileRead,
  textFileWrite,
} from "../../lib/tauri-api";
import { localizeError } from "../../lib/errors";
import { Button } from "../ui/Button";

function Title({ children, hint }: { children: ReactNode; hint: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-sm font-semibold text-white">{children}</p>
      <p className="text-xs leading-relaxed text-[var(--dk-text-muted)]">{hint}</p>
    </div>
  );
}

/** Hazır yazı şablonları: başlık, alt yazı, köşe etiketi, vurgu. */
const TEXT_TEMPLATES: { id: string; style: TextStyle; seconds: number }[] = [
  {
    id: "title",
    style: { x: 0.5, y: 0.45, size: 0.12, color: "#ffffff", box: false, bold: true },
    seconds: 3,
  },
  {
    id: "caption",
    style: { x: 0.5, y: 0.86, size: 0.06, color: "#ffffff", box: true, bold: false },
    seconds: 4,
  },
  {
    id: "label",
    style: { x: 0.18, y: 0.1, size: 0.05, color: "#ffffff", box: true, bold: true },
    seconds: 5,
  },
  {
    id: "highlight",
    style: { x: 0.5, y: 0.78, size: 0.09, color: "#ffd43b", box: false, bold: true },
    seconds: 2.5,
  },
];

export function TextTemplatesPanel() {
  const { t } = useTranslation();
  // Seçici her seferinde aynı diziyi döndürmeli (yeni dizi sonsuz yeniden çizim yapar).
  const presets = usePresetStore((s) => s.presets);
  const custom = useMemo(() => presets.filter((p) => p.kind === "text"), [presets]);
  return (
    <div className="space-y-3">
      <Title hint={t("editor.templatesHint")}>{t("editor.toolText")}</Title>
      <div className="grid gap-2">
        {TEXT_TEMPLATES.map((tpl) => (
          <button
            key={tpl.id}
            type="button"
            onClick={() =>
              addStyledText(t(`editor.template.${tpl.id}.sample`), tpl.style, tpl.seconds)
            }
            className="relative flex aspect-[16/7] items-center justify-center overflow-hidden rounded-xl border border-[var(--dk-border)] bg-gradient-to-br from-[#1e293b] to-[#0f172a] transition hover:border-[var(--dk-accent)]"
          >
            <span
              className="absolute px-1.5 text-center leading-tight"
              style={{
                left: `${tpl.style.x * 100}%`,
                top: `${tpl.style.y * 100}%`,
                transform: "translate(-50%, -50%)",
                fontSize: `${Math.max(10, tpl.style.size * 160)}px`,
                color: tpl.style.color,
                fontWeight: tpl.style.bold ? 700 : 400,
                background: tpl.style.box ? "rgb(0 0 0 / 55%)" : "transparent",
                textShadow: tpl.style.box ? "none" : "1px 1px 2px rgb(0 0 0 / 70%)",
              }}
            >
              {t(`editor.template.${tpl.id}.sample`)}
            </span>
            <span className="absolute bottom-1 left-2 text-[10px] text-white/60">
              {t(`editor.template.${tpl.id}.name`)}
            </span>
          </button>
        ))}
        {custom.map((preset) =>
          preset.kind === "text" ? (
            <button
              key={preset.id}
              type="button"
              onClick={() => addStyledText(preset.name, preset.style)}
              className="flex items-center gap-2 rounded-xl border border-[var(--dk-border)] px-3 py-2 text-left text-sm hover:border-[var(--dk-accent)]"
            >
              <Plus size={14} className="text-[var(--dk-accent-hover)]" />
              <span className="truncate">{preset.name}</span>
            </button>
          ) : null,
        )}
      </div>
    </div>
  );
}

export function TransitionsPanel() {
  const { t } = useTranslation();
  const hasTarget = useEditorStore((s) => s.selectedIds.length > 0);
  const items: { id: TransitionKind; swatch: string }[] = [
    { id: "fadeBlack", swatch: "linear-gradient(90deg, #6366f1, #000 50%, #ec4899)" },
    { id: "fadeWhite", swatch: "linear-gradient(90deg, #6366f1, #fff 50%, #ec4899)" },
    { id: "fadeIn", swatch: "linear-gradient(90deg, #000, #6366f1)" },
    { id: "fadeOut", swatch: "linear-gradient(90deg, #6366f1, #000)" },
  ];
  return (
    <div className="space-y-3">
      <Title hint={t("editor.transitionsHint")}>{t("editor.toolTransitions")}</Title>
      {!hasTarget ? (
        <p className="rounded-xl border border-dashed border-[var(--dk-border-strong)] p-3 text-xs text-[var(--dk-text-muted)]">
          {t("editor.transitionsPick")}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => applyTransition(item.id)}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("application/x-downkit-transition", item.id);
              e.dataTransfer.effectAllowed = "copy";
            }}
            title={t("editor.transitionsDragHint")}
            className="cursor-grab overflow-hidden rounded-xl border border-[var(--dk-border)] text-left transition hover:border-[var(--dk-accent)] active:cursor-grabbing"
          >
            <div className="h-10" style={{ background: item.swatch }} />
            <span className="block px-2 py-1 text-[11px]">{t(`editor.transition.${item.id}`)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function SubtitlesPanel() {
  const { t } = useTranslation();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [boxed, setBoxed] = useState(true);
  const [large, setLarge] = useState(false);

  async function importFile() {
    setMessage(null);
    try {
      const path = await chooseTextFile("srt");
      if (!path) return;
      const cues = parseSrt(await textFileRead(path));
      const style: TextStyle = {
        x: 0.5,
        y: 0.88,
        size: large ? 0.075 : 0.055,
        color: "#ffffff",
        box: boxed,
        bold: false,
      };
      const count = importSubtitleCues(cues, style);
      setMessage(
        count > 0
          ? { ok: true, text: t("editor.subtitlesImported", { count }) }
          : { ok: false, text: t("editor.subtitlesEmpty") },
      );
    } catch (err) {
      setMessage({ ok: false, text: localizeError(err, "editor.subtitlesFailed").message });
    }
  }

  return (
    <div className="space-y-3">
      <Title hint={t("editor.subtitlesHint")}>{t("editor.toolSubtitles")}</Title>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={boxed} onChange={(e) => setBoxed(e.target.checked)} />
        {t("editor.subtitlesBox")}
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={large} onChange={(e) => setLarge(e.target.checked)} />
        {t("editor.subtitlesLarge")}
      </label>
      <Button icon={<FileText size={15} />} onClick={() => void importFile()} className="w-full">
        {t("editor.subtitlesImport")}
      </Button>
      {message ? (
        <p
          className={`text-xs ${message.ok ? "text-[var(--dk-success)]" : "text-[var(--dk-warning)]"}`}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

/** Kendi hazır ayarların: seçili klibin görünümünü ya da seçili yazının stilini
 * adıyla kaydet, sonra tek tıkla uygula; dosya olarak paylaş. */
export function PresetsPanel() {
  const { t } = useTranslation();
  const presets = usePresetStore((s) => s.presets);
  const add = usePresetStore((s) => s.add);
  const remove = usePresetStore((s) => s.remove);
  const merge = usePresetStore((s) => s.merge);
  const clip = useEditorStore((s) => s.clips.find((c) => s.selectedIds.includes(c.id)) ?? null);
  const text = useEditorStore((s) => s.texts.find((x) => x.id === s.selectedTextId) ?? null);
  const [name, setName] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const canSaveLook = clip !== null && !isDefaultLook(clip.look);
  const canSaveText = text !== null;

  function saveCurrent() {
    const label = name.trim();
    if (!label) return;
    if (canSaveText && text) {
      add({
        id: crypto.randomUUID(),
        name: label,
        kind: "text",
        style: {
          x: text.x,
          y: text.y,
          size: text.size,
          color: text.color,
          box: text.box,
          bold: text.bold,
        },
      });
    } else if (canSaveLook && clip) {
      add({ id: crypto.randomUUID(), name: label, kind: "look", look: normalizeLook(clip.look) });
    } else return;
    setName("");
    setMessage({ ok: true, text: t("editor.presetSaved") });
  }

  async function exportFile() {
    setMessage(null);
    try {
      const path = await chooseJsonSavePath("downkit-hazir-ayarlar.json");
      if (!path) return;
      await textFileWrite(path, JSON.stringify(toPresetFile(presets), null, 2));
      setMessage({ ok: true, text: t("editor.presetsExported") });
    } catch (err) {
      setMessage({ ok: false, text: localizeError(err, "editor.presetsFailed").message });
    }
  }

  async function importFile() {
    setMessage(null);
    try {
      const path = await chooseTextFile("json");
      if (!path) return;
      const count = merge(parsePresets(JSON.parse(await textFileRead(path))));
      setMessage(
        count > 0
          ? { ok: true, text: t("editor.presetsImported", { count }) }
          : { ok: false, text: t("editor.presetsNone") },
      );
    } catch (err) {
      setMessage({ ok: false, text: localizeError(err, "editor.presetsFailed").message });
    }
  }

  return (
    <div className="space-y-3">
      <Title hint={t("editor.presetsHint")}>{t("editor.toolPresets")}</Title>
      <div className="space-y-2 rounded-xl border border-[var(--dk-border)] bg-[var(--dk-bg)]/40 p-3">
        <p className="text-xs text-[var(--dk-text-muted)]">
          {canSaveText
            ? t("editor.presetFromText")
            : canSaveLook
              ? t("editor.presetFromLook")
              : t("editor.presetNothing")}
        </p>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("editor.presetName")}
            disabled={!canSaveLook && !canSaveText}
            onKeyDown={(e) => e.key === "Enter" && saveCurrent()}
            className="h-8 min-w-0 flex-1 rounded-lg border border-[var(--dk-border)] bg-[var(--dk-surface-2)] px-2 text-xs outline-none focus:border-[var(--dk-accent)] disabled:opacity-40"
          />
          <Button
            size="sm"
            disabled={!name.trim() || (!canSaveLook && !canSaveText)}
            onClick={saveCurrent}
          >
            {t("editor.presetSave")}
          </Button>
        </div>
      </div>
      <div className="space-y-1.5">
        {presets.length === 0 ? (
          <p className="text-xs text-[var(--dk-text-muted)]">{t("editor.presetsEmpty")}</p>
        ) : null}
        {presets.map((preset) => (
          <div
            key={preset.id}
            className="flex items-center gap-2 rounded-lg border border-[var(--dk-border)] px-2.5 py-1.5"
          >
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left text-sm hover:text-[var(--dk-accent-hover)]"
              title={t("editor.presetApply")}
              onClick={() =>
                preset.kind === "look"
                  ? applyLook(preset.look)
                  : addStyledText(preset.name, preset.style)
              }
            >
              {preset.name}
              <span className="ml-1.5 text-[10px] text-[var(--dk-text-muted)]">
                {preset.kind === "look" ? t("editor.presetKindLook") : t("editor.presetKindText")}
              </span>
            </button>
            <button
              type="button"
              aria-label={t("editor.presetDelete")}
              title={t("editor.presetDelete")}
              onClick={() => remove(preset.id)}
              className="rounded p-1 text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-[var(--dk-error)]"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          icon={<Upload size={14} />}
          onClick={() => void importFile()}
          className="flex-1"
        >
          {t("editor.presetsImport")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<Download size={14} />}
          disabled={presets.length === 0}
          onClick={() => void exportFile()}
          className="flex-1"
        >
          {t("editor.presetsExport")}
        </Button>
      </div>
      {message ? (
        <p
          className={`text-xs ${message.ok ? "text-[var(--dk-success)]" : "text-[var(--dk-warning)]"}`}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
