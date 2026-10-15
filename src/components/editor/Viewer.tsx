import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Grid3x3,
  Loader2,
  Maximize2,
  RefreshCw,
  Smartphone,
  SplitSquareHorizontal,
  StepBack,
  StepForward,
  VideoOff,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { usePlayerStore } from "../../store/playerStore";
import {
  applyVolume,
  onSourceTime,
  playerReady,
  setPreviewRate,
  togglePlayback,
} from "../../lib/sequencePlayer";
import { stepFrame } from "../../lib/editorActions";
import { createPreviewCopy, onPreviewCopyProgress } from "../../lib/tauri-api";
import { localizeError } from "../../lib/errors";
import { formatTimecode } from "../../lib/timeline";
import { lookCss } from "../../lib/clipLook";
import { LookFxLayer } from "./LookFxLayer";
import { GradeFilter } from "./GradeFilter";
import { usePreviewTools } from "../../lib/editorPanel";
import { togglePanel, useWorkspaceStore } from "../../lib/workspaces";
import { MediaPlayer } from "./MediaPlayer";
import { CropOverlay } from "./CropOverlay";
import { SplitOverlay } from "./SplitOverlay";
import { TextLayer } from "./TextLayer";
import { BlurOverlay } from "./BlurOverlay";
import { MusicPreview } from "./MusicPreview";
import { XfadeMain, XfadeOverlay } from "./XfadePreview";
import { ClipCanvas, OverlayClips, TransformBox, ZoomBox } from "./TransformPreview";
import { CompareOverlay, GridOverlay, LevelMeter } from "./PreviewTools";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";

// Video paneli: önizleme oynatıcısı (yazılar, kırpma / kamera kutuları, karşılaştırma)
// ve altındaki oynatma çubuğu.

