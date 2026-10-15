import { HelpTip } from "../ui/HelpTip";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useEditorStore } from "../../store/editorStore";
import {
  applyCaptionPreset,
  captionTargets,
  patchCaptionLook,
  setCaptionEmoji,
  setCaptionWords,
  useCaptionStudio,
} from "../../lib/captionActions";
import {
  CAPTION_CATEGORIES,
  CAPTION_PRESETS,
  type CaptionCategory,
  type CaptionPreset,
} from "../../lib/captionPresets";
import { FONTS, HIGHLIGHT_MODES, displayText, type HighlightMode } from "../../lib/captionStyle";
import { highlightCss, richTextCss } from "../../lib/captionCss";
import { TEXT_COLORS } from "../../lib/textItems";
import { Select } from "../ui/Select";
import { Switch } from "../ui/Switch";
import { PanelSection } from "./PanelSection";

// Altyazı stüdyosu: kategorili stil galerisi, satır başına kelime, ayrıntılı ayarlar.
// Değişiklikler tüm otomatik altyazılara (ya da seçili yazıya) uygulanır.

/** Galeri kartı: örnek cümle, ikinci kelime vurgulu. */
function PresetTile({
  preset,
  selected,
  sample,
}: {
  preset: CaptionPreset;
  selected: boolean;
  sample: string;
}) {
  const { t } = useTranslation();
  const look = preset.look;
  const words = sample.split(" ");
  return (
    <button
      type="button"
      data-caption-preset={preset.id}
      aria-pressed={selected}
      title={t(`captionPreset.${preset.id}`)}
      onClick={() => applyCaptionPreset(preset.id)}
      className={`flex h-[72px] flex-col overflow-hidden rounded-xl border text-left transition ${
        selected ? "dk-selected" : "border-[var(--dk-border)] hover:border-[var(--dk-accent)]"
      }`}
    >
      {/* Örnek yazı stilin konumunda ve boyutunda durur: aynı görünen stil kalmaz. */}
      <span className="relative flex-1 overflow-hidden bg-[linear-gradient(135deg,#334155,#0f172a)] px-1">
        <span
          className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 leading-none whitespace-nowrap"
          style={{
            ...richTextCss(look),
            top: `${Math.min(82, Math.max(22, look.y * 100))}%`,
            fontSize: Math.round(Math.min(19, Math.max(10, (look.size / 0.07) * 13))),
          }}
        >
          {words.map((w, i) => (
            <span key={i}>
              {i > 0 ? " " : ""}
              <span
                style={
                  i === 1 && look.highlight
                    ? // Zıplama en büyük anında gösterilir (yoksa düz renk gibi durur).
                      highlightCss(look.highlight.mode, look.highlight.color, 0.09, 0)
                    : undefined
                }
              >
                {displayText(w, look.upper)}
              </span>
            </span>
          ))}
        </span>
      </span>
      <span className="flex items-center justify-between gap-1 px-2 py-1 text-[10px] text-[var(--dk-text-muted)]">
        <span className="truncate">{t(`captionPreset.${preset.id}`)}</span>
        <span className="shrink-0 opacity-70">
          {t("captionStudio.tileWords", { count: preset.words })}
        </span>
      </span>
    </button>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="shrink-0 text-[var(--dk-text-muted)]">{label}</span>
      <span className="flex min-w-0 flex-1 items-center justify-end gap-2">{children}</span>
    </div>
  );
}

function Slider({
  value,
  min,
  max,
  step,
  label,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  label: string;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      onPointerDown={() => useEditorStore.getState().beginDrag()}
      onPointerUp={() => useEditorStore.getState().endDrag()}
      onChange={(e) => onChange(Number(e.target.value))}
      className="dk-volume w-28"
    />
  );
}

function ColorDots({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (c: string) => void;
  label: string;
}) {
  return (
    <span className="flex items-center gap-1" role="group" aria-label={label}>
      {TEXT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={c}
          aria-pressed={value.toLowerCase() === c}
          onClick={() => onChange(c)}
          className={`h-4 w-4 rounded-full border ${value.toLowerCase() === c ? "border-white ring-1 ring-white" : "border-white/30"}`}
          style={{ background: c }}
        />
      ))}
      <input
        type="color"
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        className="h-5 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
      />
    </span>
  );
}

