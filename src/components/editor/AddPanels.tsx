import { TRANSITION_STYLES, fxCss, fxFrame, type TransitionStyle } from "../../lib/clipFx";
import { HelpTip } from "../ui/HelpTip";
import { BrandKitSection } from "./BrandKitSection";
import { fxDrag } from "../../lib/fxDrag";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Captions, Download, FileText, Plus, Sparkles, Trash2, Upload } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { usePlayerStore } from "../../store/playerStore";
import {
  XFADE_KINDS,
  XFADE_CATEGORIES,
  xfadeCategory,
  type XfadeCategory,
  XFADE_MIME,
  xfadeFrame,
  type XfadeKind,
  type XfadeLayer,
} from "../../lib/xfade";
import {
  addStyledText,
  applyLook,
  applyEdgeTransition,
  applyXfade,
  importSubtitleCues,
  generateCaptions,
  removeAutoCaptions,
  xfadeTargetCut,
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
  captionsCancel,
  captionsReady,
  chooseTextFile,
  onCaptionsProgress,
  textFileRead,
  textFileWrite,
} from "../../lib/tauri-api";
import { localizeError } from "../../lib/errors";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import { applyChannel, channelFromProject, channelParts } from "../../lib/channelTemplate";
import { pointerDrag } from "../../lib/pointerDrag";
import { CaptionStudio } from "./CaptionStudio";
import { saveSubtitleFile } from "../../lib/captionActions";
import { TranscriptEditor } from "./TranscriptEditor";

/** Panel başlığı; açıklama "?" ipucunda (ekranda kalıcı yer kaplamasın). */
function Title({ children, hint }: { children: ReactNode; hint: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <p className="text-sm font-semibold text-white">{children}</p>
      <HelpTip title={typeof children === "string" ? children : ""} text={hint} />
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
            title={t("editor.fxDragHint")}
            {...fxDrag(
              {
                kind: "text",
                text: t(`editor.template.${tpl.id}.sample`),
                style: tpl.style,
                seconds: tpl.seconds,
              },
              t(`editor.template.${tpl.id}.name`),
            )}
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

/** Giriş / çıkış geçişleri: klibin ucuna (imlece en yakın uç) konur. */
const EDGE_ITEMS: { id: TransitionKind | TransitionStyle; drag: "kind" | "style" }[] = [
  { id: "fadeIn", drag: "kind" },
  { id: "fadeOut", drag: "kind" },
  { id: "fadeWhite", drag: "kind" },
  ...TRANSITION_STYLES.filter((s) => s !== "fade").map((id) => ({ id, drag: "style" as const })),
];

/**
 * Bütün geçişler tek listede: klipler arası geçişler imlece en yakın kesime, giriş /
 * çıkış geçişleri imlece en yakın klip ucuna konur. Kart zaman çizelgesine de sürüklenir.
 * Üstüne gelince geçiş kartın içinde oynar.
 */
export function TransitionsPanel() {
  const { t } = useTranslation();
  // Hedef kesim imlece göre değişir.
  useEditorStore((s) => s.clips);
  usePlayerStore((s) => s.currentTime);
  const target = xfadeTargetCut();
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<"all" | "edges" | XfadeCategory>("all");
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase();
  const matches = (name: string) => !needle || name.toLocaleLowerCase().includes(needle);
  const kinds = XFADE_KINDS.filter(
    (kind) =>
      (tab === "all" || tab === xfadeCategory(kind)) && matches(t(`editor.xfadeName.${kind}`)),
  );
  const edges = EDGE_ITEMS.filter(
    (item) =>
      (tab === "all" || tab === "edges") &&
      matches(
        item.drag === "style"
          ? t(`editor.transitionStyleName.${item.id}`)
          : t(`editor.transition.${item.id}`),
      ),
  );
  const tabs: ("all" | "edges" | XfadeCategory)[] = ["all", ...XFADE_CATEGORIES, "edges"];
  return (
    <div className="space-y-3">
      <Title hint={t("transitions.hint")}>{t("editor.toolTransitions")}</Title>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("transitions.search")}
        aria-label={t("transitions.search")}
        className="h-8 w-full rounded-lg border border-[var(--dk-border)] bg-[var(--dk-bg)] px-2 text-xs outline-none focus:border-[var(--dk-accent)]"
      />
      <div className="flex flex-wrap gap-1" role="tablist">
        {tabs.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`rounded-full px-2 py-0.5 text-[11px] ${
              tab === id
                ? "bg-[var(--dk-accent)] text-white"
                : "bg-[var(--dk-bg)] text-[var(--dk-text-muted)] hover:text-[var(--dk-text)]"
            }`}
          >
            {t(`transitions.tabs.${id}`)}
          </button>
        ))}
      </div>
      {kinds.length + edges.length === 0 ? (
        <p className="py-3 text-center text-[11px] text-[var(--dk-text-muted)]">
          {t("transitions.none")}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2" data-transition-grid>
        {kinds.map((kind) => (
          <XfadeTile
            key={kind}
            kind={kind}
            current={target?.xfade?.kind === kind}
            onApply={() => setNotice(applyXfade(kind) ? null : t("editor.xfadeNoCut"))}
          />
        ))}
        {edges.map((item) => (
          <EdgeTile
            key={item.id}
            id={item.id}
            drag={item.drag}
            onApply={() => setNotice(applyEdgeTransition(item.id) ? null : t("transitions.noClip"))}
          />
        ))}
      </div>
      {notice ? (
        <p role="status" className="text-[11px] text-[var(--dk-warning)]">
          {notice}
        </p>
      ) : null}
    </div>
  );
}

