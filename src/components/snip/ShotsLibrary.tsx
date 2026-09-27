import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, ExternalLink, FolderOpen, Images, PenLine, RefreshCw, Trash2 } from "lucide-react";
import { useSnipStore } from "../../store/snipStore";
import { deleteShot, loadShotThumb, openFile, refreshShots } from "../../lib/snipActions";
import { encodeImage } from "../../lib/imageExport";
import { formatBytes } from "../../lib/format";
import { localizeError } from "../../lib/errors";
import {
  imageCopy,
  openFolder,
  openMediaFile,
  revealInFolder,
  snipOpenFile,
} from "../../lib/tauri-api";
import type { ShotFile } from "../../types/snip";

/** Sayfada bir seferde gösterilen görüntü (fazlası "Daha fazla" ile). */
const PAGE = 24;

function Thumb({ shot }: { shot: ShotFile }) {
  const thumb = useSnipStore((s) => s.thumbs[shot.path]);
  const ref = useRef<HTMLDivElement>(null);

  // Küçük resim yalnızca kart ekrana gelince üretilir.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        void loadShotThumb(shot.path);
        observer.disconnect();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [shot.path]);

  return (
    <div
      ref={ref}
      className="dk-checker flex aspect-video items-center justify-center overflow-hidden"
    >
      {thumb ? (
        <img src={thumb} alt="" draggable={false} className="h-full w-full object-contain" />
      ) : thumb === null ? (
        <Images size={22} className="text-[var(--dk-text-muted)]" />
      ) : null}
    </div>
  );
}

/** Kayıt klasöründeki ekran görüntüleri: aç (düzenle), kopyala, klasörde göster, sil. */
export function ShotsLibrary() {
  const { t, i18n } = useTranslation();
  const shots = useSnipStore((s) => s.shots);
  const loaded = useSnipStore((s) => s.shotsLoaded);
  const outputDir = useSnipStore((s) => s.outputDir);
  const [limit, setLimit] = useState(PAGE);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void refreshShots();
  }, []);

  const copy = async (shot: ShotFile) => {
    try {
      const image = await snipOpenFile(shot.path);
      await imageCopy(await encodeImage(image.url, "png", 100));
      setStatus(t("snip.copied"));
    } catch (err) {
      setStatus(localizeError(err, "snip.copyFailed").message);
    }
  };

  const remove = async (shot: ShotFile) => {
    if (!window.confirm(t("snip.deleteConfirm", { name: shot.name }))) return;
    await deleteShot(shot.path);
  };

  return (
    <section className="dk-card space-y-4 p-5" data-tour="snip-library">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex flex-1 items-center gap-2.5 text-base font-semibold text-white">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--dk-accent)]/15 text-[var(--dk-accent-hover)]">
            <Images size={17} />
          </span>
          {t("snip.libraryTitle")}
          {shots.length > 0 ? (
            <span className="text-sm font-normal text-[var(--dk-text-muted)]">{shots.length}</span>
          ) : null}
        </h2>
        {status ? (
          <span role="status" className="text-xs text-[var(--dk-text-muted)]">
            {status}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => void refreshShots()}
          title={t("snip.refresh")}
          aria-label={t("snip.refresh")}
          className="rounded-lg p-2 text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-white"
        >
          <RefreshCw size={15} />
        </button>
        {outputDir ? (
          <button
            type="button"
            onClick={() => void openFolder(outputDir)}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--dk-border-strong)] px-2.5 py-1.5 text-xs hover:border-[var(--dk-accent)]"
          >
            <FolderOpen size={14} />
            {t("snip.openFolder")}
          </button>
        ) : null}
      </div>

      {loaded && shots.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--dk-border-strong)] px-4 py-8 text-center text-sm text-[var(--dk-text-muted)]">
          {t("snip.libraryEmpty")}
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {shots.slice(0, limit).map((shot) => (
            <li
              key={shot.path}
              className="group overflow-hidden rounded-xl border border-[var(--dk-border)] bg-[var(--dk-surface-2)]"
            >
              <button
                type="button"
                onClick={() => void openFile(shot.path)}
                title={t("snip.openInEditor")}
                className="relative block w-full"
              >
                <Thumb shot={shot} />
                <span className="absolute inset-0 flex items-center justify-center gap-1.5 bg-black/55 text-sm font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                  <PenLine size={15} />
                  {t("snip.openInEditor")}
                </span>
              </button>
              <div className="flex items-center gap-1 px-2.5 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium" title={shot.name}>
                    {shot.name}
                  </p>
                  <p className="truncate text-[11px] text-[var(--dk-text-muted)]">
                    {new Date(shot.modified).toLocaleString(i18n.language, {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    · {formatBytes(shot.bytes)}
                  </p>
                </div>
                {[
                  { icon: Copy, label: t("snip.copy"), run: () => void copy(shot) },
                  {
                    icon: ExternalLink,
                    label: t("snip.openExternal"),
                    run: () => void openMediaFile(shot.path),
                  },
                  {
                    icon: FolderOpen,
                    label: t("snip.showInFolder"),
                    run: () => void revealInFolder(shot.path),
                  },
                  { icon: Trash2, label: t("snip.delete"), run: () => void remove(shot) },
                ].map(({ icon: Icon, label, run }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={run}
                    title={label}
                    aria-label={label}
                    className="rounded-md p-1.5 text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-white"
                  >
                    <Icon size={14} />
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      {shots.length > limit ? (
        <div className="text-center">
          <button
            type="button"
            onClick={() => setLimit((n) => n + PAGE)}
            className="text-sm text-[var(--dk-accent-hover)] hover:underline"
          >
            {t("snip.showMore", { n: shots.length - limit })}
          </button>
        </div>
      ) : null}
    </section>
  );
}
