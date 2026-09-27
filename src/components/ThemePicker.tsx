import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Palette } from "lucide-react";
import { useSettingsStore } from "../lib/appSettings";
import { THEMES, type Theme, type ThemeId } from "../lib/themes";

/** Temanın küçük önizlemesi: kenar çubuğu, kart ve vurgu düğmesi kendi renkleriyle. */
function Preview({ theme }: { theme: Theme }) {
  const p = theme.palette;
  const gradient = p.gradient ?? `linear-gradient(135deg, ${p.accent} 0%, ${p.accent2} 100%)`;
  return (
    <div
      className="flex h-16 overflow-hidden rounded-lg border"
      style={{ background: p.bg, borderColor: p.border }}
      aria-hidden
    >
      <div className="flex w-5 flex-col gap-1 p-1" style={{ background: p.sidebar }}>
        <span className="h-1.5 rounded-sm" style={{ background: p.accent }} />
        <span className="h-1.5 rounded-sm" style={{ background: p.border }} />
        <span className="h-1.5 rounded-sm" style={{ background: p.border }} />
      </div>
      <div className="flex flex-1 flex-col justify-center gap-1.5 p-2">
        <div
          className="flex flex-col gap-1 rounded-md border p-1.5"
          style={{ background: p.surface, borderColor: p.border }}
        >
          <span className="h-1.5 w-3/4 rounded-sm" style={{ background: p.text }} />
          <span className="h-1.5 w-1/2 rounded-sm" style={{ background: p.textMuted }} />
        </div>
        <span className="h-2.5 w-1/2 self-end rounded-sm" style={{ background: gradient }} />
      </div>
    </div>
  );
}

function ThemeCard({ theme, selected }: { theme: Theme; selected: boolean }) {
  const { t } = useTranslation();
  const update = useSettingsStore((s) => s.update);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => update({ theme: theme.id as ThemeId })}
      className={`group relative flex flex-col gap-2 rounded-xl border bg-[var(--dk-surface-2)] p-2 text-left transition hover:border-[var(--dk-accent)] ${
        selected ? "dk-selected" : "border-[var(--dk-border)]"
      }`}
    >
      <Preview theme={theme} />
      <span className="min-w-0 px-0.5">
        <span className="block truncate text-sm font-semibold text-white">
          {t(`themes.${theme.id}.name`)}
        </span>
        <span className="block truncate text-[11px] text-[var(--dk-text-muted)]">
          {t(`themes.${theme.id}.hint`)}
        </span>
      </span>
      {selected ? (
        <span className="dk-gradient absolute top-3 right-3 flex h-5 w-5 items-center justify-center rounded-full text-white shadow">
          <Check size={12} strokeWidth={3} />
        </span>
      ) : null}
    </button>
  );
}

/** Ayarlar > Tema: koyu ve açık renk paketleri; tıklayınca hemen uygulanır. */
export function ThemePicker() {
  const { t } = useTranslation();
  const current = useSettingsStore((s) => s.theme);
  const groups = [
    { key: "dark", label: t("settings.themesDark") },
    { key: "light", label: t("settings.themesLight") },
  ] as const;
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.key} className="space-y-2">
          <p className="text-xs font-semibold tracking-wide text-[var(--dk-text-muted)] uppercase">
            {group.label}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
            {THEMES.filter((theme) => theme.mode === group.key).map((theme) => (
              <ThemeCard key={theme.id} theme={theme} selected={theme.id === current} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const OPEN_KEY = "downkit.themePanelOpen";

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

/** Ayarlar'daki tema bölümü: kapalıyken tek satır renk yuvarlakları (tıklayınca
 * uygulanır), açılınca önizlemeli tam liste. Yer kaplamasın diye varsayılan kapalı. */
export function ThemeSection() {
  const { t } = useTranslation();
  const current = useSettingsStore((s) => s.theme);
  const update = useSettingsStore((s) => s.update);
  const [open, setOpen] = useState(readOpen);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      // Hatırlanmazsa bir dahaki açılışta kapalı gelir.
    }
  };

  return (
    <section className="dk-card space-y-4 p-5" data-tour="settings-theme">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2.5 text-base font-semibold text-white">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--dk-accent)]/15 text-[var(--dk-accent-hover)]">
            <Palette size={18} />
          </span>
          {t("settings.theme")}
        </h2>
        <span className="rounded-full border border-[var(--dk-border-strong)] px-2.5 py-0.5 text-xs text-[var(--dk-text-muted)]">
          {t(`themes.${current}.name`)}
        </span>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-[var(--dk-accent-hover)] hover:bg-white/5"
        >
          {open ? t("settings.themesHide") : t("settings.themesShowAll")}
          <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      {open ? (
        <>
          <p className="-mt-2 text-xs text-[var(--dk-text-muted)]">{t("settings.themeHint")}</p>
          <ThemePicker />
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          {THEMES.map((theme: Theme) => {
            const p = theme.palette;
            const gradient =
              p.gradient ?? `linear-gradient(135deg, ${p.accent} 0%, ${p.accent2} 100%)`;
            return (
              <button
                key={theme.id}
                type="button"
                title={t(`themes.${theme.id}.name`)}
                aria-label={t(`themes.${theme.id}.name`)}
                aria-pressed={theme.id === current}
                onClick={() => update({ theme: theme.id as ThemeId })}
                className={`relative h-8 w-8 overflow-hidden rounded-full border-2 transition hover:scale-110 ${
                  theme.id === current
                    ? "border-[var(--dk-accent)] ring-2 ring-[var(--dk-accent)]/40"
                    : "border-[var(--dk-border-strong)]"
                }`}
                style={{ background: p.bg }}
              >
                <span
                  className="absolute inset-y-0 right-0 w-1/2"
                  style={{ background: gradient }}
                />
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
