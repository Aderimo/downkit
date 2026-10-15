import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, FolderOpen, Gamepad2, Mic, Monitor, Sparkles, Volume2 } from "lucide-react";
import { useSettingsStore } from "../lib/appSettings";
import { resolveOutputDir, startReplay } from "../lib/recorder";
import { useRecorderSettings } from "../lib/recorderSettings";
import { chooseDownloadDir } from "../lib/tauri-api";
import { useTutorialStore } from "../lib/tutorial";
import { useRecorderStore } from "../store/recorderStore";
import { BrandMark } from "./BrandMark";
import { Button } from "./ui/Button";
import { Switch } from "./ui/Switch";

type Use = "games" | "screen" | "both";

/** Kullanım amacına göre kayıt ayarları. */
function presetForUse(use: Use): { replayOnStartup: boolean; fps: number } {
  return use === "screen"
    ? { replayOnStartup: false, fps: 30 }
    : { replayOnStartup: true, fps: 60 };
}

const STEPS = 3;

/** İlk açılışta 3 adımlı kurulum: ne kaydedilsin, ses, klasör. Bitince (istenirse)
 * karşılama turu başlar. "Atla" varsayılanlarla devam eder. */
export function SetupWizard() {
  const { t } = useTranslation();
  const setupDone = useSettingsStore((s) => s.setupDone);
  const recorder = useRecorderSettings();
  const [step, setStep] = useState(0);
  const [use, setUse] = useState<Use>("both");

  if (setupDone) return null;

  /** `apply`: seçimler kaydedilir; "Atla" varsayılanlarla devam eder. */
  const finish = (apply: boolean) => {
    if (apply) {
      const preset = presetForUse(use);
      recorder.update(preset);
      // Geriye dönük kayıt hemen başlar (normalde program açılınca başlıyor).
      if (preset.replayOnStartup && !useRecorderStore.getState().status.replay) {
        void startReplay().catch(() => {});
      }
    }
    const settings = useSettingsStore.getState();
    settings.update({ setupDone: true });
    if (settings.showTutorial) useTutorialStore.getState().start("welcome");
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("setup.title")}
        className="dk-card flex w-full max-w-2xl flex-col p-6 shadow-2xl"
      >
        <div className="flex items-center gap-3">
          <BrandMark size={44} />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-white">{t("setup.title")}</h2>
            <p className="text-xs text-[var(--dk-text-muted)]">
              {t("setup.stepOf", { step: step + 1, total: STEPS })}
            </p>
          </div>
          <div className="flex gap-1.5" aria-hidden>
            {Array.from({ length: STEPS }, (_, i) => (
              <span
                key={i}
                className={`h-2 rounded-full transition-all ${
                  i === step
                    ? "w-6 bg-[var(--dk-accent)]"
                    : i < step
                      ? "w-2 bg-[var(--dk-accent)]"
                      : "w-2 bg-[var(--dk-border-strong)]"
                }`}
              />
            ))}
          </div>
        </div>

        <div className="mt-6 min-h-[300px]">
          {step === 0 ? <UseStep use={use} onChange={setUse} /> : null}
          {step === 1 ? <AudioStep /> : null}
          {step === 2 ? <FolderStep /> : null}
        </div>

        <div className="mt-6 flex items-center gap-2 border-t border-[var(--dk-border)] pt-4">
          <button
            type="button"
            onClick={() => finish(false)}
            className="text-xs text-[var(--dk-text-muted)] hover:text-[var(--dk-text)]"
          >
            {t("setup.skip")}
          </button>
          <span className="flex-1" />
          {step > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => setStep(step - 1)}>
              {t("tutorial.back")}
            </Button>
          ) : null}
          {step < STEPS - 1 ? (
            <Button size="sm" onClick={() => setStep(step + 1)}>
              {t("tutorial.next")}
            </Button>
          ) : (
            <Button size="sm" icon={<Sparkles size={15} />} onClick={() => finish(true)}>
              {t("setup.finish")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Choice({
  selected,
  onClick,
  icon,
  title,
  body,
}: {
  selected: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={`relative flex flex-col gap-2 rounded-2xl border-2 p-4 text-left transition ${
        selected
          ? "dk-selected bg-[var(--dk-accent)]/10"
          : "border-[var(--dk-border)] bg-[var(--dk-surface-2)] hover:border-[var(--dk-accent)]"
      }`}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--dk-accent)] text-white">
        {icon}
      </span>
      <span className="text-sm font-bold text-white">{title}</span>
      <span className="text-xs leading-relaxed text-[var(--dk-text-muted)]">{body}</span>
      {selected ? (
        <span className="absolute top-3 right-3 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--dk-accent)] text-white">
          <Check size={12} strokeWidth={3} />
        </span>
      ) : null}
    </button>
  );
}

function UseStep({ use, onChange }: { use: Use; onChange: (use: Use) => void }) {
  const { t } = useTranslation();
  return (
    <div>
      <h3 className="text-xl font-bold text-white">{t("setup.useTitle")}</h3>
      <p className="mt-1 text-sm text-[var(--dk-text-muted)]">{t("setup.useHint")}</p>
      <div role="radiogroup" className="mt-4 grid gap-3 sm:grid-cols-3">
        <Choice
          selected={use === "games"}
          onClick={() => onChange("games")}
          icon={<Gamepad2 size={20} />}
          title={t("setup.useGames")}
          body={t("setup.useGamesHint")}
        />
        <Choice
          selected={use === "screen"}
          onClick={() => onChange("screen")}
          icon={<Monitor size={20} />}
          title={t("setup.useScreen")}
          body={t("setup.useScreenHint")}
        />
        <Choice
          selected={use === "both"}
          onClick={() => onChange("both")}
          icon={<Sparkles size={20} />}
          title={t("setup.useBoth")}
          body={t("setup.useBothHint")}
        />
      </div>
    </div>
  );
}

function ToggleCard({
  icon,
  title,
  hint,
  checked,
  onChange,
  children,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border-2 border-[var(--dk-border)] bg-[var(--dk-surface-2)] p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--dk-accent)]/15 text-[var(--dk-accent-hover)]">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-white">{title}</p>
          <p className="text-xs text-[var(--dk-text-muted)]">{hint}</p>
        </div>
        <Switch checked={checked} onChange={onChange} label={title} />
      </div>
      {children}
    </div>
  );
}

