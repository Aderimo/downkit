import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Bug, Check } from "lucide-react";
import { siDiscord, siGithub } from "simple-icons";
import { buildErrorReport, type ReportInput } from "../lib/errorReport";
import { recentLog } from "../lib/log";
import { copyText, getAppVersion, openExternalLink } from "../lib/tauri-api";
import { DISCORD_URL, ISSUES_URL } from "../lib/links";

/** "Hatayı bildir": raporu panoya kopyalar, nereye yapıştırılacağını sorar. */
export function ReportButton({
  input,
  className = "",
}: {
  input: ReportInput;
  className?: string;
}) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<{ x: number; y: number; copied: boolean } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu]);

  async function report() {
    const version = await getAppVersion().catch(() => null);
    const log = await recentLog(30);
    const copied = await copyText(buildErrorReport(input, version, navigator.userAgent, log));
    const rect = buttonRef.current?.getBoundingClientRect();
    setMenu({
      x: Math.min(rect?.left ?? 0, window.innerWidth - 300),
      y: Math.min((rect?.bottom ?? 0) + 6, window.innerHeight - 170),
      copied,
    });
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => void report()}
        className={`inline-flex items-center gap-1 text-[var(--dk-accent-hover)] underline ${className}`}
      >
        <Bug size={12} />
        {t("report.button")}
      </button>
      {menu
        ? createPortal(
            <div
              className="fixed z-[60] w-72 rounded-xl border border-[var(--dk-border-strong)] bg-[var(--dk-surface-2)] p-3 text-left shadow-2xl shadow-black/60"
              style={{ left: menu.x, top: menu.y }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <p className="flex items-center gap-1.5 text-sm text-white">
                {menu.copied ? <Check size={14} className="text-[var(--dk-success)]" /> : null}
                {menu.copied ? t("report.copied") : t("report.copyFailed")}
              </p>
              <p className="mt-1 text-xs text-[var(--dk-text-muted)]">{t("report.where")}</p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void openExternalLink(DISCORD_URL);
                    setMenu(null);
                  }}
                  className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#5865F2] text-xs font-medium text-white hover:brightness-110"
                >
                  <svg viewBox="0 0 24 24" width={13} height={13} fill="white" aria-hidden>
                    <path d={siDiscord.path} />
                  </svg>
                  Discord
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void openExternalLink(ISSUES_URL);
                    setMenu(null);
                  }}
                  className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--dk-border-strong)] text-xs font-medium text-[var(--dk-text)] hover:border-[var(--dk-accent)]"
                >
                  <svg viewBox="0 0 24 24" width={13} height={13} fill="currentColor" aria-hidden>
                    <path d={siGithub.path} />
                  </svg>
                  GitHub
                </button>
              </div>
              <p className="mt-2 text-[11px] text-[var(--dk-text-muted)]">{t("report.privacy")}</p>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