export function CaptionStudio() {
  const { t } = useTranslation();
  const texts = useEditorStore((s) => s.texts);
  const selectedTextId = useEditorStore((s) => s.selectedTextId);
  const presetId = useCaptionStudio((s) => s.presetId);
  const words = useCaptionStudio((s) => s.words);
  const emoji = useCaptionStudio((s) => s.emoji);
  const ids = captionTargets(texts, selectedTextId);
  const target = texts.find((t) => t.id === ids[0]);
  const [category, setCategory] = useState<CaptionCategory>(
    CAPTION_PRESETS.find((p) => p.id === (target?.preset ?? presetId))?.category ?? "popular",
  );
  const hasAuto = texts.some((x) => x.auto);
  const current = target?.preset ?? presetId;
  const sample = t("captionStudio.sample");

  return (
    <div className="space-y-3" data-caption-studio>
      <div className="flex items-center gap-1.5">
        <p className="text-xs font-semibold text-white">{t("captionStudio.title")}</p>
        <HelpTip
          title={t("captionStudio.title")}
          text={
            ids.length === 0
              ? t("captionStudio.hintNone")
              : target?.auto
                ? t("captionStudio.hintAll", { count: ids.length })
                : t("captionStudio.hintSelected")
          }
        />
      </div>
      <div className="flex flex-wrap gap-1" role="tablist" aria-label={t("captionStudio.title")}>
        {CAPTION_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={category === c}
            onClick={() => setCategory(c)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
              category === c
                ? "bg-[var(--dk-accent)] text-white"
                : "bg-[var(--dk-bg)] text-[var(--dk-text-muted)] hover:text-white"
            }`}
          >
            {t(`captionStudio.category.${c}`)}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {CAPTION_PRESETS.filter((p) => p.category === category).map((p) => (
          <PresetTile key={p.id} preset={p} selected={p.id === current} sample={sample} />
        ))}
      </div>

      <Row label={t("captionStudio.words")}>
        <span
          className="flex items-center gap-1"
          role="group"
          aria-label={t("captionStudio.words")}
        >
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={words === n}
              onClick={() => setCaptionWords(n)}
              className={`h-6 w-6 rounded-md font-mono text-[11px] ${
                words === n
                  ? "bg-[var(--dk-accent)] text-white"
                  : "bg-[var(--dk-bg)] hover:bg-white/10"
              }`}
            >
              {n}
            </button>
          ))}
        </span>
      </Row>
      {!hasAuto ? (
        <p className="text-[11px] text-[var(--dk-text-muted)]">{t("captionStudio.wordsHint")}</p>
      ) : null}
      <Row label={t("captionStudio.emoji")}>
        <Switch checked={emoji} label={t("captionStudio.emoji")} onChange={setCaptionEmoji} />
      </Row>
      <p className="text-[11px] text-[var(--dk-text-muted)]">{t("captionStudio.emojiHint")}</p>

      {target ? (
        <PanelSection id="captionDetails" title={t("captionStudio.details")} defaultOpen={false}>
          <Row label={t("captionStudio.font")}>
            <Select
              value={target.font ?? "segoe"}
              ariaLabel={t("captionStudio.font")}
              className="w-36 [&>button]:h-8"
              onChange={(font) => patchCaptionLook({ font })}
              options={FONTS.map((f) => ({ value: f.id, label: f.family }))}
            />
          </Row>
          <Row label={t("captionStudio.size")}>
            <Slider
              value={target.size}
              min={0.03}
              max={0.2}
              step={0.005}
              label={t("captionStudio.size")}
              onChange={(size) => patchCaptionLook({ size })}
            />
          </Row>
          <Row label={t("captionStudio.color")}>
            <ColorDots
              value={target.color}
              label={t("captionStudio.color")}
              onChange={(color) => patchCaptionLook({ color })}
            />
          </Row>
          <Row label={t("captionStudio.highlight")}>
            <Select
              value={target.highlight?.mode ?? "none"}
              ariaLabel={t("captionStudio.highlight")}
              className="w-36 [&>button]:h-8"
              onChange={(mode: HighlightMode | "none") =>
                patchCaptionLook({
                  highlight:
                    mode === "none"
                      ? undefined
                      : { mode, color: target.highlight?.color ?? "#ffd43b" },
                })
              }
              options={[
                { value: "none" as const, label: t("captionStudio.highlightMode.none") },
                ...HIGHLIGHT_MODES.map((m) => ({
                  value: m,
                  label: t(`captionStudio.highlightMode.${m}`),
                })),
              ]}
            />
          </Row>
          {target.highlight ? (
            <Row label={t("captionStudio.highlightColor")}>
              <ColorDots
                value={target.highlight.color}
                label={t("captionStudio.highlightColor")}
                onChange={(color) =>
                  patchCaptionLook({
                    highlight: { mode: target.highlight?.mode ?? "color", color },
                  })
                }
              />
            </Row>
          ) : null}
          <Row label={t("captionStudio.stroke")}>
            <Slider
              value={target.stroke ?? 0}
              min={0}
              max={0.15}
              step={0.005}
              label={t("captionStudio.stroke")}
              onChange={(stroke) => patchCaptionLook({ stroke })}
            />
          </Row>
          <Row label={t("captionStudio.strokeColor")}>
            <ColorDots
              value={target.strokeColor ?? "#000000"}
              label={t("captionStudio.strokeColor")}
              onChange={(strokeColor) => patchCaptionLook({ strokeColor })}
            />
          </Row>
          <Row label={t("captionStudio.shadow")}>
            <Slider
              value={target.shadow ?? 0}
              min={0}
              max={1}
              step={0.05}
              label={t("captionStudio.shadow")}
              onChange={(shadow) => patchCaptionLook({ shadow })}
            />
          </Row>
          <Row label={t("captionStudio.glow")}>
            <Slider
              value={target.glow ?? 0}
              min={0}
              max={1}
              step={0.05}
              label={t("captionStudio.glow")}
              onChange={(glow) => patchCaptionLook({ glow: glow > 0 ? glow : undefined })}
            />
          </Row>
          <Row label={t("captionStudio.background")}>
            <Switch
              checked={target.bg !== undefined}
              label={t("captionStudio.background")}
              onChange={(on) =>
                patchCaptionLook({
                  bg: on ? "#000000" : undefined,
                  bgOpacity: on ? 0.7 : undefined,
                })
              }
            />
          </Row>
          {target.bg !== undefined ? (
            <>
              <Row label={t("captionStudio.backgroundColor")}>
                <ColorDots
                  value={target.bg}
                  label={t("captionStudio.backgroundColor")}
                  onChange={(bg) => patchCaptionLook({ bg })}
                />
              </Row>
              <Row label={t("captionStudio.backgroundOpacity")}>
                <Slider
                  value={target.bgOpacity ?? 0.85}
                  min={0.1}
                  max={1}
                  step={0.05}
                  label={t("captionStudio.backgroundOpacity")}
                  onChange={(bgOpacity) => patchCaptionLook({ bgOpacity })}
                />
              </Row>
            </>
          ) : null}
          <Row label={t("captionStudio.upper")}>
            <Switch
              checked={!!target.upper}
              label={t("captionStudio.upper")}
              onChange={(upper) => patchCaptionLook({ upper })}
            />
          </Row>
          <Row label={t("captionStudio.italic")}>
            <Switch
              checked={!!target.italic}
              label={t("captionStudio.italic")}
              onChange={(italic) => patchCaptionLook({ italic })}
            />
          </Row>
          <Row label={t("captionStudio.spacing")}>
            <Slider
              value={target.spacing ?? 0}
              min={-0.05}
              max={0.3}
              step={0.01}
              label={t("captionStudio.spacing")}
              onChange={(spacing) =>
                patchCaptionLook({ spacing: Math.abs(spacing) < 0.005 ? undefined : spacing })
              }
            />
          </Row>
          <Row label={t("captionStudio.position")}>
            <span className="flex gap-1">
              {(
                [
                  ["top", 0.16],
                  ["middle", 0.5],
                  ["bottom", 0.78],
                ] as const
              ).map(([key, y]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => patchCaptionLook({ y })}
                  className={`rounded-md px-2 py-1 text-[11px] ${
                    Math.abs(target.y - y) < 0.03
                      ? "bg-[var(--dk-accent)] text-white"
                      : "bg-[var(--dk-bg)] hover:bg-white/10"
                  }`}
                >
                  {t(`captionStudio.pos.${key}`)}
                </button>
              ))}
            </span>
          </Row>
          <Row label={t("captionStudio.height")}>
            <Slider
              value={target.y}
              min={0.05}
              max={0.95}
              step={0.01}
              label={t("captionStudio.height")}
              onChange={(y) => patchCaptionLook({ y })}
            />
          </Row>
          <Row label={t("captionStudio.anim")}>
            <Select
              value={target.anim ?? "none"}
              ariaLabel={t("captionStudio.anim")}
              className="w-36 [&>button]:h-8"
              onChange={(anim) => patchCaptionLook({ anim })}
              options={(["none", "fade", "pop", "bounce", "slideUp"] as const).map((a) => ({
                value: a,
                label: t(`editor.textAnimName.${a}`),
              }))}
            />
          </Row>
        </PanelSection>
      ) : null}
    </div>
  );
}
