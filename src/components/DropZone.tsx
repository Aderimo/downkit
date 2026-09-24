import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Upload } from "lucide-react";
import { chooseLocalMediaFile } from "../lib/tauri-api";
import { useFileDrop } from "../lib/useFileDrop";

interface DropZoneProps {
  /** Kararlı referans olmalı (ör. zustand eylemi). */
  onFile: (path: string) => void;
  busy?: boolean;
}

/** Dosyayı pencereye sürükle-bırak ya da tıklayıp seç. */
export function DropZone({ onFile, busy }: DropZoneProps) {
  const { t } = useTranslation();
  const [hovering, setHovering] = useState(false);
  const [rejected, setRejected] = useState(false);

  const accept = useCallback(
    (path: string) => {
      setRejected(false);
      onFile(path);
    },
    [onFile],
  );
  const reject = useCallback(() => setRejected(true), []);
  useFileDrop(accept, { onHover: setHovering, onRejected: reject });

  async function choose() {
    const path = await chooseLocalMediaFile();
    if (path) accept(path);
  }

  return (
    <button
      type="button"
      onClick={() => void choose()}
      disabled={busy}
      className={`flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-12 text-center transition-colors ${
        hovering
          ? "border-[var(--dk-accent)] bg-[var(--dk-accent)]/10"
          : "border-[var(--dk-border-strong)] bg-[var(--dk-surface)] hover:border-[var(--dk-accent)]"
      }`}
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--dk-accent)]/15 text-[var(--dk-accent-hover)]">
        {busy ? <Loader2 size={26} className="animate-spin" /> : <Upload size={26} />}
      </span>
      <span className="text-base font-semibold text-white">
        {hovering ? t("drop.release") : t("drop.title")}
      </span>
      <span className="text-sm text-[var(--dk-text-muted)]">{t("drop.subtitle")}</span>
      {rejected ? (
        <span className="text-sm text-[var(--dk-warning)]">{t("drop.rejected")}</span>
      ) : null}
    </button>
  );
}
