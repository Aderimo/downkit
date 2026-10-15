import { useCallback, useEffect, useState } from "react";
import { HelpTip } from "../ui/HelpTip";
import { useTranslation } from "react-i18next";
import { Film, Loader2, Music, Plus, Upload, X } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { usePlayerStore } from "../../store/playerStore";
import { appendWholeSource, SOURCE_DRAG_MIME } from "../../lib/editorActions";
import { seekTimeline } from "../../lib/sequencePlayer";
import { chooseLocalMediaFiles, recordingThumbnail } from "../../lib/tauri-api";
import { useEditorDrop } from "../../lib/editorDrop";
import { formatDuration } from "../../lib/format";
import { ErrorBanner } from "../ErrorBanner";
import { Button } from "../ui/Button";
import { pointerDrag } from "../../lib/pointerDrag";

/** "Medyam" paneli: projeye eklenen videolar küçük
 * resimli kartlar hâlinde listelenir. Birden çok dosya aynı anda seçilebilir
 * ya da pencereye sürüklenip bırakılabilir; kart tıklanınca önizleme o
 * kaynağa geçer, artı düğmesiyle ya da zaman çizelgesine sürüklenerek
 * kaynağın tamamı kliplere eklenir. */
export function MediaPanel() {
  const { t } = useTranslation();
  const sources = useEditorStore((s) => s.sources);
  const adding = useEditorStore((s) => s.addingSource);
  const addError = useEditorStore((s) => s.addError);
  // Pencereye bırakma düzenleyicinin tamamında dinlenir (bkz. editorDrop.ts).
  const hovering = useEditorDrop((s) => s.hovering);
  const [query, setQuery] = useState("");
  const dropMessage = useEditorDrop((s) => s.message);

  // Birden çok dosya: sırayla eklenir (her biri probe edilir).
  const importFiles = useCallback(async (paths: string[]) => {
    for (const path of paths) {
      await useEditorStore.getState().addSourceFile(path);
    }
  }, []);

  async function choose() {
    const paths = await chooseLocalMediaFiles();
    if (paths.length > 0) void importFiles(paths);
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-1.5">
        <h2 className="text-sm font-semibold text-white">{t("editor.mediaTitle")}</h2>
        <HelpTip
          title={t("editor.mediaTitle")}
          text={`${t("editor.mediaHint")}\n\n${t("editor.mediaDropHint")}`}
        />
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

      <div
        className={`grid min-h-24 flex-1 content-start gap-2 rounded-xl border-2 border-dashed p-2 transition-colors ${
          hovering
            ? "border-[var(--dk-accent)] bg-[var(--dk-accent)]/10"
            : "border-[var(--dk-border)]"
        }`}
      >
        {sources.length > 4 ? (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("editor.mediaSearch")}
            aria-label={t("editor.mediaSearch")}
            className="col-span-2 h-8 rounded-lg border border-[var(--dk-border)] bg-[var(--dk-surface-2)] px-2.5 text-xs outline-none focus:border-[var(--dk-accent)]"
          />
        ) : null}
        <div className="col-span-2 grid grid-cols-2 gap-2">
          {sources.map((entry, index) =>
            !query.trim() ||
            entry.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) ? (
              <SourceCard key={entry.id} entry={entry} index={index} />
            ) : null,
          )}
        </div>
        {hovering ? (
          <p className="col-span-2 px-1 pt-1 text-center text-xs text-[var(--dk-accent-hover)]">
            {t("drop.release")}
          </p>
        ) : null}
        {dropMessage ? (
          <p className="col-span-2 text-center text-xs text-[var(--dk-warning)]">{dropMessage}</p>
        ) : null}
      </div>
    </div>
  );
}

/** Tek kaynak kartı: küçük resim + süre rozeti + ad; tıkla → önizleme ona
 * geçer, artı → tamamı zaman çizelgesinin sonuna eklenir, çarpı → kaldır.
 * Kart tutulup zaman çizelgesine sürüklenebilir. */

// Yerel dosya küçük resimleri dosya yoluna göre modül düzeyinde önbelleklenir:
// kart yeniden kurulunca ya da aynı dosya tekrar eklenince ffmpeg yeniden
// çalışmaz. `null` = "küçük resmi yok" (tekrar denenmez).
const localThumbCache = new Map<string, string | null>();
const localThumbPending = new Set<string>();

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

  const path = entry.source.path;
  const [localThumb, setLocalThumb] = useState<string | null>(
    path ? (localThumbCache.get(path) ?? null) : null,
  );
  const hasVideo = entry.source.info.videoCodec !== null;
  const clipCount = clips.filter((c) => (c.sourceId ?? sources[0]?.id) === entry.id).length;
  const active = entry.id === activeId;
  const resolution = resolutionLabel(entry.source.info.width, entry.source.info.height);

  // Yerel dosyaların küçük resmi ffmpeg ile üretilir (kayıt kitaplığıyla aynı yol).
  useEffect(() => {
    if (!path || localThumbCache.has(path) || localThumbPending.has(path)) return;
    localThumbPending.add(path);
    let alive = true;
    recordingThumbnail(path)
      .then((url) => {
        localThumbCache.set(path, url);
        if (alive && url) setLocalThumb(url);
      })
      .catch(() => {})
      .finally(() => localThumbPending.delete(path));
    return () => {
      alive = false;
    };
  }, [path]);

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
        {...pointerDrag(SOURCE_DRAG_MIME, entry.id, entry.title)}
        onClick={jumpTo}
        title={t("editor.mediaCardHint")}
        data-unused={clipCount === 0 || undefined}
        className={`relative aspect-video w-full cursor-grab overflow-hidden rounded-lg border bg-black transition-colors active:cursor-grabbing ${
          clipCount === 0 ? "opacity-60" : ""
        } ${
          active
            ? "border-[var(--dk-accent)]"
            : "border-[var(--dk-border)] group-hover:border-[var(--dk-border-strong)]"
        }`}
      >
        {thumb ? (
          <img src={thumb} alt="" draggable={false} className="h-full w-full object-cover" />
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
        {resolution ? (
          <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 font-mono text-[10px] text-white/85">
            {resolution}
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

/** Kısa çözünürlük adı: 720p, 1080p, 1440p, 4K (dikey videoda kısa kenara göre). */
function resolutionLabel(width: number | null, height: number | null): string | null {
  if (!width || !height) return null;
  const short = Math.min(width, height);
  if (short >= 2100) return "4K";
  if (short >= 1400) return "1440p";
  if (short >= 1000) return "1080p";
  if (short >= 700) return "720p";
  return `${short}p`;
}