const IDLE_PROGRESS = 0.38;
const TILE_A = "linear-gradient(135deg, #3b5bfd, #6366f1)";
const TILE_B = "linear-gradient(135deg, #ff4fa3, #ffb02e)";

function tileLayer(layer: XfadeLayer): CSSProperties {
  return {
    opacity: layer.opacity,
    clipPath: layer.clipPath,
    transform: layer.transform,
    filter: layer.filter,
    maskImage: layer.mask,
    WebkitMaskImage: layer.mask,
    zIndex: layer.top ? 2 : 1,
  };
}

/** Geçiş kartı: üstüne gelince geçiş canlı oynar (A → B). Tıklayınca seçili
 * kesime uygulanır; zaman çizelgesindeki iki klibin arasına da sürüklenebilir. */
function XfadeTile({
  kind,
  current,
  onApply,
}: {
  kind: XfadeKind;
  current: boolean;
  onApply: () => void;
}) {
  const { t } = useTranslation();
  // Dururken geçişin ortasına yakın bir an: iki klip de görünür.
  const [progress, setProgress] = useState(IDLE_PROGRESS);
  const frame = useRef<number | null>(null);
  function animate() {
    const startAt = performance.now();
    const tick = (now: number) => {
      // 0,3 sn A, 1 sn geçiş, 0,3 sn B; döngü.
      const cycle = ((now - startAt) / 1600) % 1;
      setProgress(Math.min(1, Math.max(0, (cycle * 1.6 - 0.3) / 1)));
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }
  function stop() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setProgress(IDLE_PROGRESS);
  }
  useEffect(() => stop, []);
  // Küçük kartta piksel blokları da küçük.
  const view = xfadeFrame(kind, progress, 7);
  return (
    <button
      type="button"
      aria-pressed={current}
      {...pointerDrag(XFADE_MIME, kind, t(`editor.xfadeName.${kind}`))}
      onPointerEnter={animate}
      onPointerLeave={stop}
      onFocus={animate}
      onBlur={stop}
      onClick={onApply}
      data-xfade-tile={kind}
      className={`relative cursor-grab overflow-hidden rounded-xl border text-left transition active:cursor-grabbing ${
        current ? "dk-selected" : "border-[var(--dk-border)] hover:border-[var(--dk-accent)]"
      }`}
    >
      <div className="relative isolate h-12 overflow-hidden bg-black">
        <div
          className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white/85"
          style={{ background: TILE_A, ...tileLayer(view.out) }}
        >
          A
        </div>
        <div
          className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white/85"
          style={{ background: TILE_B, ...tileLayer(view.in) }}
        >
          B
        </div>
        {view.veil ? (
          <div
            className="absolute inset-0 z-[3]"
            style={{ background: view.veil.color, opacity: view.veil.opacity }}
          />
        ) : null}
      </div>
      <span className="block truncate px-2 py-1 text-[11px]">{t(`editor.xfadeName.${kind}`)}</span>
    </button>
  );
}

/** Giriş / çıkış kartı: üstüne gelince A klibi bu geçişle girip çıkar (önizlemedeki
 * formülle). Tıklayınca imlece en yakın klip ucuna konur; klibin ucuna da sürüklenir. */
