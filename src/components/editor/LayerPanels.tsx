import { trackBlurFace, useBlurTrack } from "../../lib/blurTrack";
import { setBlurKey, type BlurItem } from "../../lib/layers";
import { sliderKeys } from "../../lib/sliderKeys";
import { SfxAndVoice } from "./SfxAndVoice";
import { EnvelopeEditor } from "./EnvelopeEditor";
import { beatTimes, cutAtBeats, detectBeats } from "../../lib/beats";
import { useState } from "react";
import { HelpTip } from "../ui/HelpTip";
import { useTranslation } from "react-i18next";
import { ImagePlus, Music2, Plus, Trash2 } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { usePlayerStore } from "../../store/playerStore";
import { IMAGE_SPOTS, musicEnd, type ImageItem, type MusicItem } from "../../lib/layers";
import {
  addImage,
  addMusic,
  removeImage,
  removeMusic,
  updateImage,
  updateMusic,
  addBlur,
  removeBlur,
  updateBlur,
  useBlurSelection,
} from "../../lib/layerActions";
import { sequenceEnd } from "../../lib/sequence";
import { formatTimecode } from "../../lib/timeline";
import { Button } from "../ui/Button";
import { StickerPicker } from "./StickerPicker";

/** Panel başlığı; açıklama "?" ipucunda (ekranda kalıcı yer kaplamasın). */
function Title({ children, hint }: { children: React.ReactNode; hint: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <p className="text-sm font-semibold text-white">{children}</p>
      <HelpTip title={typeof children === "string" ? children : ""} text={hint} />
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onLive,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onLive: (v: number) => void;
}) {
  const store = useEditorStore.getState;
  return (
    <label className="block text-[11px]">
      <span className="flex justify-between text-[var(--dk-text-muted)]">
        <span>{label}</span>
        <span className="font-mono">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={() => store().beginDrag()}
        onPointerUp={() => store().endDrag()}
        {...sliderKeys(() => {})}
        onChange={(e) => onLive(Number(e.target.value))}
        className="w-full accent-[var(--dk-accent)]"
      />
    </label>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Müzik ve ses efekti: imleçten başlar, video bitince biter. Ücretsiz. */
export function MusicPanel() {
  const { t } = useTranslation();
  const music = useEditorStore((s) => s.music);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <Title hint={t("editor.musicHint")}>{t("editor.toolMusic")}</Title>
      <Button
        size="sm"
        className="w-full"
        icon={<Plus size={15} />}
        onClick={() => {
          setError(null);
          void addMusic().catch((err: unknown) =>
            setError(err instanceof Error ? err.message : t("editor.musicFailed")),
          );
        }}
      >
        {t("editor.musicAdd")}
      </Button>
      {error ? <p className="text-xs text-[var(--dk-error)]">{error}</p> : null}
      <SfxAndVoice />
      {music.map((m) => (
        <MusicCard key={m.id} item={m} />
      ))}
    </div>
  );
}

/** Müzikte ritim: vuruşları bul, ana izi her 1/2/4 vuruşta böl. */
function BeatRow({ item }: { item: MusicItem }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const count = beatTimes(item).length;
  const find = async () => {
    setBusy(true);
    setNote(null);
    try {
      const n = await detectBeats(item.id);
      setNote(n ? t("beats.found", { count: n }) : t("beats.none"));
    } catch {
      setNote(t("beats.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-1.5" data-beats>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => void find()}
          className="flex-1 rounded-lg border border-[var(--dk-border)] px-2 py-1 text-[11px] hover:border-[var(--dk-accent)] disabled:opacity-40"
        >
          {busy ? t("beats.finding") : count ? t("beats.again", { count }) : t("beats.find")}
        </button>
        <HelpTip title={t("beats.find")} text={t("beats.hint")} />
      </div>
      {count > 0 ? (
        <div
          className="flex items-center gap-1 text-[11px]"
          role="group"
          aria-label={t("beats.cut")}
        >
          <span className="shrink-0 text-[var(--dk-text-muted)]">{t("beats.cut")}</span>
          {[1, 2, 4].map((every) => (
            <button
              key={every}
              type="button"
              onClick={() => setNote(t("beats.cutDone", { count: cutAtBeats(item.id, every) }))}
              className="flex-1 rounded bg-[var(--dk-bg)] py-0.5 hover:bg-white/10"
            >
              {t("beats.every", { count: every })}
            </button>
          ))}
        </div>
      ) : null}
      {note ? <p className="text-[11px] text-[var(--dk-text-muted)]">{note}</p> : null}
    </div>
  );
}

function MusicCard({ item }: { item: MusicItem }) {
  const { t } = useTranslation();
  const clipsEnd = useEditorStore((s) => sequenceEnd(s.clips));
  return (
    <div className="space-y-2 rounded-xl border border-[var(--dk-border)] bg-[var(--dk-surface-2)] p-2.5">
      <div className="flex items-center gap-2">
        <Music2 size={14} className="shrink-0 text-[#34d399]" />
        <span
          className="min-w-0 flex-1 truncate text-xs font-semibold text-white"
          title={item.path}
        >
          {item.name}
        </span>
        <button
          type="button"
          onClick={() => removeMusic(item.id)}
          aria-label={t("editor.layerRemove")}
          className="rounded p-1 text-[var(--dk-text-muted)] hover:text-[var(--dk-error)]"
        >
          <Trash2 size={13} />
        </button>
      </div>
      <BeatRow item={item} />
      <EnvelopeEditor item={item} />
      <p className="font-mono text-[10px] text-[var(--dk-text-muted)]">
        {formatTimecode(item.start, 1)} → {formatTimecode(musicEnd(item), 1)}
      </p>
      <Slider
        label={t("editor.musicVolume")}
        value={item.volume}
        min={0}
        max={2}
        step={0.05}
        format={pct}
        onLive={(volume) => updateMusic(item.id, { volume }, true)}
      />
      <Slider
        label={t("editor.musicSrcStart")}
        value={item.srcStart}
        min={0}
        max={Math.max(0, item.sourceDuration - 0.5)}
        step={0.1}
        format={(v) => formatTimecode(v, 1)}
        onLive={(srcStart) =>
          updateMusic(
            item.id,
            { srcStart, length: Math.min(item.length, item.sourceDuration - srcStart) },
            true,
          )
        }
      />
      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={() => updateMusic(item.id, { start: usePlayerStore.getState().currentTime })}
          className="rounded-lg border border-[var(--dk-border)] px-2 py-1 text-[11px] hover:border-[var(--dk-accent)]"
        >
          {t("editor.musicStartHere")}
        </button>
        <button
          type="button"
          disabled={clipsEnd <= item.start + 0.2}
          onClick={() =>
            updateMusic(item.id, {
              length: Math.max(
                0.5,
                Math.min(item.sourceDuration - item.srcStart, clipsEnd - item.start),
              ),
            })
          }
          className="rounded-lg border border-[var(--dk-border)] px-2 py-1 text-[11px] hover:border-[var(--dk-accent)] disabled:opacity-40"
        >
          {t("editor.musicFit")}
        </button>
        {(["fadeIn", "fadeOut"] as const).map((edge) => (
          <button
            key={edge}
            type="button"
            aria-pressed={item[edge] > 0}
            onClick={() =>
              updateMusic(item.id, { [edge]: item[edge] > 0 ? 0 : Math.min(2, item.length / 4) })
            }
            className={`rounded-lg border px-2 py-1 text-[11px] ${
              item[edge] > 0
                ? "border-transparent bg-[var(--dk-accent)] text-white"
                : "border-[var(--dk-border)] hover:border-[var(--dk-accent)]"
            }`}
          >
            {t(`editor.music.${edge}`)}
          </button>
        ))}
        {/* Konuşma olunca müzik kendiliğinden kısılır (dışa aktarımda uygulanır). */}
        <button
          type="button"
          aria-pressed={item.duck === true}
          title={t("editor.music.duckHint")}
          onClick={() => updateMusic(item.id, { duck: item.duck ? undefined : true })}
          className={`rounded-lg border px-2 py-1 text-[11px] ${
            item.duck
              ? "border-transparent bg-[var(--dk-accent)] text-white"
              : "border-[var(--dk-border)] hover:border-[var(--dk-accent)]"
          }`}
        >
          {t("editor.music.duck")}
        </button>
      </div>
    </div>
  );
}

/** Logo, çıkartma ve resim: konum, boyut, saydamlık, zaman. */
export function ImagesPanel() {
  const { t } = useTranslation();
  const images = useEditorStore((s) => s.images);
  return (
    <div className="space-y-3">
      <Title hint={t("editor.imagesHint")}>{t("editor.toolImages")}</Title>
      <StickerPicker />
      <Button
        size="sm"
        className="w-full"
        icon={<ImagePlus size={15} />}
        onClick={() => void addImage()}
      >
        {t("editor.imageAdd")}
      </Button>
      {images.map((i) => (
        <ImageCard key={i.id} item={i} />
      ))}
    </div>
  );
}

function ImageCard({ item }: { item: ImageItem }) {
  const { t } = useTranslation();
  const clipsEnd = useEditorStore((s) => sequenceEnd(s.clips));
  const spots = Object.entries(IMAGE_SPOTS) as [
    keyof typeof IMAGE_SPOTS,
    { x: number; y: number },
  ][];
  return (
    <div className="space-y-2 rounded-xl border border-[var(--dk-border)] bg-[var(--dk-surface-2)] p-2.5">
      <div className="flex items-center gap-2">
        <ImagePlus size={14} className="shrink-0 text-[var(--dk-accent-hover)]" />
        <span
          className="min-w-0 flex-1 truncate text-xs font-semibold text-white"
          title={item.path}
        >
          {item.name}
        </span>
        <button
          type="button"
          onClick={() => removeImage(item.id)}
          aria-label={t("editor.layerRemove")}
          className="rounded p-1 text-[var(--dk-text-muted)] hover:text-[var(--dk-error)]"
        >
          <Trash2 size={13} />
        </button>
      </div>
      <div className="grid grid-cols-5 gap-1">
        {spots.map(([id, spot]) => (
          <button
            key={id}
            type="button"
            title={t(`editor.imageSpot.${id}`)}
            aria-pressed={Math.abs(item.x - spot.x) < 0.01 && Math.abs(item.y - spot.y) < 0.01}
            onClick={() => updateImage(item.id, spot)}
            className={`relative h-7 rounded-md border ${
              Math.abs(item.x - spot.x) < 0.01 && Math.abs(item.y - spot.y) < 0.01
                ? "border-[var(--dk-accent)] bg-[var(--dk-accent)]/20"
                : "border-[var(--dk-border)]"
            }`}
          >
            <span
              className="absolute h-1.5 w-1.5 rounded-full bg-[var(--dk-text)]"
              style={{ left: `calc(${spot.x * 100}% - 3px)`, top: `calc(${spot.y * 100}% - 3px)` }}
            />
          </button>
        ))}
      </div>
      <Slider
        label={t("editor.imageSize")}
        value={item.size}
        min={0.04}
        max={0.8}
        step={0.01}
        format={pct}
        onLive={(size) => updateImage(item.id, { size }, true)}
      />
      <Slider
        label={t("editor.imageOpacity")}
        value={item.opacity}
        min={0.1}
        max={1}
        step={0.01}
        format={pct}
        onLive={(opacity) => updateImage(item.id, { opacity }, true)}
      />
      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={() => updateImage(item.id, { start: 0, end: Math.max(1, clipsEnd) })}
          className="rounded-lg border border-[var(--dk-border)] px-2 py-1 text-[11px] hover:border-[var(--dk-accent)]"
        >
          {t("editor.imageWhole")}
        </button>
        <button
          type="button"
          onClick={() => {
            const at = usePlayerStore.getState().currentTime;
            updateImage(item.id, { start: at, end: at + 3 });
          }}
          className="rounded-lg border border-[var(--dk-border)] px-2 py-1 text-[11px] hover:border-[var(--dk-accent)]"
        >
          {t("editor.imageHere")}
        </button>
      </div>
      <p className="font-mono text-[10px] text-[var(--dk-text-muted)]">
        {formatTimecode(item.start, 1)} → {formatTimecode(item.end, 1)}
      </p>
    </div>
  );
}

/** Başlangıç/bitişi oynatma çizgisinin olduğu ana çeker; düğmede o an yazar. */
function BlurTimeButtons({ item: b }: { item: BlurItem }) {
  const { t } = useTranslation();
  const now = usePlayerStore((s) => s.currentTime);
  const cls =
    "rounded-lg border border-[var(--dk-border)] px-2 py-1 text-[11px] leading-tight hover:border-[var(--dk-accent)] disabled:opacity-40";
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          disabled={now >= b.end - 0.2}
          onClick={() => updateBlur(b.id, { start: Math.min(now, b.end - 0.2) })}
          className={cls}
        >
          {t("editor.blurStartHere", { time: formatTimecode(now, 1) })}
        </button>
        <button
          type="button"
          disabled={now <= b.start + 0.2}
          onClick={() => updateBlur(b.id, { end: Math.max(now, b.start + 0.2) })}
          className={cls}
        >
          {t("editor.blurEndHere", { time: formatTimecode(now, 1) })}
        </button>
      </div>
      <p className="text-[10px] leading-snug text-[var(--dk-text-muted)]">
        {t("editor.blurTimeHint")}
      </p>
    </div>
  );
}

/** Hareketli gizleme: anahtar kareler ya da yüz takibi. */
function BlurMotion({ item: b }: { item: BlurItem }) {
  const { t } = useTranslation();
  const tracking = useBlurTrack((s) => s.id === b.id);
  const progress = useBlurTrack((s) => s.progress);
  const failed = useBlurTrack((s) => s.failed);
  const keyed = (b.keys?.length ?? 0) > 0;
  const cls =
    "flex-1 rounded-lg border border-[var(--dk-border)] px-2 py-1 text-[11px] hover:border-[var(--dk-accent)] disabled:opacity-40";
  return (
    <div className="space-y-1">
      <div className="flex gap-1.5">
        <button
          type="button"
          aria-pressed={keyed}
          onClick={() => {
            if (keyed) {
              updateBlur(b.id, { keys: undefined });
              return;
            }
            const now = usePlayerStore.getState().currentTime;
            updateBlur(b.id, { keys: setBlurKey(b, now, b.x, b.y) });
          }}
          className={`${cls} ${keyed ? "border-[var(--dk-accent)] text-[var(--dk-accent)]" : ""}`}
        >
          {keyed ? t("editor.blurKeysOn", { n: b.keys!.length }) : t("editor.blurKeysOff")}
        </button>
        <button
          type="button"
          disabled={tracking}
          onClick={() => void trackBlurFace(b.id)}
          className={cls}
        >
          {tracking
            ? t("editor.blurTracking", { p: Math.round(progress * 100) })
            : t("editor.blurFollowFace")}
        </button>
      </div>
      {(failed && !tracking) || keyed ? (
        <p className="text-[10px] leading-snug text-[var(--dk-text-muted)]">
          {failed && !tracking ? t("editor.blurNoFace") : t("editor.blurKeysHint")}
        </p>
      ) : null}
    </div>
  );
}

/** Gizle: isim, sohbet, e-posta gibi bir alanı belli bir süre bulanıklaştırır. Bölge
 * önizlemede sürüklenir; süresi imleçle ayarlanır. */
export function BlurPanel() {
  const { t } = useTranslation();
  const blurs = useEditorStore((s) => s.blurs);
  const selected = useBlurSelection((s) => s.id);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        <p className="text-sm font-semibold text-white">{t("editor.toolBlur")}</p>
        <HelpTip title={t("editor.toolBlur")} text={t("editor.blurHint")} />
      </div>
      <Button icon={<Plus size={15} />} onClick={() => addBlur()} className="w-full">
        {t("editor.blurAdd")}
      </Button>
      {blurs.length === 0 ? (
        <p className="text-xs text-[var(--dk-text-muted)]">{t("editor.blurEmpty")}</p>
      ) : null}
      {blurs.map((b, i) => (
        <div
          key={b.id}
          onClick={() => useBlurSelection.getState().select(b.id)}
          className={`space-y-2 rounded-xl border p-2.5 ${
            selected === b.id ? "dk-selected" : "border-[var(--dk-border)]"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium">
              {t("editor.blurItem", { n: i + 1 })}
              <span className="ml-1.5 font-mono text-[10px] text-[var(--dk-text-muted)]">
                {formatTimecode(b.start, 1)} → {formatTimecode(b.end, 1)}
              </span>
            </p>
            <button
              type="button"
              aria-label={t("editor.blurRemove")}
              title={t("editor.blurRemove")}
              onClick={(e) => {
                e.stopPropagation();
                removeBlur(b.id);
              }}
              className="rounded p-1 text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-[var(--dk-error)]"
            >
              <Trash2 size={13} />
            </button>
          </div>
          <BlurTimeButtons item={b} />
          <BlurMotion item={b} />
          <div className="flex gap-1.5">
            {([false, true] as const).map((pixel) => (
              <button
                key={String(pixel)}
                type="button"
                aria-pressed={b.pixel === pixel}
                onClick={() => updateBlur(b.id, { pixel })}
                className={`flex-1 rounded-lg px-2 py-1 text-[11px] ${
                  b.pixel === pixel
                    ? "bg-[var(--dk-accent)] text-white"
                    : "bg-[var(--dk-bg)] hover:bg-white/10"
                }`}
              >
                {pixel ? t("editor.blurPixel") : t("editor.blurSoft")}
              </button>
            ))}
          </div>
          <label className="block text-[11px]">
            <span className="flex justify-between">
              <span>{t("editor.blurStrength")}</span>
              <span className="font-mono text-[var(--dk-text-muted)]">
                %{Math.round(b.strength * 100)}
              </span>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={b.strength}
              onPointerDown={() => useEditorStore.getState().beginDrag()}
              onPointerUp={() => useEditorStore.getState().endDrag()}
              {...sliderKeys(() => {})}
              onChange={(e) => updateBlur(b.id, { strength: Number(e.target.value) }, true)}
              className="dk-volume w-full"
            />
          </label>
        </div>
      ))}
    </div>
  );
}
