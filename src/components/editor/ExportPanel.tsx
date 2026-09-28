import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Download, FileOutput, FolderOpen } from "lucide-react";
import {
  FRAME_SIZES,
  useEditorStore,
  type EditorSourceEntry,
  type ExportOptions,
  type FrameAspect,
} from "../../store/editorStore";
import { useJobsStore } from "../../store/jobsStore";
import { getSettings, useSettingsStore } from "../../lib/appSettings";
import { PLATFORM_LABEL, isSupportedPlatform } from "../../lib/platforms";
import { changeDestination, ensureDestination } from "../../lib/destination";
import { enqueueEdit } from "../../lib/jobEngine";
import { defaultDownloadOptions, estimateDownloadSize } from "../../lib/jobPlanning";
import { formatBytes } from "../../lib/format";
import { rangeLabel } from "../../lib/timeRange";
import { formatTimecode } from "../../lib/timeline";
import {
  exportPieces,
  flatten,
  piecesDuration,
  type ExportPiece,
  type Segment,
} from "../../lib/sequence";
import { toOverlays } from "../../lib/textItems";
import { isDefaultLook, normalizeLook } from "../../lib/clipLook";
import { localizeGroupInputs } from "../../lib/exportPlan";
import type { EditClip } from "../../types/edit";
import type { MediaMetadata } from "../../types/media";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import { Switch } from "../ui/Switch";
import { Tabs } from "../ui/Tabs";
import { JobRow } from "../JobRow";

const AUDIO_BITRATES = [128, 192, 256, 320];
// i18next ":" işaretini ad alanı ayırıcısı sayar; çeviri anahtarları ayrı.
const FRAME_KEYS: Record<FrameAspect, string> = {
  original: "original",
  "9:16": "vertical",
  "1:1": "square",
  "4:5": "portrait",
  "16:9": "landscape",
};
const GIF_FPS = [10, 12, 15, 20, 24];
const GIF_WIDTHS = [320, 480, 640, 800];
/** Bundan uzun GIF'ler çoğu yerde paylaşılamayacak kadar büyür. */
const GIF_LONG_SECONDS = 15;

function remoteEstimate(
  metadata: MediaMetadata,
  options: ExportOptions,
  seconds: number,
): number | null {
  return estimateDownloadSize(metadata, {
    ...defaultDownloadOptions(),
    outputFormat: options.output === "audio" ? options.audioFormat : options.videoFormat,
    maxHeight: options.maxHeight,
    audioBitrateKbps: options.audioBitrateKbps,
    section: { start: 0, end: seconds },
  });
}

function audioEstimate(options: ExportOptions, seconds: number): number | null {
  if (options.audioFormat === "wav") return Math.round(seconds * 176_400);
  if (options.audioFormat === "flac") return null;
  return Math.round((seconds * options.audioBitrateKbps * 1000) / 8);
}

/** Boşluk: süresi kadar siyah görüntü ve sessizlik. */
function pieceClip(piece: ExportPiece): EditClip {
  return piece.kind === "clip"
    ? toEditClip(piece.segment)
    : {
        start: 0,
        end: piece.tEnd - piece.tStart,
        speed: 1,
        volume: 1,
        fadeIn: 0,
        fadeOut: 0,
        black: true,
      };
}

function toEditClip(segment: Segment): EditClip {
  return {
    start: segment.srcStart,
    end: segment.srcEnd,
    speed: segment.speed,
    volume: segment.volume,
    fadeIn: segment.fadeIn,
    fadeOut: segment.fadeOut,
    ...(isDefaultLook(segment.look) ? {} : { look: normalizeLook(segment.look) }),
    ...(segment.fadeWhite ? { fadeWhite: true } : {}),
  };
}

/** Parçaların kullandığı kaynakları ilk geçtikleri sırayla toplar ve her klibe
 * kaynak indeksini yazar. Saf modül fonksiyonudur: render sırasında kapanım
 * değişkeni değiştirmez (react-hooks/immutability). */
function buildRanges(
  pieces: ExportPiece[],
  sources: EditorSourceEntry[],
): { usedInputs: EditorSourceEntry[]; ranges: EditClip[] } {
  const inputs: EditorSourceEntry[] = [];
  const ranges: EditClip[] = pieces.map((piece) => {
    if (piece.kind !== "clip") return pieceClip(piece);
    const id = piece.segment.sourceId ?? sources[0]?.id;
    let index = inputs.findIndex((s) => s.id === id);
    if (index < 0) {
      const entry = sources.find((s) => s.id === id) ?? sources[0];
      if (!entry) {
        index = 0;
      } else {
        inputs.push(entry);
        index = inputs.length - 1;
      }
    }
    return { ...pieceClip(piece), source: index };
  });
  return { usedInputs: inputs, ranges };
}

