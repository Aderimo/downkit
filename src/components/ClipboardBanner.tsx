import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ClipboardCheck, X } from "lucide-react";
import { checkSupportedUrl } from "../lib/validation";
import { onWindowFocus, readClipboardText } from "../lib/tauri-api";
import { useSettingsStore } from "../lib/appSettings";
import { PlatformIcon } from "./PlatformIcon";
import { PLATFORM_LABEL } from "../lib/platforms";
import type { SupportedPlatform } from "../types/media";
import { Button } from "./ui/Button";

interface ClipboardBannerProps {
  currentUrl: string;
  onUse: (url: string) => void;
}

/** Pencere öne gelince panoda desteklenen yeni bir link varsa önerir.
 * Hiçbir şeyi kendiliğinden başlatmaz; ayarlardan kapatılabilir. */
export function ClipboardBanner({ currentUrl, onUse }: ClipboardBannerProps) {
  const { t } = useTranslation();
  const enabled = useSettingsStore((s) => s.clipboardSuggest);
  const [suggestion, setSuggestion] = useState<{ url: string; platform: SupportedPlatform } | null>(
    null,
  );
  const seen = useRef(new Set<string>());
  const currentRef = useRef(currentUrl);

  useEffect(() => {
    currentRef.current = currentUrl;
  }, [currentUrl]);

  useEffect(() => {
    if (!enabled) return;
    async function check() {
      const text = (await readClipboardText())?.trim();
      if (!text || seen.current.has(text) || text === currentRef.current.trim()) return;
      const result = checkSupportedUrl(text);
      if (result.status !== "ok") return;
      seen.current.add(text);
      setSuggestion({ url: text, platform: result.platform });
    }
    void check();
    const unlisten = onWindowFocus(() => void check());
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [enabled]);

  if (!enabled || !suggestion || suggestion.url === currentUrl.trim()) return null;

  return (
    <div className="dk-card flex items-center gap-3 border-[var(--dk-accent)]/40 bg-[var(--dk-accent)]/10 px-4 py-2.5 text-sm">
      <ClipboardCheck size={18} className="shrink-0 text-[var(--dk-accent-hover)]" />
      <PlatformIcon platform={suggestion.platform} size={20} />
      <span className="min-w-0 flex-1 truncate">
        {t("clipboard.found", { platform: PLATFORM_LABEL[suggestion.platform] })}{" "}
        <span className="text-[var(--dk-text-muted)]">{suggestion.url}</span>
      </span>
      <Button
        size="sm"
        onClick={() => {
          onUse(suggestion.url);
          setSuggestion(null);
        }}
      >
        {t("clipboard.use")}
      </Button>
      <button
        type="button"
        onClick={() => setSuggestion(null)}
        aria-label={t("clipboard.dismiss")}
        className="rounded p-1 text-[var(--dk-text-muted)] hover:text-white"
      >
        <X size={16} />
      </button>
    </div>
  );
}