function EdgeTile({
  id,
  drag,
  onApply,
}: {
  id: TransitionKind | TransitionStyle;
  drag: "kind" | "style";
  onApply: () => void;
}) {
  const { t } = useTranslation();
  const [time, setTime] = useState(0.45);
  const frame = useRef<number | null>(null);
  function animate() {
    const startAt = performance.now();
    const tick = (now: number) => {
      setTime(((now - startAt) / 1000) % EDGE_CYCLE);
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }
  function stop() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setTime(0.45);
  }
  useEffect(() => stop, []);
  const style = edgeStyle(id);
  const fx = fxFrame(
    {
      motion: "none",
      strength: 0,
      offset: 0,
      total: EDGE_CYCLE,
      transition: style.transition,
      duration: EDGE_CYCLE,
      fadeIn: style.fadeIn,
      fadeOut: style.fadeOut,
    },
    time,
  );
  const css = fxCss(fx);
  // Kararma / açılma: siyah ya da beyaz örtü (önizlemedeki gibi).
  const fadeIn = style.fadeIn > 0 ? Math.min(1, time / style.fadeIn) : 1;
  const fadeOut =
    style.fadeOut > 0 ? Math.min(1, Math.max(0, (EDGE_CYCLE - time) / style.fadeOut)) : 1;
  const veil = style.transition === "fade" ? 1 - Math.min(fadeIn, fadeOut) : 0;
  const label =
    drag === "style" ? t(`editor.transitionStyleName.${id}`) : t(`editor.transition.${id}`);
  const dragProps =
    drag === "style"
      ? fxDrag({ kind: "style", id: id as TransitionStyle }, label)
      : pointerDrag("application/x-downkit-transition", id, label);
  return (
    <button
      type="button"
      data-edge-tile={id}
      {...dragProps}
      onPointerEnter={animate}
      onPointerLeave={stop}
      onFocus={animate}
      onBlur={stop}
      onClick={onApply}
      className="relative cursor-grab overflow-hidden rounded-xl border border-[var(--dk-border)] text-left transition hover:border-[var(--dk-accent)] active:cursor-grabbing"
    >
      <div className="relative isolate h-12 overflow-hidden bg-black">
        <div
          className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white/85"
          style={{
            background: TILE_A,
            transform: css.transform || undefined,
            filter: css.filter || undefined,
          }}
        >
          A
        </div>
        {veil > 0 ? (
          <div
            className={`absolute inset-0 ${style.white ? "bg-white" : "bg-black"}`}
            style={{ opacity: veil }}
          />
        ) : null}
      </div>
      <span className="block truncate px-2 py-1 text-[11px]">{label}</span>
    </button>
  );
}

/** Kartın döngüsü: 0,5 sn giriş, 0,6 sn durur, 0,5 sn çıkış. */
const EDGE_CYCLE = 1.6;

function edgeStyle(id: TransitionKind | TransitionStyle): {
  transition: TransitionStyle;
  fadeIn: number;
  fadeOut: number;
  white: boolean;
} {
  switch (id) {
    case "fadeIn":
      return { transition: "fade", fadeIn: 0.6, fadeOut: 0, white: false };
    case "fadeOut":
      return { transition: "fade", fadeIn: 0, fadeOut: 0.6, white: false };
    case "fadeWhite":
      return { transition: "fade", fadeIn: 0.5, fadeOut: 0.5, white: true };
    case "fadeBlack":
      return { transition: "fade", fadeIn: 0.5, fadeOut: 0.5, white: false };
    default:
      return { transition: id, fadeIn: 0.5, fadeOut: 0.5, white: false };
  }
}

const CAPTION_LANGUAGES = ["auto", "tr", "en", "de", "es", "fr", "ru", "ar"] as const;

/** Konuşmayı bilgisayarda yazıya döker: dil, hız/doğruluk ve görünüm (satır ya da
 * kelime kelime). İlk kullanımda motor ve dil modeli indirilir. */
