import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Film, Link2, Loader2, Music, Plus, Upload, X } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { usePlayerStore } from "../../store/playerStore";
import { appendWholeSource, SOURCE_DRAG_MIME } from "../../lib/editorActions";
import { seekTimeline } from "../../lib/sequencePlayer";
import { chooseLocalMediaFiles, readClipboardText, recordingThumbnail } from "../../lib/tauri-api";
import { useFileDrop } from "../../lib/useFileDrop";
import { checkSupportedUrl } from "../../lib/validation";
import { formatDuration } from "../../lib/format";
import { PLATFORM_LABEL, isSupportedPlatform } from "../../lib/platforms";
import { UrlBar } from "../UrlBar";
import { ErrorBanner } from "../ErrorBanner";
import { PlatformIcon } from "../PlatformIcon";
import { Button } from "../ui/Button";

/** Clipchamp'taki "Medyam" paneli: projeye eklenen video/linkler küçük
 * resimli kartlar hâlinde listelenir. Birden çok dosya aynı anda seçilebilir
 * ya da pencereye sürüklenip bırakılabilir; kart tıklanınca önizleme o
 * kaynağa geçer, artı düğmesiyle ya da zaman çizelgesine sürüklenerek
 * kaynağın tamamı kliplere eklenir. */
export function MediaPanel() {
  const { t } = useTranslation();
  const sources = useEditorStore((s) => s.sources);
  const adding = useEditorStore((s) => s.addingSource);
  const addError = useEditorStore((s) => s.addError);
  const [url, setUrl] = useState("");
  const [hovering, setHovering] = useState(false);
  const [rejected, setRejected] = useState(false);
  const check = checkSupportedUrl(url);

  // Birden çok dosya: sırayla eklenir (her biri probe edilir).
  const importFiles = useCallback(async (paths: string[]) => {
    for (const path of paths) {
      await useEditorStore.getState().addSourceFile(path);
    }
  }, []);
  const onFiles = useCallback(
    (paths: string[]) => {
      setRejected(false);
      void importFiles(paths);
    },
    [importFiles],
  );
  const onRejected = useCallback(() => setRejected(true), []);
  useFileDrop(useCallback(() => {}, []), { onFiles, onHover: setHovering, onRejected });

  async function choose() {
    const paths = await chooseLocalMediaFiles();
    if (paths.length > 0) void importFiles(paths);
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold text-white">{t("editor.mediaTitle")}</h2>
        <p className="mt-0.5 text-xs text-[var(--dk-text-muted)]">{t("editor.mediaHint")}</p>
      </div>

      {addError ? (
        <ErrorBanner
          message={addError.message}
          detail={addError.detail}
          onDismiss={() => useEditorStore.setState({ addError: null })}
        />
      ) : null}

      <Button
        className="w-full"
        icon={adding ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
        disabled={adding}
        onClick={() => void choose()}
      >
        {t("editor.mediaImport")}
      </Button>

      <UrlBar
        value={url}
        onChange={setUrl}
        onAnalyze={() => {
          const link = url.trim();
          setUrl("");
          void useEditorStore.getState().addSourceUrl(link);
        }}
        onPaste={async () => {
          const text = await readClipboardText();
          if (text) setUrl(text.trim());
        }}
        canAnalyze={check.status === "ok"}
        isAnalyzing={adding}
        actionLabel={t("editor.addSource")}
        actionIcon={<Link2 size={16} />}
      />
      {check.status === "invalid" || check.status === "unsupported" ? (
        <p className="text-xs text-[var(--dk-warning)]">
          {check.status === "invalid" ? t("validation.invalid") : t("validation.unsupported")}
        </p>
      ) : null}

      <div
        className={`grid min-h-24 flex-1 content-start gap-2 rounded-xl border-2 border-dashed p-2 transition-colors ${
          hovering
            ? "border-[var(--dk-accent)] bg-[var(--dk-accent)]/10"
            : "border-[var(--dk-border)]"
        }`}
      >
        <div className="col-span-2 grid grid-cols-2 gap-2">
          {sources.map((entry, index) => (
            <SourceCard key={entry.id} entry={entry} index={index} />
          ))}
        </div>
        <p className="col-span-2 px-1 pt-1 text-center text-xs text-[var(--dk-text-muted)]">
          {hovering ? t("drop.release") : t("editor.mediaDropHint")}
        </p>
        {rejected ? (
          <p className="col-span-2 text-center text-xs text-[var(--dk-warning)]">
            {t("drop.rejected")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Tek kaynak kartı: küçük resim + süre rozeti + ad; tıkla → önizleme ona
 * geçer, artı → tamamı zaman çizelgesinin sonuna eklenir, çarpı → kaldır.
 * Kart tutulup zaman çizelgesine sürüklenebilir. */
function SourceCard({
  entry,
  index,
}: {
  entry: ReturnType<typeof useEditorStore.getState>["sources"][number];
  index: number;
}) {
  const { t } = useTranslation();
  const activeId = useEditorStore((s) => s.activeSourceId);
  const clips = useEditorStore((s) => s.clips);
  const sources = useEditorStore((s) => s.sources);
  const activateSource = useEditorStore((s) => s.activateSource);
  const removeSource = useEditorStore((s) => s.removeSource);
  const [confirm, setConfirm] = useState(false);
  const [localThumb, setLocalThumb] = useState<string | null>(null);

  const local = entry.source.kind === "local";
  const hasVideo = entry.source.kind === "local" ? entry.source.info.videoCodec !== null : true;
  const clipCount = clips.filter((c) => (c.sourceId ?? sources[0]?.id) === entry.id).length;
  const active = entry.id === activeId;

  // Yerel dosyaların küçük resmi ffmpeg ile üretilir (kayıt kitaplığıyla aynı yol).
  useEffect(() => {
    if (!local || localThumb) return;
    let alive = true;
    recordingThumbnail(entry.source.kind === "local" ? entry.source.path : "")
      .then((url) => {
        if (alive && url) setLocalThumb(url);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [local, localThumb, entry.source]);

  const thumb = entry.thumbnailUrl ?? localThumb;

  function jumpTo() {
    const first = clips
      .filter((c) => (c.sourceId ?? sources[0]?.id) === entry.id)
      .sort((a, b) => a.start - b.start || a.track - b.track)[0];
    if (first) {
      seekTimeline(first.start);
    } else {
      // Klibi kalmamış kaynak: yalnızca önizlemeyi ona çevir.
      activateSource(entry.id);
      usePlayerStore.getState().patch({ currentTime: 0, inGap: true });
      usePlayerStore.getState().api?.seek(0);
    }
  }

  if (confirm) {
    return (
      <div className="col-span-1 flex flex-col items-center justify-center gap-1.5 rounded-lg border border-[var(--dk-error)]/60 bg-[var(--dk-surface)] p-2 text-center">
        <p className="text-[11px] leading-tight text-white">
          {t("editor.removeSourceConfirm", { count: clipCount })}
        </p>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setConfirm(false)}
            className="rounded-md px-2 py-1 text-[11px] text-[var(--dk-text-muted)] hover:bg-white/10"
          >
            {t("history.cancelClear")}
          </button>
          <button
            type="button"
            onClick={() => removeSource(entry.id)}
            className="rounded-md bg-[var(--dk-error)]/20 px-2 py-1 text-[11px] text-[var(--dk-error)] hover:bg-[var(--dk-error)]/30"
          >
            {t("editor.removeSource")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group min-w-0">
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(SOURCE_DRAG_MIME, entry.id);
          e.dataTransfer.effectAllowed = "copy";
        }}
        onClick={jumpTo}
        title={t("editor.mediaCardHint")}
        className={`relative aspect-video w-full cursor-grab overflow-hidden rounded-lg border bg-black transition-colors active:cursor-grabbing ${
          active
            ? "border-[var(--dk-accent)]"
            : "border-[var(--dk-border)] group-hover:border-[var(--dk-border-strong)]"
        }`}
      >
        {thumb ? (
          <img
            src={thumb}
            alt=""
            draggable={false}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[var(--dk-text-muted)]">
            {hasVideo ? <Film size={22} /> : <Music size={22} />}
          </span>
        )}
        {/* Kaynak numarası: zaman çizelgesindeki klip rozetleriyle aynı. */}
        <span className="absolute top-1 left-1 flex h-4 min-w-4 items-center justify-center rounded bg-black/70 px-1 font-mono text-[10px] text-white">
          {index + 1}
        </span>
        <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 font-mono text-[10px] text-white">
          {formatDuration(entry.duration)}
        </span>
        {!local && isSupportedPlatform(entry.platform) ? (
          <span
            className="absolute right-1 bottom-1 text-white/80"
            title={PLATFORM_LABEL[entry.platform]}
          >
            <PlatformIcon platform={entry.platform} size={12} />
          </span>
        ) : null}
        {/* Üzerine gelince: ekle / kaldır düğmeleri. */}
        <span className="absolute top-1 right-1 hidden gap-1 group-hover:flex">
          <button
            type="button"
            title={t("editor.appendToTimeline")}
            aria-label={t("editor.appendToTimeline")}
            onClick={(e) => {
              e.stopPropagation();
              appendWholeSource(entry.id);
            }}
            className="rounded bg-black/70 p-1 text-white hover:bg-[var(--dk-accent)]"
          >
            <Plus size={12} />
          </button>
          <button
            type="button"
            title={t("editor.removeSource")}
            aria-label={t("editor.removeSource")}
            onClick={(e) => {
              e.stopPropagation();
              // Klipleri varsa önce sorulur; emek yanlışlıkla kaybolmasın.
              if (clipCount > 0) setConfirm(true);
              else removeSource(entry.id);
            }}
            className="rounded bg-black/70 p-1 text-white hover:bg-[var(--dk-error)]"
          >
            <X size={12} />
          </button>
        </span>
      </div>
      <p className="mt-1 truncate text-[11px] text-[var(--dk-text-muted)]" title={entry.title}>
        {entry.title}
      </p>
    </div>
  );
}
