import { refreshProfiles, usePlatformProfiles } from "../../lib/platformProfiles";
import { ShareCheck } from "./ShareCheck";
import { SOCIAL_LUFS } from "../../lib/audioFx";
import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FileOutput, FolderOpen } from "lucide-react";
import {
  FRAME_SIZES,
  useEditorStore,
  type EditorSourceEntry,
  type ExportOptions,
  type FrameAspect,
} from "../../store/editorStore";
import { useJobsStore } from "../../store/jobsStore";
import { useSettingsStore } from "../../lib/appSettings";
import { changeDestination, ensureDestination } from "../../lib/destination";
import { enqueueEdit } from "../../lib/jobEngine";
import { formatBytes } from "../../lib/format";
import { rangeLabel } from "../../lib/timeRange";
import { formatTimecode } from "../../lib/timeline";
import {
  exportPieces,
  flatten,
  overlaySegments,
  piecesDuration,
  type ExportPiece,
  type OverlaySegment,
  type Segment,
} from "../../lib/sequence";
import { exportTransform } from "../../lib/clipTransform";
import { withEffects } from "../../lib/effectLane";
import { toOverlays } from "../../lib/textItems";
import { isDefaultLook, normalizeLook } from "../../lib/clipLook";
import { localizeGroupInputs } from "../../lib/exportPlan";
import type { ClipOverlayReq, EditClip } from "../../types/edit";
import { clampStrength } from "../../lib/clipFx";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import { Switch } from "../ui/Switch";
import { Tabs } from "../ui/Tabs";
import { JobRow } from "../JobRow";
import { buildAss } from "../../lib/captionAss";
import { writeSideSrt } from "../../lib/captionActions";
import { emojiOverlays, prepareEmojiFiles } from "../../lib/emojiImage";
import { audibleMusic, toBlurRegions, toImageOverlays, toMusicTracks } from "../../lib/layers";
import { useRecorderStore } from "../../store/recorderStore";
import { FrameLayouts } from "./FrameLayouts";
import { outputTrack } from "../../lib/faceTrack";
import { frameRequest } from "../../lib/frameRequest";
import { sourceAspectOf, tracksForAspect } from "../../lib/faceActions";
import { exportFrames, FRAME_KEYS, frameSuffix, textsForFrame } from "../../lib/multiFormat";
import { MultiFormatRow } from "./MultiFormatRow";

const AUDIO_BITRATES = [128, 192, 256, 320];
const GIF_FPS = [10, 12, 15, 20, 24];
const GIF_WIDTHS = [320, 480, 640, 800];
/** Bundan uzun GIF'ler çoğu yerde paylaşılamayacak kadar büyür. */
const GIF_LONG_SECONDS = 15;

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
    ...fxFields(segment),
    // Klipler arası geçiş: arka uç kesimin iki yanına kaynak payı ekler.
    ...(segment.xfadeOut ? { xfade: segment.xfadeOut } : {}),
    ...(segment.denoise ? { denoise: true } : {}),
    ...(segment.motionBlur ? { motionBlur: true } : {}),
    ...(segment.audioFx ? { audioFx: segment.audioFx } : {}),
    ...(segment.freezeAt !== undefined ? { freezeAt: segment.freezeAt } : {}),
    ...(segment.reverse ? { reverse: true } : {}),
    // Dönüşüm: kareler parçanın kendi çıktı saniyesine çevrilir.
    ...(segment.transform ? { transform: exportTransform(segment.transform, segment) } : {}),
    ...(segment.zoom ? { zoom: exportTransform(segment.zoom, segment) } : {}),
  };
}

/** Bindirilen parçaları dosyanın parçalarına göre çıktı zamanına çevirir: her parçayla
 * kesişen bölüm ayrı bindirme olur (açılma/kararma yalnız klibin gerçek ucunda). */
function toClipOverlays(
  segments: readonly OverlaySegment[],
  pieces: readonly ExportPiece[],
  sourceIndex: (sourceId: string | undefined) => number,
): ClipOverlayReq[] {
  const out: ClipOverlayReq[] = [];
  let offset = 0;
  for (const piece of pieces) {
    for (const seg of segments) {
      const a = Math.max(piece.tStart, seg.tStart);
      const b = Math.min(piece.tEnd, seg.tEnd);
      if (b - a < 0.02) continue;
      const part: Segment = {
        ...seg,
        tStart: a,
        tEnd: b,
        srcStart: seg.srcStart + (a - seg.tStart) * seg.speed,
        srcEnd: seg.srcStart + (b - seg.tStart) * seg.speed,
        fadeIn: Math.abs(a - seg.tStart) < 1e-6 ? seg.fadeIn : 0,
        fadeOut: Math.abs(b - seg.tEnd) < 1e-6 ? seg.fadeOut : 0,
      };
      out.push({
        source: sourceIndex(seg.sourceId),
        clip: toEditClip(part),
        at: Number((offset + (a - piece.tStart)).toFixed(4)),
      });
    }
    offset += piece.tEnd - piece.tStart;
  }
  return out;
}