export function PlayerArea() {
  const { t } = useTranslation();
  const source = useEditorStore((s) => s.source);
  const stream = useEditorStore((s) => s.stream);
  const replaceStream = useEditorStore((s) => s.replaceStream);
  const inGap = usePlayerStore((s) => s.inGap);
  const gapPlaying = usePlayerStore((s) => s.gapPlaying);
  const clipOpacity = usePlayerStore((s) => s.clipOpacity);
  const clipFadeWhite = usePlayerStore((s) => s.clipFadeWhite);
  const clipLook = usePlayerStore((s) => s.clipLook);
  const look = lookCss(clipLook);
  const clipFx = usePlayerStore((s) => s.clipFx);
  const frameAspect = useEditorStore((s) => s.exportOptions.frame);
  const output = useEditorStore((s) => s.exportOptions.output);
  // Dikey/kare çerçeve seçiliyken İndir sekmesinde kalacak bölge gösterilir.
  const sourceAspect = (() => {
    const w = source?.info.width;
    const h = source?.info.height;
    return w && h ? w / h : 16 / 9;
  })();
  // Dikey/kare çerçeve seçiliyse kalacak bölge önizlemede hep görünür: dışa aktarma
  // penceresi kapanınca sürüklenerek konumlandırılır.
  const showCrop = frameAspect !== "original" && output !== "audio";
  const setApi = usePlayerStore((s) => s.setApi);
  const patch = usePlayerStore((s) => s.patch);
  const [failed, setFailed] = useState(false);
  const [copy, setCopy] = useState<{ percent: number | null; error: string | null } | null>(null);

  // Akış değişince (kaynak geçişi, yeniden deneme) hata durumu sıfırlanır.
  // (Bileşen zaten token'a göre yeniden kurulur; bu, ek güvencedir. Effect yerine
  // render sırasında önceki token'la karşılaştırılarak yapılır: React'in önerdiği
  // "derived state" düzenidir.)
  const [failedToken, setFailedToken] = useState(stream?.token);
  if (failedToken !== stream?.token) {
    setFailedToken(stream?.token);
    setFailed(false);
  }

  // Oynatıcı değişince ses ayarları yeni öğeye de uygulanır.
  useEffect(() => {
    const { api, muted } = usePlayerStore.getState();
    applyVolume();
    api?.setMuted(muted);
  });

  async function makeCopy() {
    if (!stream) return;
    setCopy({ percent: null, error: null });
    const unlisten = await onPreviewCopyProgress((p) => {
      if (p.token === stream.token) setCopy({ percent: p.percent, error: null });
    });
    try {
      const result = await createPreviewCopy(stream.token);
      replaceStream({ ...stream, url: result.url, token: result.token, kind: "file" });
    } catch (err) {
      setCopy({ percent: null, error: localizeError(err, "editor.copyFailed").message });
    } finally {
      unlisten();
    }
  }

  const poster: string | null = null;
  const frame = "relative min-h-0 flex-1 overflow-hidden bg-black";

  if (!stream || failed) {
    return (
      <div className={`${frame} flex flex-col items-center justify-center gap-3 p-6 text-center`}>
        <VideoOff size={36} className="text-[var(--dk-text-muted)]" />
        {source ? (
          copy ? (
            copy.error ? (
              <p className="text-sm text-[var(--dk-error)]">{copy.error}</p>
            ) : (
              <p className="flex items-center gap-2 text-sm text-[var(--dk-text-muted)]">
                <Loader2 size={16} className="animate-spin" />
                {t("editor.copyProgress", {
                  percent: copy.percent === null ? "…" : Math.round(copy.percent),
                })}
              </p>
            )
          ) : (
            <>
              <p className="max-w-md text-sm text-[var(--dk-text-muted)]">
                {t("editor.localUnplayable")}
              </p>
              <Button icon={<RefreshCw size={16} />} onClick={() => void makeCopy()}>
                {t("editor.makeCopy")}
              </Button>
            </>
          )
        ) : (
          <>
            <p className="max-w-md text-sm text-[var(--dk-text-muted)]">{t("editor.noPreview")}</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={frame} onClick={togglePlayback} data-main-viewer>
      <GradeFilter id="ck-grade-main" grade={inGap ? undefined : clipLook?.grade} />
      {/* Klibin filtresi, renk ayarı ve efektleri önizlemede CSS ile gösterilir. */}
      {/* Hareket ve geçiş stili (yakınlaştır, kaydır, döndür…) ayrı katmanda: dışa
          aktarımdaki FFmpeg ifadesiyle aynı formül (lib/clipFx). */}
      {/* Klipler arası geçiş: ana oynatıcı ve öbür klibin ikinci videosu kendi
          katmanında (isolate), yazılar ve kırpma çerçevesi her zaman üstte kalır. */}
      <div className="absolute inset-0 isolate">
        <XfadeMain>
          <ClipCanvas aspect={sourceAspect}>
            <div
              className="absolute inset-0"
              style={
                clipFx && !inGap
                  ? {
                      transform: clipFx.transform || undefined,
                      transformOrigin: clipFx.transformOrigin,
                      filter: clipFx.filter || undefined,
                    }
                  : undefined
              }
            >
              <LookFxLayer fx={inGap ? undefined : clipLook?.fx}>
                <div
                  className="absolute inset-0"
                  style={{
                    filter:
                      [look.filter, !inGap && clipLook?.grade ? "url(#ck-grade-main)" : ""]
                        .filter(Boolean)
                        .join(" ") || undefined,
                    transform: look.transform || undefined,
                  }}
                >
                  <MediaPlayer
                    stream={stream}
                    poster={poster}
                    className="h-full w-full"
                    onApi={(api) => {
                      setApi(api);
                      if (api) playerReady();
                    }}
                    onTime={onSourceTime}
                    onPlayingChange={(playing) => patch({ playing })}
                    onWaitingChange={(waiting) => patch({ waiting })}
                    onError={() => setFailed(true)}
                  />
                </div>
              </LookFxLayer>
            </div>
          </ClipCanvas>
        </XfadeMain>
        <XfadeOverlay />
        {/* Üst izden bindirilen dönüşümlü klipler (resim içinde resim). */}
        {stream?.hasVideo ? <OverlayClips aspect={sourceAspect} /> : null}
      </div>
      {/* Klibin açılma/kararma geçişi önizlemede siyah örtüyle gösterilir. */}
      {!inGap && look.vignette ? (
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgb(0_0_0/65%)_100%)]" />
      ) : null}
      {!inGap && clipOpacity < 1 ? (
        <div
          className={`pointer-events-none absolute inset-0 ${clipFadeWhite ? "bg-white" : "bg-black"}`}
          style={{ opacity: 1 - clipOpacity }}
        />
      ) : null}
      {/* Boşluk dışa aktarımda siyah ekran: önizlemede de öyle. Açıklama yalnızca
          dururken görünür, oynarken ekran düz siyahtır. */}
      {inGap ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black text-center">
          {gapPlaying ? null : (
            <p className="max-w-xs text-sm text-[var(--dk-text-muted)]">{t("editor.gapPreview")}</p>
          )}
        </div>
      ) : null}
      {/* Yazılar boşluğun üstünde de görünür (dışa aktarımda siyah zemine yazılır). */}
      {stream?.hasVideo && !inGap ? <CompareOverlay sourceAspect={sourceAspect} /> : null}
      {stream?.hasVideo ? <TextLayer sourceAspect={sourceAspect} /> : null}
      {stream?.hasVideo ? <GridOverlay sourceAspect={sourceAspect} /> : null}
      <MusicPreview />
      {showCrop && stream?.hasVideo ? (
        <>
          <CropOverlay sourceAspect={sourceAspect} />
          <SplitOverlay sourceAspect={sourceAspect} />
        </>
      ) : null}
      {stream?.hasVideo ? <BlurOverlay sourceAspect={sourceAspect} /> : null}
      {stream?.hasVideo ? <TransformBox aspect={sourceAspect} /> : null}
      {stream?.hasVideo ? <ZoomBox aspect={sourceAspect} /> : null}
    </div>
  );
}

const PREVIEW_RATES = [0.5, 1, 1.5, 2];

