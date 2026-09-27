import { useTranslation } from "react-i18next";
import {
  Camera,
  CircleCheck,
  FolderOpen,
  ImagePlus,
  Info,
  Languages,
  Maximize,
  ScanLine,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ErrorBanner } from "../components/ErrorBanner";
import { ImageEditor } from "../components/snip/ImageEditor";
import { ShotsLibrary } from "../components/snip/ShotsLibrary";
import { SnipSettingsCard } from "../components/snip/SnipSettingsCard";
import { useSnipStore } from "../store/snipStore";
import { useRecorderSettings, type RecorderHotkey } from "../lib/recorderSettings";
import { hotkeyLabel } from "../lib/recorderLogic";
import { capture, openFile, type CaptureKind } from "../lib/snipActions";
import { chooseImageFile, revealInFolder } from "../lib/tauri-api";

const CAPTURES: {
  kind: CaptureKind;
  hotkey: RecorderHotkey;
  icon: LucideIcon;
  tone: string;
}[] = [
  { kind: "region", hotkey: "snip", icon: ScanLine, tone: "from-[#4f7bff] to-[#7c5cff]" },
  { kind: "full", hotkey: "snipFull", icon: Maximize, tone: "from-[#22c55e] to-[#0f766e]" },
  {
    kind: "translate",
    hotkey: "snipTranslate",
    icon: Languages,
    tone: "from-[#f59e0b] to-[#c2410c]",
  },
];

/** Ekran görüntüsü (Lightshot gibi): bölge / tam ekran yakalama, düzenleyici
 * (ok, yazı, numaralı adım, bulanıklaştırma…), görüntüdeki yazıyı okuma ve
 * çeviri, ayarlar ve son görüntüler. */
export function ScreenshotScreen() {
  const { t } = useTranslation();
  const image = useSnipStore((s) => s.image);
  const translateOnOpen = useSnipStore((s) => s.translateOnOpen);
  const error = useSnipStore((s) => s.error);
  const notice = useSnipStore((s) => s.notice);
  const lastSaved = useSnipStore((s) => s.lastSaved);
  const patch = useSnipStore((s) => s.patch);
  const hotkeys = useRecorderSettings((s) => s.hotkeys);

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <header className="flex flex-wrap items-center gap-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#38bdf8] to-[#4f46e5] text-white shadow-lg">
          <Camera size={24} />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">{t("snip.title")}</h1>
          <p className="text-sm text-[var(--dk-text-muted)]">{t("snip.subtitle")}</p>
        </div>
      </header>

      {error ? (
        <ErrorBanner
          message={error.message}
          detail={error.detail}
          onDismiss={() => patch({ error: null })}
        />
      ) : null}

      {notice ? (
        <div className="flex items-center gap-3 rounded-2xl border border-[var(--dk-accent)]/30 bg-[var(--dk-accent)]/10 px-4 py-3 text-sm">
          <Info size={18} className="shrink-0 text-[var(--dk-accent-hover)]" />
          <p className="min-w-0 flex-1">{notice}</p>
          <button
            type="button"
            onClick={() => patch({ notice: null })}
            aria-label={t("clipboard.dismiss")}
            className="rounded-md p-1 text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>
      ) : null}

      {image ? (
        <ImageEditor key={image.path} image={image} translateOnOpen={translateOnOpen} />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" data-tour="snip-capture">
            {CAPTURES.map(({ kind, hotkey, icon: Icon, tone }) => (
              <button
                key={kind}
                type="button"
                onClick={() => void capture(kind, true)}
                className="dk-card group flex flex-col items-start gap-3 p-5 text-left transition hover:border-[var(--dk-accent)]"
              >
                <span
                  className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${tone} text-white shadow-lg transition-transform group-hover:scale-105`}
                >
                  <Icon size={21} />
                </span>
                <span className="text-base font-semibold text-white">
                  {t(`snip.capture.${kind}`)}
                </span>
                <span className="mt-auto rounded-md border border-[var(--dk-border-strong)] px-2 py-0.5 font-mono text-[11px] text-[var(--dk-text-muted)]">
                  {hotkeys[hotkey] ? hotkeyLabel(hotkeys[hotkey]) : t("snip.noHotkey")}
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={async () => {
                const path = await chooseImageFile();
                if (path) await openFile(path);
              }}
              className="dk-card group flex flex-col items-start gap-3 p-5 text-left transition hover:border-[var(--dk-accent)]"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#a855f7] to-[#db2777] text-white shadow-lg transition-transform group-hover:scale-105">
                <ImagePlus size={21} />
              </span>
              <span className="text-base font-semibold text-white">{t("snip.capture.file")}</span>
            </button>
          </div>

          {lastSaved ? (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#4ADE80]/30 bg-[#4ADE80]/10 px-4 py-3 text-sm">
              <CircleCheck size={18} className="shrink-0 text-[var(--dk-success)]" />
              <p className="min-w-0 flex-1 truncate">
                {t("snip.savedTitle")}{" "}
                <span className="text-[var(--dk-text-muted)]">
                  · {lastSaved.split(/[\\/]/).pop()}
                </span>
              </p>
              <button
                type="button"
                onClick={() => void openFile(lastSaved)}
                className="text-[var(--dk-accent-hover)] hover:underline"
              >
                {t("snip.openInEditor")}
              </button>
              <button
                type="button"
                onClick={() => void revealInFolder(lastSaved)}
                className="flex items-center gap-1 text-[var(--dk-accent-hover)] hover:underline"
              >
                <FolderOpen size={14} />
                {t("snip.showInFolder")}
              </button>
              <button
                type="button"
                aria-label={t("tutorial.close")}
                onClick={() => patch({ lastSaved: null })}
                className="rounded p-0.5 text-[var(--dk-text-muted)] hover:text-white"
              >
                <X size={15} />
              </button>
            </div>
          ) : null}

          <SnipSettingsCard />
          <ShotsLibrary />
        </>
      )}
    </div>
  );
}