/** Hareket ve geçiş stili (Rust `ffmpeg::fx`): parça klibin ortasından başlıyorsa
 * hareket kaldığı yerden sürer. */
function fxFields(segment: Segment): Partial<EditClip> {
  const motion = segment.motion ?? "none";
  const transition = segment.transition ?? "fade";
  const out: Partial<EditClip> = {};
  if (motion !== "none") {
    out.motion = motion;
    out.motionStrength = clampStrength(segment.motionStrength);
    out.motionOffset = Math.max(0, segment.tStart - (segment.clipStart ?? segment.tStart));
    out.motionTotal = segment.clipLength ?? segment.tEnd - segment.tStart;
  }
  if (transition !== "fade") out.transition = transition;
  return out;
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
  const images = useEditorStore((s) => s.images);
  const music = useEditorStore((s) => s.music);
  const blurs = useEditorStore((s) => s.blurs);
  const effects = useEditorStore((s) => s.effects);
  const tracks = useEditorStore((s) => s.tracks);
  const lastJobIds = useEditorStore((s) => s.lastJobIds);
  const setLastJobIds = useEditorStore((s) => s.setLastJobIds);
  const destinationDir = useSettingsStore((s) => s.defaultDownloadDir);
  const jobs = useJobsStore((s) => s.jobs);
  const encoder = useRecorderStore((s) => s.encoder);
  const gpuEncoder = encoder?.hardware ? encoder.encoder : null;

  if (!source) return null;
  // Zaman çizelgesi çıktıya dönüşür: her anda en üstteki klip; klipler arasındaki
  // boşluk siyah ekran olur.
  // Dosyalar ve sayılar kliplere göre; efekt şeridi parçaları blok sınırlarından böler
  // ve görünümlerini katar (bir klip yine tek dosya olur).
  const baseSegments = flatten(clips, tracks);
  const segments = withEffects(baseSegments, effects);
  const pieces = exportPieces(segments);
  // Parçaların kullandığı kaynaklar, ilk geçtikleri sırayla: dışa aktarım
  // isteğindeki `inputs` bu sırayla kurulur; her klip kaynak indeksini taşır.
  const { usedInputs: baseInputs, ranges } = buildRanges(pieces, sources);
  // Üst izden bindirilen kliplerin kaynakları da girdilere eklenir (sona).
  const overlaySegs = overlaySegments(clips, tracks);
  const usedInputs = [...baseInputs];
  for (const seg of overlaySegs) {
    const entry = sources.find((s) => s.id === (seg.sourceId ?? sources[0]?.id)) ?? sources[0];
    if (entry && !usedInputs.includes(entry)) usedInputs.push(entry);
  }
  const hasOverlays = overlaySegs.length > 0;
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
  const hasVideo = usedInputs.some((e) => e.source.info.videoCodec !== null);
  // Farklı kaynakların kare boyutları uyuşmayabilir; GIF birleştirme tek kaynakla sınırlı.
  const gif = options.output === "gif" && hasVideo && !multiSource;
  const audio = !gif && (options.output === "audio" || !hasVideo);
  // Hız, ses düzeyi ya da geçiş: kopyalayarak kesilemez, yeniden kodlanır.
  const speedChanged =
    ranges.some(
      (r) =>
        r.black ||
        r.look ||
        r.motion ||
        r.speed !== 1 ||
        r.volume !== 1 ||
        r.fadeIn > 0 ||
        r.fadeOut > 0 ||
        r.xfade !== undefined ||
        r.denoise === true ||
        r.motionBlur === true ||
        r.audioFx !== undefined ||
        r.freezeAt !== undefined ||
        r.reverse === true ||
        r.transform != null ||
        r.zoom != null,
    ) || hasOverlays;
  const hasGaps = pieces.some((p) => p.kind === "gap");
  const multiple = baseSegments.length > 1;
  const framed = !audio && options.frame !== "original";
  const hasTexts = !audio && toOverlays(texts, pieces).length > 0;
  const separate = multiple && !options.merge;
  // Çoklu biçim: her biçim (9:16, 1:1…) ayrı dosya; önizlenen biçim önce.
  const frames = framed ? exportFrames(options) : [options.frame];
  const multiFormat = frames.length > 1;
  const lastJobs = jobs.filter((j) => lastJobIds.includes(j.id));

  // Kaynak başına okunacak saniye.
  const secondsByInput = usedInputs.map(() => 0);
  for (const r of ranges) if (!r.black) secondsByInput[r.source ?? 0] += r.end - r.start;

  const estimate =
    !ranges.length || gif || multiFormat
      ? null
      : audio
        ? audioEstimate(options, total)
        : options.targetSizeMb
          ? options.targetSizeMb * 1024 * 1024
          : usedInputs.reduce<number | null>((sum, entry, i) => {
              if (sum === null) return null;
              return !options.precise && !multiple && !speedChanged
                ? sum +
                    Math.round(
                      (entry.source.info.fileSizeBytes * secondsByInput[i]) / entry.duration,
                    )
                : null;
            }, 0);

  const firstInput = usedInputs[0];
  const sourceAspect =
    source.info.width && source.info.height ? source.info.width / source.info.height : 16 / 9;
  // ASS yazılarının çizim alanı: çıkış karesinin oranı (libass gerçek boyuta ölçekler).
  const outputFrameOf = (frame: FrameAspect) =>
    framed && frame !== "original"
      ? { width: FRAME_SIZES[frame][0], height: FRAME_SIZES[frame][1] }
      : { width: source.info.width ?? 1920, height: source.info.height ?? 1080 };
  const baseName = options.outputName.trim() || (firstInput?.title ?? "");
  const format = gif ? "gif" : audio ? options.audioFormat : null;
  const qualityLabel = gif
    ? `${options.gifWidth}px · ${options.gifFps} fps`
    : audio
      ? ["wav", "flac"].includes(options.audioFormat)
        ? "lossless"
        : `${options.audioBitrateKbps} kbps`
      : null;

  async function start() {
    if (!source || ranges.length === 0) return;
    const dir = await ensureDestination();
    if (!dir) return;
    // Altyazı emojileri renkli PNG olarak önbelleğe (resim katmanı olarak bindirilir).
    const emojiFiles = audio ? new Map<string, string>() : await prepareEmojiFiles(texts);
    // Ayrı dosyalarda her parça, klibe ad verildiyse o adla kaydedilir.
    const clipName = (segment: Segment) =>
      clips.find((c) => c.id === segment.clipId)?.name.trim() ||
      `${baseName} (${rangeLabel({ start: segment.srcStart, end: segment.srcEnd })})`;
    const title = firstInput?.title ?? baseName;
    // Ayrı dosyalarda boşluk yok: her klip kendi dosyası (baştan başlar).
    const groups: { clips: EditClip[]; pieces: ExportPiece[]; name: string }[] =
      separate || (baseSegments.length === 1 && !hasGaps)
        ? baseSegments.map((segment) => {
            const parts = withEffects([segment], effects);
            return {
              clips: parts.map((p) => ({ ...toEditClip(p), source: sourceIndex(p.sourceId) })),
              pieces: exportPieces(parts, false),
              name: clipName(segment),
            };
          })
        : [{ clips: ranges, pieces, name: baseName }];

    const ids = frames.flatMap((frame) => {
      const outputFrame = outputFrameOf(frame);
      // Yazılar o biçimdeki yerlerinde; yüz takibi izi o biçimin kırpma payına uyarlanır.
      const frameTexts = textsForFrame(texts, frame, options.frame);
      const frameTracks =
        framed && frame !== "original" && options.frameTrack
          ? tracksForAspect(options, outputFrame.width / outputFrame.height, sourceAspectOf)
          : null;
      const suffix = multiFormat ? ` (${frameSuffix(frame)})` : "";
      return groups.map((group) => {
        // Her grup yalnızca kendi kullandığı kaynakları gönderir: tek kaynaklı
        // grup tek girdili istek olur, arka uç hızlı (yeniden kodlamasız) yola düşer.
        const localized = localizeGroupInputs(
          group.clips,
          usedInputs,
          toClipOverlays(overlaySegs, group.pieces, sourceIndex),
        );
        const firstGroupInput = localized.inputs[0];
        const label =
          (group.clips.length === 1
            ? `${formatTimecode(group.clips[0].start, 0)}–${formatTimecode(group.clips[0].end, 0)}`
            : t("editor.jobClips", { count: group.clips.length })) +
          (multiFormat ? ` · ${frame}` : "");
        return enqueueEdit(
          {
            kind: "edit",
            inputPath: firstGroupInput?.inputPath ?? null,
            url: firstGroupInput?.url ?? null,
            inputs: localized.inputs,
            clips: localized.clips,
            destinationDir: dir,
            outputName: group.name + suffix,
            audioOnly: audio,
            outputFormat: gif ? null : format,
            maxHeight: null,
            audioBitrateKbps: options.audioBitrateKbps,
            precise: options.precise && !multiSource,
            gif: gif ? { fps: options.gifFps, width: options.gifWidth } : null,
            frame: framed
              ? frameRequest(
                  { ...options, frame },
                  sourceAspect,
                  // Yüz takibi: her dosyanın kendi parçalarına göre çıktı saniyesinde iz.
                  frameTracks
                    ? outputTrack(
                        group.pieces,
                        frameTracks,
                        (id) => (sources.find((x) => x.id === id) ?? sources[0])?.source.path,
                        options.framePosition,
                      )
                    : null,
                )
              : null,
            targetSizeMb: audio || gif ? null : options.targetSizeMb,
            // Kayıt tarafında çalıştığı doğrulanmış ekran kartı kodlayıcısı.
            gpuEncoder: !audio && !gif && options.fastExport && gpuEncoder ? gpuEncoder : null,
            // Her dosya kendi parçalarına göre: yazının çıktıdaki zamanı ona göre.
            texts: audio ? [] : toOverlays(frameTexts, group.pieces),
            assScript: audio ? null : buildAss(frameTexts, group.pieces, outputFrame),
            images: audio
              ? []
              : [
                  ...toImageOverlays(images, group.pieces),
                  ...emojiOverlays(frameTexts, group.pieces, outputFrame, emojiFiles),
                ],
            music: gif ? [] : toMusicTracks(audibleMusic(music, tracks), group.pieces),
            blurs: audio ? [] : toBlurRegions(blurs, group.pieces),
            progress: audio ? null : options.progressBar,
            overlays: localized.overlays,
            loudness: gif || !options.loudness ? null : SOCIAL_LUFS,
          },
          {
            title: (group.clips.length === 1 && groups.length > 1 ? group.name : title) + suffix,
            thumbnailUrl: null,
            formatLabel: `${(format ?? (options.precise || multiple || speedChanged || multiSource ? "mp4" : firstInput?.source.kind === "local" ? firstInput.source.info.container : "mp4")).toUpperCase()} · ${label}`,
            qualityLabel,
            totalBytesEstimate: null,
          },
        );
      });
    });
    setLastJobIds(ids);
    // İstenirse altyazı dosyası da videonun yanına (aynı adla).
    if (options.subtitleFile && !gif && texts.some((x) => x.text.trim())) {
      void writeSideSrt(dir, baseName).catch(() => {});
    }
  }

  return (
    <div className="space-y-4" data-tour="editor-export">
      {hasVideo ? <ExportPresets /> : null}
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
          {framed ? <MultiFormatRow /> : null}
          {framed ? <FrameLayouts sourceAspect={sourceAspect} /> : null}
        </div>
      ) : null}

      {!audio && !gif ? <FastExportRow gpu={gpuEncoder} /> : null}
      {!gif ? <LoudnessRow /> : null}
      <ShareCheck />
      {!gif && texts.some((x) => x.text.trim()) ? (
        <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--dk-border)] bg-[var(--dk-bg)]/40 px-3 py-2.5">
          <span className="min-w-0">
            <span className="block text-sm">{t("editor.subtitleFile")}</span>
            <span className="block text-[11px] text-[var(--dk-text-muted)]">
              {t("editor.subtitleFileHint")}
            </span>
          </span>
          <Switch
            checked={options.subtitleFile}
            label={t("editor.subtitleFile")}
            onChange={(subtitleFile) => setOptions({ subtitleFile })}
          />
        </label>
      ) : null}

      {!multiSource &&
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

      {multiSource && !audio && !gif ? (
        <p className="text-xs text-[var(--dk-text-muted)]">{t("editor.preciseMultiHint")}</p>
      ) : null}

      {multiple ? (
        <label className="flex items-center gap-3 rounded-xl border border-[var(--dk-border)] bg-[var(--dk-bg)]/40 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{t("editor.mergeClips")}</p>
            <p className="text-xs text-[var(--dk-text-muted)]">
              {options.merge
                ? t("editor.mergeOn", { count: baseSegments.length })
                : t("editor.mergeOff", { count: baseSegments.length })}
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
                count: baseSegments.length,
                total: formatTimecode(total, 1),
              })}
          {estimate ? (
            <span className="text-[var(--dk-text-muted)]"> · ~{formatBytes(estimate)}</span>
          ) : null}
        </p>
        {hasGaps && ranges.length > 0 ? (
          <p className="text-xs text-[var(--dk-text-muted)]">{t("editor.gapsSkipped")}</p>
        ) : null}
        {multiSource ? (
          <p className="text-xs text-[var(--dk-text-muted)]">{t("editor.multiSourceHint")}</p>
        ) : null}
        <Button
          size="lg"
          className="w-full"
          disabled={ranges.length === 0}
          icon={<FileOutput size={18} />}
          onClick={() => void start()}
        >
          {multiFormat
            ? t("multiFormat.export", {
                count: (separate ? baseSegments.length : 1) * frames.length,
              })
            : separate
              ? t("editor.exportSeparate", { count: baseSegments.length })
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

function presetMatches(options: ExportOptions, patch: Partial<ExportOptions>): boolean {
  return (Object.keys(patch) as (keyof ExportOptions)[]).every((k) => options[k] === patch[k]);
}

/** Tek tıkla platforma uygun ayarlar: kısa video, yatay video, 10 MB,
 * akış (4:5), 16 MB. Hepsi ücretsiz. */
function ExportPresets() {
  const { t } = useTranslation();
  const options = useEditorStore((s) => s.exportOptions);
  const setOptions = useEditorStore((s) => s.setExportOptions);
  const profiles = usePlatformProfiles((s) => s.profiles);
  useEffect(() => {
    void refreshProfiles();
  }, []);
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold tracking-wide text-[var(--dk-text-muted)] uppercase">
        {t("editor.presetTitle")}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {profiles.map((p) => {
          const patch: Partial<ExportOptions> = { output: "video", videoFormat: "mp4", ...p.patch };
          const on = presetMatches(options, patch);
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={on}
              title={t(`editor.presetHint.${p.id}`, { defaultValue: p.name ?? p.id })}
              onClick={() => setOptions(patch)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                on
                  ? "dk-selected bg-[var(--dk-accent)] text-white"
                  : "border-[var(--dk-border-strong)] hover:border-[var(--dk-accent)]"
              }`}
            >
              {t(`editor.presetName.${p.id}`, { defaultValue: p.name ?? p.id })}
            </button>
          );
        })}
      </div>
      {options.targetSizeMb && options.output === "video" ? (
        <p className="flex items-center gap-2 text-xs text-[var(--dk-text-muted)]">
          {t("editor.targetSize", { size: options.targetSizeMb })}
          <button
            type="button"
            onClick={() => setOptions({ targetSizeMb: null })}
            className="underline hover:text-[var(--dk-text)]"
          >
            {t("editor.targetSizeOff")}
          </button>
        </p>
      ) : null}
    </div>
  );
}

/** Sosyal medya ses seviyesi: karışım −14 LUFS'e çekilir, tepeler sınırlanır. */
function LoudnessRow() {
  const { t } = useTranslation();
  const loudness = useEditorStore((s) => s.exportOptions.loudness);
  const setOptions = useEditorStore((s) => s.setExportOptions);
  return (
    <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--dk-border)] bg-[var(--dk-bg)]/40 px-3 py-2.5">
      <span className="min-w-0">
        <span className="block text-sm">{t("audioFx.loudness")}</span>
        <span className="block text-[11px] text-[var(--dk-text-muted)]">
          {t("audioFx.loudnessHint")}
        </span>
      </span>
      <Switch
        checked={loudness}
        label={t("audioFx.loudness")}
        onChange={(on) => setOptions({ loudness: on })}
      />
    </label>
  );
}

/** Dışa aktarımı ekran kartının kodlayıcısıyla yapar (genelde 3 kat hızlı). */
function FastExportRow({ gpu }: { gpu: string | null }) {
  const { t } = useTranslation();
  const fastExport = useEditorStore((s) => s.exportOptions.fastExport);
  const setOptions = useEditorStore((s) => s.setExportOptions);
  return (
    <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--dk-border)] bg-[var(--dk-bg)]/40 px-3 py-2.5">
      <span className="min-w-0">
        <span className="block text-sm">{t("editor.fastExport")}</span>
        <span className="block text-[11px] text-[var(--dk-text-muted)]">
          {gpu ? t("editor.fastExportHint") : t("editor.fastExportNoGpu")}
        </span>
      </span>
      <Switch
        checked={fastExport && !!gpu}
        disabled={!gpu}
        label={t("editor.fastExport")}
        onChange={(on) => setOptions({ fastExport: on })}
      />
    </label>
  );
}

/** Kamera + oyun: kameranın payı ve yeri. Bölgeler önizlemede sürüklenerek seçilir. */