export function PlayerBar() {
  const grid = usePreviewTools((s) => s.grid);
  const compare = usePreviewTools((s) => s.compare);
  const setTools = usePreviewTools((s) => s.set);
  const fps = useEditorStore((s) => s.source?.info.fps ?? null);
  const phoneOpen = useWorkspaceStore((s) => s.open.includes("phone"));
  const { t } = useTranslation();
  const currentTime = usePlayerStore((s) => s.currentTime);
  const waiting = usePlayerStore((s) => s.waiting);
  const playing = usePlayerStore((s) => s.playing || s.gapPlaying);
  const rate = usePlayerStore((s) => s.rate);
  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);
  const api = usePlayerStore((s) => s.api);
  const patch = usePlayerStore((s) => s.patch);
  const barRef = useRef<HTMLDivElement>(null);

  function fullscreen() {
    const player = barRef.current?.parentElement;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void player?.requestFullscreen?.();
  }

  return (
    <div
      ref={barRef}
      className="@container flex items-center gap-2 overflow-hidden border-t border-[var(--dk-border)] bg-[var(--dk-surface)] px-2 py-1"
    >
      <span className="flex items-center gap-0.5">
        <button
          type="button"
          title={`${t("editor.prevFrame")} (,)`}
          aria-label={t("editor.prevFrame")}
          onClick={() => stepFrame(-1, fps)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-[var(--dk-text)]"
        >
          <StepBack size={15} />
        </button>
        <p className="font-mono text-xs tabular-nums">{formatTimecode(currentTime)}</p>
        <button
          type="button"
          title={`${t("editor.nextFrame")} (.)`}
          aria-label={t("editor.nextFrame")}
          onClick={() => stepFrame(1, fps)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-[var(--dk-text)]"
        >
          <StepForward size={15} />
        </button>
      </span>
      {waiting && playing ? (
        <span className="text-xs text-[var(--dk-text-muted)]">{t("editor.buffering")}</span>
      ) : null}
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          aria-pressed={grid}
          title={t("editor.gridToggle")}
          aria-label={t("editor.gridToggle")}
          onClick={() => setTools({ grid: !grid })}
          className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${
            grid
              ? "bg-[var(--dk-accent)]/20 text-[var(--dk-accent-hover)]"
              : "text-[var(--dk-text-muted)] hover:text-[var(--dk-text)]"
          }`}
        >
          <Grid3x3 size={16} />
        </button>
        <button
          type="button"
          aria-pressed={compare}
          title={t("editor.compareToggle")}
          aria-label={t("editor.compareToggle")}
          onClick={() => setTools({ compare: !compare })}
          className={`inline-flex h-8 w-8 @max-[420px]:hidden items-center justify-center rounded-lg ${
            compare
              ? "bg-[var(--dk-accent)]/20 text-[var(--dk-accent-hover)]"
              : "text-[var(--dk-text-muted)] hover:text-[var(--dk-text)]"
          }`}
        >
          <SplitSquareHorizontal size={16} />
        </button>
        <span className="contents @max-[560px]:hidden">
          <LevelMeter />
        </span>
        <button
          type="button"
          aria-pressed={phoneOpen}
          title={t("editor.phoneView")}
          aria-label={t("editor.phoneView")}
          onClick={() => togglePanel("phone")}
          className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs ${
            phoneOpen
              ? "bg-[var(--dk-accent)]/20 text-[var(--dk-accent-hover)]"
              : "text-[var(--dk-text-muted)] hover:text-[var(--dk-text)]"
          }`}
        >
          <Smartphone size={16} />
          <span className="hidden min-[1500px]:inline">{t("editor.phoneShort")}</span>
        </button>
        <span className="hidden text-xs whitespace-nowrap text-[var(--dk-text-muted)] min-[1600px]:inline">
          {t("editor.previewSpeed")}
        </span>
        <Select
          value={rate}
          ariaLabel={t("editor.previewSpeed")}
          className="w-20 @max-[460px]:hidden [&>button]:h-8"
          options={PREVIEW_RATES.map((r) => ({ value: r, label: `${r}×` }))}
          onChange={setPreviewRate}
        />
        <button
          type="button"
          title={muted ? t("editor.unmute") : t("editor.mute")}
          aria-label={muted ? t("editor.unmute") : t("editor.mute")}
          onClick={() => {
            api?.setMuted(!muted);
            patch({ muted: !muted });
          }}
          className="inline-flex h-8 w-8 items-center justify-center text-[var(--dk-text-muted)] hover:text-[var(--dk-text)]"
        >
          {muted || volume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          aria-label={t("editor.volume")}
          onChange={(e) => {
            const value = Number(e.target.value);
            patch({ volume: value, muted: false });
            applyVolume();
            api?.setMuted(false);
          }}
          className="dk-volume w-14 @max-[520px]:hidden min-[1500px]:w-24"
        />
        <button
          type="button"
          title={t("editor.fullscreen")}
          aria-label={t("editor.fullscreen")}
          onClick={fullscreen}
          className="inline-flex h-8 w-8 items-center justify-center text-[var(--dk-text-muted)] hover:text-[var(--dk-text)]"
        >
          <Maximize2 size={15} />
        </button>
      </div>
    </div>
  );
}