function AudioStep() {
  const { t } = useTranslation();
  const recorder = useRecorderSettings();
  return (
    <div>
      <h3 className="text-xl font-bold text-white">{t("setup.audioTitle")}</h3>
      <p className="mt-1 text-sm text-[var(--dk-text-muted)]">{t("setup.audioHint")}</p>
      <div className="mt-4 space-y-3">
        <ToggleCard
          icon={<Volume2 size={20} />}
          title={t("setup.systemAudio")}
          hint={t("setup.systemAudioHint")}
          checked={recorder.systemAudio}
          onChange={(systemAudio) => recorder.update({ systemAudio })}
        />
        <ToggleCard
          icon={<Mic size={20} />}
          title={t("setup.microphone")}
          hint={t("setup.microphoneHint")}
          checked={recorder.microphone}
          // Mikrofon açılınca gürültü engelleme de açık gelir (fan, klavye sesi).
          onChange={(microphone) =>
            recorder.update(microphone ? { microphone, noiseSuppression: true } : { microphone })
          }
        >
          {recorder.microphone ? (
            <label className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--dk-border)] pt-3 text-sm">
              <span className="min-w-0">
                <span className="block text-[var(--dk-text)]">
                  {t("recorder.noiseSuppression")}
                </span>
                <span className="block text-[11px] text-[var(--dk-text-muted)]">
                  {t("recorder.noiseSuppressionHint")}
                </span>
              </span>
              <Switch
                checked={recorder.noiseSuppression}
                onChange={(noiseSuppression) => recorder.update({ noiseSuppression })}
                label={t("recorder.noiseSuppression")}
              />
            </label>
          ) : null}
        </ToggleCard>
      </div>
    </div>
  );
}

function FolderStep() {
  const { t } = useTranslation();
  const outputDir = useRecorderStore((s) => s.outputDir);
  const recorder = useRecorderSettings();
  const advanced = useSettingsStore((s) => s.advanced);
  const update = useSettingsStore((s) => s.update);

  useEffect(() => {
    void resolveOutputDir().catch(() => {});
  }, []);

  return (
    <div>
      <h3 className="text-xl font-bold text-white">{t("setup.folderTitle")}</h3>
      <p className="mt-1 text-sm text-[var(--dk-text-muted)]">{t("setup.folderHint")}</p>
      <div className="mt-4 space-y-3">
        <div className="rounded-2xl border-2 border-[var(--dk-border)] bg-[var(--dk-surface-2)] p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-white">
            <FolderOpen size={16} className="text-[var(--dk-accent-hover)]" />
            {t("setup.folderLabel")}
          </p>
          <p
            className="dk-selectable mt-2 truncate rounded-lg bg-[var(--dk-bg)] px-3 py-2 font-mono text-xs text-[var(--dk-text)]"
            title={outputDir ?? ""}
          >
            {outputDir ?? "…"}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                const dir = await chooseDownloadDir();
                if (dir) {
                  recorder.update({ outputDir: dir });
                  await resolveOutputDir();
                }
              }}
            >
              {t("setup.folderChange")}
            </Button>
            {recorder.outputDir ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  recorder.update({ outputDir: null });
                  await resolveOutputDir();
                }}
              >
                {t("recorder.defaultFolder")}
              </Button>
            ) : null}
          </div>
        </div>
        <div className="rounded-2xl border-2 border-[var(--dk-border)] bg-[var(--dk-surface-2)] p-4 text-sm">
          <p className="font-bold text-white">{t("setup.hotkeysTitle")}</p>
          <ul className="mt-2 space-y-1.5 text-xs text-[var(--dk-text-muted)]">
            <HotkeyLine keys={recorder.hotkeys.record} label={t("recorder.hotkeyRecord")} />
            <HotkeyLine keys={recorder.hotkeys.saveReplay} label={t("recorder.hotkeySave")} />
            <HotkeyLine keys={recorder.hotkeys.snip} label={t("setup.hotkeySnip")} />
          </ul>
        </div>
        <label className="flex items-center justify-between gap-3 rounded-2xl border-2 border-[var(--dk-border)] bg-[var(--dk-surface-2)] p-4 text-sm">
          <span className="min-w-0">
            <span className="block font-bold text-white">{t("settings.advancedMode")}</span>
            <span className="block text-xs text-[var(--dk-text-muted)]">
              {t("setup.advancedHint")}
            </span>
          </span>
          <Switch
            checked={advanced}
            onChange={(value) => update({ advanced: value })}
            label={t("settings.advancedMode")}
          />
        </label>
      </div>
    </div>
  );
}

function HotkeyLine({ keys, label }: { keys: string | null; label: string }) {
  if (!keys) return null;
  return (
    <li className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <kbd className="rounded-md border border-[var(--dk-border-strong)] bg-[var(--dk-bg)] px-2 py-0.5 font-mono text-[11px] text-[var(--dk-text)]">
        {keys.replaceAll("+", " + ")}
      </kbd>
    </li>
  );
}