/** Dışa aktarma: görüntü ya da yalnızca ses, biçim/kalite, birleştir ya da ayrı dosyalar. */
export function ExportPanel() {
  const { t } = useTranslation();
  const source = useEditorStore((s) => s.source);
  const sources = useEditorStore((s) => s.sources);
  const options = useEditorStore((s) => s.exportOptions);
  const setOptions = useEditorStore((s) => s.setExportOptions);
  const clips = useEditorStore((s) => s.clips);
  const texts = useEditorStore((s) => s.texts);
  const tracks = useEditorStore((s) => s.tracks);
  const lastJobIds = useEditorStore((s) => s.lastJobIds);
  const setLastJobIds = useEditorStore((s) => s.setLastJobIds);
  const destinationDir = useSettingsStore((s) => s.defaultDownloadDir);
  const jobs = useJobsStore((s) => s.jobs);

  if (!source) return null;
  // Zaman çizelgesi çıktıya dönüşür: her anda en üstteki klip; klipler arasındaki
  // boşluk siyah ekran olur (Clipchamp'taki gibi).
  const segments = flatten(clips, tracks);
  const pieces = exportPieces(segments);
  // Parçaların kullandığı kaynaklar, ilk geçtikleri sırayla: dışa aktarım
  // isteğindeki `inputs` bu sırayla kurulur; her klip kaynak indeksini taşır.
  const { usedInputs, ranges } = buildRanges(pieces, sources);
  // start() içinde (render sonrası) aynı eşleme salt-okunur aramayla bulunur.
  const sourceIndex = (sourceId: string | undefined): number => {
    const id = sourceId ?? sources[0]?.id;
    return Math.max(
      0,
      usedInputs.findIndex((s) => s.id === id),
    );
  };
  const total = piecesDuration(pieces);
  const multiSource = usedInputs.length > 1;
  const remote = usedInputs.some((e) => e.source.kind === "remote");
  const hasVideo = usedInputs.some((e) =>
    e.source.kind === "remote" ? (e.stream?.hasVideo ?? true) : e.source.info.videoCodec !== null,
  );
  // Farklı kaynakların kare boyutları uyuşmayabilir; GIF birleştirme tek kaynakla sınırlı.
  const gif = options.output === "gif" && hasVideo && !multiSource;
  const audio = !gif && (options.output === "audio" || !hasVideo);
  // Hız, ses düzeyi ya da geçiş: kopyalayarak kesilemez, yeniden kodlanır.
  const speedChanged = ranges.some(
    (r) => r.black || r.look || r.speed !== 1 || r.volume !== 1 || r.fadeIn > 0 || r.fadeOut > 0,
  );
  const hasGaps = pieces.some((p) => p.kind === "gap");
  const multiple = segments.length > 1;
  const framed = !audio && options.frame !== "original";
  const hasTexts = !audio && toOverlays(texts, pieces).length > 0;
  const separate = multiple && !options.merge;
  const lastJobs = jobs.filter((j) => lastJobIds.includes(j.id));
  const remoteMeta = (e: EditorSourceEntry | undefined): MediaMetadata | null =>
    e && e.source.kind === "remote" ? e.source.metadata : null;

  // Kaynak başına indirilecek/okunacak saniye.
  const secondsByInput = usedInputs.map(() => 0);
  for (const r of ranges) if (!r.black) secondsByInput[r.source ?? 0] += r.end - r.start;

  const estimate =
    !ranges.length || gif
      ? null
      : audio
        ? audioEstimate(options, total)
        : usedInputs.reduce<number | null>((sum, entry, i) => {
            if (sum === null) return null;
            const metadata = remoteMeta(entry);
            if (metadata) {
              const part = remoteEstimate(metadata, options, secondsByInput[i]);
              return part === null ? null : sum + part;
            }
            if (entry.source.kind !== "local") return null;
            return !options.precise && !multiple && !speedChanged
              ? sum +
                  Math.round((entry.source.info.fileSizeBytes * secondsByInput[i]) / entry.duration)
              : null;
          }, 0);

  const firstInput = usedInputs[0];
  const baseName = options.outputName.trim() || (firstInput?.title ?? "");
  const format = gif ? "gif" : audio ? options.audioFormat : remote ? options.videoFormat : null;
  const qualityLabel = gif
    ? `${options.gifWidth}px · ${options.gifFps} fps`
    : audio
      ? ["wav", "flac"].includes(options.audioFormat)
        ? "lossless"
        : `${options.audioBitrateKbps} kbps`
      : remote
        ? options.maxHeight
          ? `${options.maxHeight}p`
          : "best"
        : null;

  async function start() {
    if (!source || ranges.length === 0) return;
    const chosen = await ensureDestination();
    if (!chosen) return;
    const firstRemote = usedInputs.map(remoteMeta).find((m) => m !== null) ?? null;
    // "Platforma göre klasörle" açıksa linkten alınan klipler de indirmeler gibi
    // "YouTube…", "Kick…" alt klasörüne gider.
    const firstPlatform = firstRemote?.platform;
    const dir =
      firstPlatform && getSettings().groupByPlatform && isSupportedPlatform(firstPlatform)
        ? `${chosen}\\${PLATFORM_LABEL[firstPlatform]}`
        : chosen;
    // Ayrı dosyalarda her parça, klibe ad verildiyse o adla kaydedilir.
    const clipName = (segment: Segment) =>
      clips.find((c) => c.id === segment.clipId)?.name.trim() ||
      `${baseName} (${rangeLabel({ start: segment.srcStart, end: segment.srcEnd })})`;
    const title = firstInput?.title ?? baseName;
    // Ayrı dosyalarda boşluk yok: her klip kendi dosyası (baştan başlar).
    const groups: { clips: EditClip[]; pieces: ExportPiece[]; name: string }[] =
      separate || (segments.length === 1 && !hasGaps)
        ? segments.map((segment) => ({
            clips: [{ ...toEditClip(segment), source: sourceIndex(segment.sourceId) }],
            pieces: exportPieces([segment], false),
            name: clipName(segment),
          }))
        : [{ clips: ranges, pieces, name: baseName }];

    const ids = groups.map((group) => {
      // Her grup yalnızca kendi kullandığı kaynakları gönderir: tek kaynaklı
      // grup tek girdili istek olur, arka uç hızlı (yeniden kodlamasız) yola düşer.
      const localized = localizeGroupInputs(group.clips, usedInputs);
      const firstGroupInput = localized.inputs[0];
      const label =
        group.clips.length === 1
          ? `${formatTimecode(group.clips[0].start, 0)}–${formatTimecode(group.clips[0].end, 0)}`
          : t("editor.jobClips", { count: group.clips.length });
      const groupEstimate = gif
        ? null
        : group.clips
            .filter((c) => !c.black)
            .reduce<number | null>((sum, c) => {
              if (sum === null) return null;
              const metadata = remoteMeta(usedInputs[c.source ?? 0]);
              if (!metadata) return null;
              const part = remoteEstimate(metadata, options, c.end - c.start);
              return part === null ? null : sum + part;
            }, 0);
      return enqueueEdit(
        {
          kind: "edit",
          inputPath: firstGroupInput?.inputPath ?? null,
          url: firstGroupInput?.url ?? null,
          inputs: localized.inputs,
          clips: localized.clips,
          destinationDir: dir,
          outputName: group.name,
          audioOnly: audio,
          outputFormat: gif ? null : format,
          maxHeight: remote && !audio ? options.maxHeight : null,
          audioBitrateKbps: options.audioBitrateKbps,
          precise: options.precise && !multiSource,
          gif: gif ? { fps: options.gifFps, width: options.gifWidth } : null,
          frame: framed
            ? {
                width: FRAME_SIZES[options.frame as Exclude<FrameAspect, "original">][0],
                height: FRAME_SIZES[options.frame as Exclude<FrameAspect, "original">][1],
                fit: options.frameFit,
                position: options.framePosition,
              }
            : null,
          // Her dosya kendi parçalarına göre: yazının çıktıdaki zamanı ona göre.
          texts: audio ? [] : toOverlays(texts, group.pieces),
        },
        {
          title: group.clips.length === 1 && groups.length > 1 ? group.name : title,
          thumbnailUrl: firstRemote?.thumbnailUrl ?? null,
          platform: firstRemote?.platform ?? "local",
          formatLabel: `${(format ?? (options.precise || multiple || speedChanged || multiSource ? "mp4" : firstInput?.source.kind === "local" ? firstInput.source.info.container : "mp4")).toUpperCase()} · ${label}`,
          qualityLabel,
          totalBytesEstimate: groupEstimate,
        },
      );
    });
    setLastJobIds(ids);
  }

  const qualityOptions = remote
    ? [
        { value: 0, label: t("jobs.qualityBest") },
        ...[
          ...new Set(
            usedInputs.flatMap((e) => remoteMeta(e)?.qualityOptions.map((q) => q.height) ?? []),
          ),
        ]
          .sort((a, b) => b - a)
          .map((height) => ({ value: height, label: `${height}p` })),
      ]
    : [];

  return (
    <div className="space-y-4" data-tour="editor-export">
      {hasVideo ? (
        <Tabs
          stretch
          value={gif ? "gif" : audio ? "audio" : "video"}
          onChange={(output) => setOptions({ output })}
          items={[
            { value: "video" as const, label: t("editor.outputVideo") },
            { value: "audio" as const, label: t("editor.outputAudio") },
            // Farklı kaynakların kare boyutları uyuşmayabilir: GIF tek kaynakla.
            ...(multiSource ? [] : [{ value: "gif" as const, label: t("editor.outputGif") }]),
          ]}
        />
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        {gif ? (
          <>
            <Field label={t("editor.gifFps")}>
              <Select
                value={options.gifFps}
                ariaLabel={t("editor.gifFps")}
                onChange={(gifFps) => setOptions({ gifFps })}
                options={GIF_FPS.map((f) => ({ value: f, label: `${f} fps` }))}
              />
            </Field>
            <Field label={t("editor.gifWidth")}>
              <Select
                value={options.gifWidth}
                ariaLabel={t("editor.gifWidth")}
                onChange={(gifWidth) => setOptions({ gifWidth })}
                options={GIF_WIDTHS.map((w) => ({ value: w, label: `${w} px` }))}
              />
            </Field>
          </>
        ) : audio ? (
          <>
            <Field label={t("options.format")}>
              <Select
                value={options.audioFormat}
                ariaLabel={t("options.format")}
                onChange={(audioFormat) => setOptions({ audioFormat })}
                options={(["mp3", "m4a", "wav", "flac"] as const).map((f) => ({
                  value: f,
                  label: f.toUpperCase(),
                }))}
              />
            </Field>
            <Field label={t("editor.bitrate")}>
              <Select
                value={options.audioBitrateKbps}
                ariaLabel={t("editor.bitrate")}
                disabled={["wav", "flac"].includes(options.audioFormat)}
                onChange={(audioBitrateKbps) => setOptions({ audioBitrateKbps })}
                options={AUDIO_BITRATES.map((k) => ({ value: k, label: `${k} kbps` }))}
              />
            </Field>
          </>
        ) : remote ? (
          <>
            <Field label={t("options.format")}>
              <Select
                value={options.videoFormat}
                ariaLabel={t("options.format")}
                onChange={(videoFormat) => setOptions({ videoFormat })}
                options={(["mp4", "mkv", "webm"] as const).map((f) => ({
                  value: f,
                  label: f.toUpperCase(),
                }))}
              />
            </Field>
            <Field label={t("options.quality")}>
              <Select
                value={options.maxHeight ?? 0}
                ariaLabel={t("options.quality")}
                onChange={(height) => setOptions({ maxHeight: height === 0 ? null : height })}
                options={qualityOptions}
              />
            </Field>
          </>
        ) : null}
      </div>

      {gif ? (
        <p className="text-xs text-[var(--dk-text-muted)]">
          {total > GIF_LONG_SECONDS
            ? t("editor.gifLong", { seconds: Math.round(total) })
            : t("editor.gifHint")}
        </p>
      ) : null}

      {!audio ? (
        <div className="space-y-2" data-tour="editor-frame">
          <Field label={t("editor.frame")}>
            <Select
              value={options.frame}
              ariaLabel={t("editor.frame")}
              onChange={(frame) => setOptions({ frame })}
              options={(["original", "9:16", "1:1", "4:5", "16:9"] as const).map((f) => ({
                value: f,
                label: t(`editor.frameOption.${FRAME_KEYS[f]}`),
                hint: f === "original" ? undefined : f,
              }))}
            />
          </Field>
          {framed ? (
            <>
              <Tabs
                stretch
                value={options.frameFit ? "fit" : "crop"}
                onChange={(mode) => setOptions({ frameFit: mode === "fit" })}
                items={[
                  { value: "crop", label: t("editor.frameCrop") },
                  { value: "fit", label: t("editor.frameFit") },
                ]}
              />
              {options.frameFit ? (
                <p className="text-xs text-[var(--dk-text-muted)]">{t("editor.frameFitHint")}</p>
              ) : (
                <>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={options.framePosition}
                    aria-label={t("editor.framePosition")}
                    onChange={(e) => setOptions({ framePosition: Number(e.target.value) })}
                    className="dk-volume w-full"
                  />
                  <p className="text-xs text-[var(--dk-text-muted)]">{t("editor.frameCropHint")}</p>
                </>
              )}
            </>
          ) : null}
        </div>
      ) : null}

      {!remote &&
      !multiSource &&
      !audio &&
      !gif &&
      !framed &&
      !hasTexts &&
      (!multiple || separate) &&
      !speedChanged ? (
        <div className="space-y-2">
          <p className="text-xs text-[var(--dk-text-muted)]">{t("editor.cutMode")}</p>
          <Tabs
            stretch
            value={options.precise ? "precise" : "fast"}
            onChange={(mode) => setOptions({ precise: mode === "precise" })}
            items={[
              { value: "fast", label: t("trim.fast") },
              { value: "precise", label: t("trim.precise") },
            ]}
          />
          <p className="text-xs text-[var(--dk-text-muted)]">
            {options.precise ? t("trim.preciseDesc") : t("trim.fastDesc")}
          </p>
        </div>
      ) : null}

      {!remote && multiSource && !audio && !gif ? (
        <p className="text-xs text-[var(--dk-text-muted)]">{t("editor.preciseMultiHint")}</p>
      ) : null}

      {multiple ? (
        <label className="flex items-center gap-3 rounded-xl border border-[var(--dk-border)] bg-[var(--dk-bg)]/40 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{t("editor.mergeClips")}</p>
            <p className="text-xs text-[var(--dk-text-muted)]">
              {options.merge
                ? t("editor.mergeOn", { count: segments.length })
                : t("editor.mergeOff", { count: segments.length })}
            </p>
          </div>
          <Switch
            checked={options.merge}
            onChange={(merge) => setOptions({ merge })}
            label={t("editor.mergeClips")}
          />
        </label>
      ) : null}

      <Field label={separate ? t("editor.namePrefix") : t("editor.fileName")}>
        <input
          value={options.outputName}
          onChange={(e) => setOptions({ outputName: e.target.value })}
          placeholder={firstInput?.title}
          className="h-10 w-full rounded-xl border border-[var(--dk-border)] bg-[var(--dk-surface-2)] px-3 text-sm outline-none focus:border-[var(--dk-accent)]"
        />
      </Field>

      <button
        type="button"
        onClick={() => void changeDestination()}
        className="flex max-w-full items-center gap-1.5 text-xs text-[var(--dk-text-muted)] hover:text-white"
      >
        <FolderOpen size={14} className="shrink-0" />
        <span className="truncate">{destinationDir ?? t("options.chooseDestination")}</span>
        <span className="shrink-0 text-[var(--dk-accent-hover)]">{t("options.change")}</span>
      </button>

      <div className="space-y-2 border-t border-[var(--dk-border)] pt-3">
        <p className="text-sm">
          {ranges.length === 0
            ? t("editor.nothingToExport")
            : t("editor.exportSummary", {
                count: segments.length,
                total: formatTimecode(total, 1),
              })}
          {estimate ? (
            <span className="text-[var(--dk-text-muted)]"> · ~{formatBytes(estimate)}</span>
          ) : null}
        </p>
        {hasGaps && ranges.length > 0 ? (
          <p className="text-xs text-[var(--dk-text-muted)]">{t("editor.gapsSkipped")}</p>
        ) : null}
        {remote && ranges.length > 0 ? (
          <p className="text-xs text-[var(--dk-text-muted)]">
            {t("editor.onlySelectedDownloaded", {
              full: formatTimecode(
                usedInputs.reduce((sum, e) => sum + (remoteMeta(e) ? e.duration : 0), 0),
                0,
              ),
            })}
          </p>
        ) : null}
        {multiSource ? (
          <p className="text-xs text-[var(--dk-text-muted)]">{t("editor.multiSourceHint")}</p>
        ) : null}
        <Button
          size="lg"
          className="w-full"
          disabled={ranges.length === 0}
          icon={remote ? <Download size={18} /> : <FileOutput size={18} />}
          onClick={() => void start()}
        >
          {remote
            ? separate
              ? t("editor.downloadSeparate", { count: ranges.length })
              : t("editor.download")
            : separate
              ? t("editor.exportSeparate", { count: ranges.length })
              : t("editor.exportButton")}
        </Button>
      </div>

      {lastJobs.length > 0 ? (
        <div className="-mx-4 divide-y divide-[var(--dk-border)] border-t border-[var(--dk-border)]">
          {lastJobs.map((job) => (
            <JobRow key={job.id} job={job} compact />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <p className="text-xs text-[var(--dk-text-muted)]">{label}</p>
      {children}
    </div>
  );
}
