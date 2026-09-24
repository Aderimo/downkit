import { useTranslation } from "react-i18next";
import { FileVideo, Music, RefreshCw } from "lucide-react";
import type { LocalMediaInfo } from "../types/convert";
import { formatBytes, formatDuration } from "../lib/format";
import { Button } from "./ui/Button";

interface LocalFileCardProps {
  info: LocalMediaInfo;
  onChange: () => void;
}

export function LocalFileCard({ info, onChange }: LocalFileCardProps) {
  const { t } = useTranslation();
  const isVideo = info.width !== null;
  const facts = [
    info.container.toUpperCase(),
    info.width && info.height ? `${info.width} × ${info.height}` : null,
    info.durationSeconds ? formatDuration(info.durationSeconds) : null,
    formatBytes(info.fileSizeBytes),
    info.videoCodec?.toUpperCase() ?? null,
    info.audioCodec?.toUpperCase() ?? null,
  ].filter(Boolean);

  return (
    <div className="dk-card flex items-center gap-4 p-4">
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[var(--dk-surface-2)] text-[var(--dk-accent-hover)]">
        {isVideo ? <FileVideo size={26} /> : <Music size={26} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-white" title={info.filePath}>
          {info.fileName}
        </p>
        <p className="mt-0.5 text-sm text-[var(--dk-text-muted)]">{facts.join("  ·  ")}</p>
      </div>
      <Button variant="secondary" size="sm" icon={<RefreshCw size={14} />} onClick={onChange}>
        {t("local.changeFile")}
      </Button>
    </div>
  );
}
