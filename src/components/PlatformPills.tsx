import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import type { SupportedPlatform } from "../types/media";
import { PlatformIcon } from "./PlatformIcon";
import { PLATFORM_LABEL } from "../lib/platforms";

const PRIMARY: SupportedPlatform[] = [
  "youtube",
  "tiktok",
  "instagram",
  "x",
  "reddit",
  "facebook",
  "twitch",
  "kick",
];
const MORE: SupportedPlatform[] = ["vimeo", "dailymotion", "pinterest"];

/** Desteklenen platformları gösterir; yapıştırılan linkin platformu halkayla vurgulanır. */
export function PlatformPills({ detected }: { detected: SupportedPlatform | null }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreDetected = detected !== null && MORE.includes(detected) ? detected : null;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!moreRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  return (
    <div className="flex flex-wrap gap-1.5" title={t("analyze.supportedPlatforms")}>
      {PRIMARY.map((p) => (
        <Pill key={p} platform={p} active={detected === p} />
      ))}
      <div ref={moreRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={t("analyze.morePlatforms")}
          title={t("analyze.morePlatforms")}
          className={`dk-card flex h-10 items-center gap-1 rounded-xl px-2.5 text-[13px] transition-colors hover:border-[var(--dk-border-strong)] ${
            moreDetected ? "dk-selected" : ""
          }`}
        >
          {moreDetected ? <PlatformIcon platform={moreDetected} size={18} /> : null}
          {moreDetected ? PLATFORM_LABEL[moreDetected] : `+${MORE.length}`}
          <ChevronDown size={16} className="text-[var(--dk-text-muted)]" />
        </button>
        {open ? (
          <div className="absolute right-0 z-30 mt-1 w-52 rounded-xl border border-[var(--dk-border-strong)] bg-[var(--dk-surface-2)] p-1 shadow-2xl shadow-black/50">
            {MORE.map((p) => (
              <div key={p} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm">
                <PlatformIcon platform={p} size={22} />
                {PLATFORM_LABEL[p]}
              </div>
            ))}
            <p className="px-2.5 pb-1.5 pt-1 text-xs text-[var(--dk-text-muted)]">
              {t("analyze.moreHint")}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Pill({ platform, active }: { platform: SupportedPlatform; active: boolean }) {
  return (
    <span
      className={`dk-card flex h-10 items-center gap-1.5 rounded-xl px-2.5 text-[13px] transition-colors ${
        active ? "dk-selected text-white" : "text-[var(--dk-text)]/90"
      }`}
    >
      <PlatformIcon platform={platform} size={18} />
      {PLATFORM_LABEL[platform]}
    </span>
  );
}
