import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Play, VideoOff, X } from "lucide-react";
import { Button } from "./ui/Button";
import { formatClock, type TimeRange } from "../lib/timeRange";

interface PreviewModalProps {
  title: string;
  previewUrl: string | null;
  posterUrl: string | null;
  onOpenOriginal: () => void;
  onClose: () => void;
  /** Verilirse video altında bölüm işaretleme şeridi gösterilir. */
  section?: TimeRange | null;
  onMark?: (edge: "start" | "end", seconds: number) => void;
}

// Platformun doğrudan akış adresi uygulama içinde oynatılabiliyorsa onu gösterir;
// oynatılamazsa (erişim kısıtı vb.) dürüstçe kaynağı açmayı önerir.
export function PreviewModal({
  title,
  previewUrl,
  posterUrl,
  onOpenOriginal,
  onClose,
  section = null,
  onMark,
}: PreviewModalProps) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(previewUrl === null);
  const videoRef = useRef<HTMLVideoElement>(null);

  function mark(edge: "start" | "end") {
    const video = videoRef.current;
    if (video && onMark) onMark(edge, video.currentTime);
  }

  function playSection() {
    const video = videoRef.current;
    if (!video || !section) return;
    video.currentTime = section.start;
    void video.play();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dk-card w-full max-w-4xl overflow-hidden">
        <div className="flex items-center gap-3 border-b border-[var(--dk-border)] px-5 py-3">
          <p className="min-w-0 flex-1 truncate font-medium">{title}</p>
          <Button
            variant="ghost"
            size="sm"
            icon={<ExternalLink size={15} />}
            onClick={onOpenOriginal}
          >
            {t("media.openSource")}
          </Button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("media.close")}
            className="rounded-lg p-1.5 text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>
        {failed || !previewUrl ? (
          <div className="flex aspect-video flex-col items-center justify-center gap-3 bg-black/50 text-center">
            <VideoOff size={36} className="text-[var(--dk-text-muted)]" />
            <p className="max-w-sm text-sm text-[var(--dk-text-muted)]">
              {t("media.previewUnavailable")}
            </p>
            <Button variant="secondary" icon={<ExternalLink size={16} />} onClick={onOpenOriginal}>
              {t("media.openSource")}
            </Button>
          </div>
        ) : (
          <video
            ref={videoRef}
            src={previewUrl}
            poster={posterUrl ?? undefined}
            controls
            autoPlay
            onError={() => setFailed(true)}
            onTimeUpdate={(e) => {
              // Seçili bölüm oynatılırken bitişte durur; sahneyi kontrol etmek kolaylaşır.
              if (section && e.currentTarget.currentTime >= section.end) e.currentTarget.pause();
            }}
            className="aspect-video w-full bg-black"
          />
        )}
        {onMark && !failed && previewUrl ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--dk-border)] px-5 py-3">
            <p className="mr-auto text-xs text-[var(--dk-text-muted)]">{t("section.markHint")}</p>
            <Button size="sm" variant="secondary" onClick={() => mark("start")}>
              {t("section.markStart")}
              {section ? ` (${formatClock(section.start)})` : ""}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => mark("end")}>
              {t("section.markEnd")}
              {section ? ` (${formatClock(section.end)})` : ""}
            </Button>
            {section ? (
              <Button size="sm" icon={<Play size={14} />} onClick={playSection}>
                {t("section.playSection")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
