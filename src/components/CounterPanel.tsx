import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Activity, Download, RefreshCw } from "lucide-react";
import { COUNTER_URL, fetchActiveUsers, fetchDownloadStats } from "../lib/counter";
import { useSettingsStore } from "../lib/appSettings";
import { Switch } from "./ui/Switch";

/** Ayarlar → Sayaç: toplam indirme (GitHub API) ve aktif kullanıcı (sayaç
 * sunucusu kuruluysa). Sunucu yoksa aktif sayısı "—" görünür. */
export function CounterPanel() {
  const { t, i18n } = useTranslation();
  const counterOptIn = useSettingsStore((s) => s.counterOptIn);
  const update = useSettingsStore((s) => s.update);
  const [downloads, setDownloads] = useState<number | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  // Yenile düğmesi bunu artırır; yükleme tek yerden (effect) yapılır.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    // setState yalnızca promise geri çağrılarında olur (react-hooks/set-state-in-effect).
    Promise.all([fetchDownloadStats(), fetchActiveUsers()])
      .then(([stats, activeUsers]) => {
        if (!alive) return;
        setDownloads(stats.total);
        setActive(activeUsers);
        setState("ok");
      })
      .catch(() => {
        if (alive) setState("error");
      });
    return () => {
      alive = false;
    };
  }, [tick]);

  // Yenile düğmesi: olay işleyicide eşzamanlı setState serbesttir.
  const reload = () => {
    setState("loading");
    setTick((n) => n + 1);
  };

  const fmt = (n: number) => n.toLocaleString(i18n.language);
  const value = (n: number | null) =>
    state === "loading" ? "…" : state === "error" || n === null ? "—" : fmt(n);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex items-center gap-3 rounded-xl border border-[var(--dk-border)] bg-[var(--dk-surface-2)] p-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--dk-accent)]/15 text-[var(--dk-accent-hover)]">
            <Download size={16} />
          </span>
          <div className="min-w-0">
            <p className="text-lg leading-tight font-semibold text-white tabular-nums">
              {value(downloads)}
            </p>
            <p className="truncate text-xs text-[var(--dk-text-muted)]">
              {t("settings.counterDownloads")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-[var(--dk-border)] bg-[var(--dk-surface-2)] p-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--dk-accent)]/15 text-[var(--dk-accent-hover)]">
            <Activity size={16} />
          </span>
          <div className="min-w-0">
            <p className="text-lg leading-tight font-semibold text-white tabular-nums">
              {COUNTER_URL ? value(active) : "—"}
            </p>
            <p className="truncate text-xs text-[var(--dk-text-muted)]">
              {t("settings.counterActive")}
            </p>
          </div>
        </div>
      </div>

      {state === "error" ? (
        <p className="text-xs text-[var(--dk-error)]">{t("settings.counterError")}</p>
      ) : null}

      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-white">{t("settings.counterOptIn")}</p>
          <p className="mt-0.5 text-xs text-[var(--dk-text-muted)]">
            {t("settings.counterOptInHint")}
          </p>
        </div>
        <Switch
          checked={counterOptIn}
          onChange={(counterOptIn) => update({ counterOptIn })}
          label={t("settings.counterOptIn")}
        />
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={reload}
          disabled={state === "loading"}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--dk-border-strong)] px-2.5 py-1.5 text-xs hover:border-[var(--dk-accent)] disabled:opacity-50"
        >
          <RefreshCw size={13} className={state === "loading" ? "animate-spin" : undefined} />
          {t("settings.counterRefresh")}
        </button>
      </div>
    </div>
  );
}