function AutoCaptions() {
  const { t } = useTranslation();
  const hasAuto = useEditorStore((s) => s.texts.some((x) => x.auto));
  const [language, setLanguage] = useState<(typeof CAPTION_LANGUAGES)[number]>("auto");
  const [model, setModel] = useState<"base" | "small">("base");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [ready, setReady] = useState<boolean | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void captionsReady(model)
      .then((ok) => {
        if (alive) setReady(ok);
      })
      .catch(() => {
        if (alive) setReady(null);
      });
    return () => {
      alive = false;
    };
  }, [model, busy]);

  async function run() {
    setBusy(true);
    setMessage(null);
    setProgress(null);
    const unlisten = await onCaptionsProgress((p) => setProgress(p.percent));
    try {
      const count = await generateCaptions({ language, model });
      setMessage(
        count > 0
          ? { ok: true, text: t("editor.captionsDone", { count }) }
          : { ok: false, text: t("editor.captionsNone") },
      );
    } catch (err) {
      setMessage({ ok: false, text: localizeError(err, "editor.captionsFailed").message });
    } finally {
      unlisten();
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div
      className="space-y-2 rounded-xl border border-[var(--dk-border)] bg-[var(--dk-bg)]/40 p-3"
      data-auto-captions
    >
      <p className="flex items-center gap-1.5 text-xs font-semibold text-white">
        <Sparkles size={13} className="text-[var(--dk-accent-hover)]" />
        {t("editor.captionsTitle")}
        <HelpTip title={t("editor.captionsTitle")} text={t("editor.captionsHint")} />
      </p>
      {/* Altyazı yokken nasıl çalıştığı kısa bir döngüyle gösterilir (yazı yerine). */}
      {!hasAuto && !busy ? (
        <video
          src="/tips/subtitles.webm"
          autoPlay
          loop
          muted
          playsInline
          aria-label={t("editor.captionsDemo")}
          data-captions-demo
          className="w-full rounded-lg border border-[var(--dk-border)]"
        />
      ) : null}
      {ready === false && !busy ? (
        <p className="text-[11px] text-[var(--dk-warning)]">
          {t("editor.captionsFirstRun", { size: model === "small" ? "490 MB" : "150 MB" })}
        </p>
      ) : null}
      {busy ? (
        <div className="space-y-1.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--dk-surface-2)]">
            <div
              className="dk-gradient h-full transition-all"
              style={{ width: `${progress ?? 3}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px] text-[var(--dk-text-muted)]">
            <span>
              {progress === null
                ? t("editor.captionsPreparing")
                : t("editor.captionsWorking", { percent: Math.round(progress) })}
            </span>
            <button
              type="button"
              onClick={() => void captionsCancel()}
              className="text-[var(--dk-error)] hover:underline"
            >
              {t("jobs.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <Button icon={<Captions size={15} />} onClick={() => void run()} className="w-full">
          {hasAuto ? t("editor.captionsRedo") : t("editor.captionsMake")}
        </Button>
      )}
      {/* Dil ve doğruluk çoğu zaman değişmez: katlanır. */}
      <details className="group text-[11px]" data-captions-settings>
        <summary className="cursor-pointer list-none text-[var(--dk-text-muted)] hover:text-white">
          {t("editor.captionsSettings", {
            language: t(`editor.captionsLang.${language}`),
            model: model === "small" ? t("editor.captionsAccurate") : t("editor.captionsFast"),
          })}
        </summary>
        <div className="mt-2 grid gap-2">
          <Select
            value={language}
            ariaLabel={t("editor.captionsLanguage")}
            onChange={setLanguage}
            options={CAPTION_LANGUAGES.map((l) => ({
              value: l,
              label: t(`editor.captionsLang.${l}`),
            }))}
          />
          <Select
            value={model}
            ariaLabel={t("editor.captionsModel")}
            onChange={setModel}
            options={[
              { value: "base" as const, label: t("editor.captionsFast"), hint: "150 MB" },
              { value: "small" as const, label: t("editor.captionsAccurate"), hint: "490 MB" },
            ]}
          />
          <p className="text-[11px] leading-snug text-[var(--dk-text-muted)]">
            {t("editor.captionsModelHint")}
          </p>
        </div>
      </details>
      {hasAuto && !busy ? (
        <button
          type="button"
          onClick={removeAutoCaptions}
          className="text-[11px] text-[var(--dk-text-muted)] hover:text-[var(--dk-error)]"
        >
          {t("editor.captionsRemove")}
        </button>
      ) : null}
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

/** Altyazıları dosyaya kaydet: SRT (çoğu platform) ya da VTT (web). */
function SubtitleFileButtons() {
  const { t } = useTranslation();
  const has = useEditorStore((s) => s.texts.some((x) => x.text.trim()));
  const name = useEditorStore((s) => s.exportOptions.outputName || "altyazi");
  const [saved, setSaved] = useState<string | null>(null);
  if (!has) return null;
  const save = (ext: "srt" | "vtt") =>
    void saveSubtitleFile(ext, name)
      .then((path) =>
        setSaved(path ? t("editor.subtitleSaved", { name: path.split(/[\\/]/).pop() }) : null),
      )
      .catch((err: unknown) => setSaved(localizeError(err, "editor.subtitlesFailed").message));
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-2">
        <Button
          size="sm"
          variant="secondary"
          icon={<Download size={14} />}
          onClick={() => save("srt")}
        >
          {t("editor.subtitleSaveSrt")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          icon={<Download size={14} />}
          onClick={() => save("vtt")}
        >
          {t("editor.subtitleSaveVtt")}
        </Button>
      </div>
      {saved ? <p className="text-[11px] text-[var(--dk-text-muted)]">{saved}</p> : null}
    </div>
  );
}

export function SubtitlesPanel() {
  const { t } = useTranslation();
  const hasAuto = useEditorStore((s) => s.texts.some((x) => x.auto));
  const hasTexts = useEditorStore((s) => s.texts.length > 0);
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
      <AutoCaptions />
      {/* Stil, transkript ve dosya kaydı altyazı oluşunca görünür (boşken kalabalık etmesin). */}
      {hasTexts ? <CaptionStudio /> : null}
      {hasAuto ? <TranscriptEditor /> : null}
      <SubtitleFileButtons />
      <details className="rounded-xl border border-[var(--dk-border)] px-3 py-2" data-srt-import>
        <summary className="cursor-pointer text-xs text-[var(--dk-text-muted)] hover:text-white">
          {t("editor.subtitlesFromFile")}
        </summary>
        <div className="mt-2 space-y-2">
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={boxed} onChange={(e) => setBoxed(e.target.checked)} />
            {t("editor.subtitlesBox")}
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={large} onChange={(e) => setLarge(e.target.checked)} />
            {t("editor.subtitlesLarge")}
          </label>
          <Button
            icon={<FileText size={15} />}
            onClick={() => void importFile()}
            className="w-full"
          >
            {t("editor.subtitlesImport")}
          </Button>
        </div>
      </details>
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

/** Projedeki çerçeve + görünüm + yazı stili + logo tek "kanal şablonu" olarak kaydedilir. */
function ChannelSave({ onSaved }: { onSaved: (text: string) => void }) {
  const { t } = useTranslation();
  const add = usePresetStore((s) => s.add);
  const [name, setName] = useState("");
  // Seçim ve katmanlar değişince önizleme güncellensin.
  useEditorStore((s) => s.exportOptions);
  useEditorStore((s) => s.clips);
  useEditorStore((s) => s.texts);
  useEditorStore((s) => s.images);
  const template = channelFromProject();
  const parts = channelParts(template);
  function save() {
    const label = name.trim();
    if (!label || parts.length === 0) return;
    add({ id: crypto.randomUUID(), name: label, kind: "channel", channel: template });
    setName("");
    onSaved(t("editor.presetSaved"));
  }
  return (
    <div className="space-y-2 rounded-xl border border-[var(--dk-border)] bg-[var(--dk-bg)]/40 p-3">
      <p className="text-xs font-semibold text-white">{t("editor.channelTitle")}</p>
      <p className="text-xs text-[var(--dk-text-muted)]">
        {parts.length > 0
          ? t("editor.channelHas", {
              parts: parts.map((p) => t(`editor.channelPart.${p}`)).join(", "),
            })
          : t("editor.channelEmpty")}
      </p>
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("editor.channelNamePlaceholder")}
          disabled={parts.length === 0}
          onKeyDown={(e) => e.key === "Enter" && save()}
          className="h-8 min-w-0 flex-1 rounded-lg border border-[var(--dk-border)] bg-[var(--dk-surface-2)] px-2 text-xs outline-none focus:border-[var(--dk-accent)] disabled:opacity-40"
        />
        <Button size="sm" disabled={!name.trim() || parts.length === 0} onClick={save}>
          {t("editor.presetSave")}
        </Button>
      </div>
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
      <BrandKitSection />
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
            placeholder={t("editor.presetNamePlaceholder")}
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
      <ChannelSave onSaved={(text) => setMessage({ ok: true, text })} />
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
                  : preset.kind === "channel"
                    ? applyChannel(preset.channel)
                    : addStyledText(preset.name, preset.style)
              }
            >
              {preset.name}
              <span className="ml-1.5 text-[10px] text-[var(--dk-text-muted)]">
                {preset.kind === "look"
                  ? t("editor.presetKindLook")
                  : preset.kind === "channel"
                    ? channelParts(preset.channel)
                        .map((p) => t(`editor.channelPart.${p}`))
                        .join(" · ") || t("editor.presetKindChannel")
                    : t("editor.presetKindText")}
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
