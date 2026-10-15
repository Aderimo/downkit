import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { HardDrive, Keyboard } from "lucide-react";
import { autostartGet, autostartSet, cacheClear, cacheUsage, discordSend } from "../lib/tauri-api";
import { isDiscordWebhook, useSettingsStore } from "../lib/appSettings";
import { localizeError } from "../lib/errors";
import { formatBytes } from "../lib/format";
import { useJobsStore } from "../store/jobsStore";
import { ACTIVE_STATUSES } from "../types/jobs";
import { HotkeyInput } from "./recorder/HotkeyInput";
import { Button } from "./ui/Button";
import { Switch } from "./ui/Switch";

const inTauri = () => "__TAURI_INTERNALS__" in window;

/** Windows açılınca tepside başlat (geriye dönük kayıt hazır beklesin). */
export function AutostartRow() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!inTauri()) return;
    void autostartGet()
      .then(setEnabled)
      .catch(() => setEnabled(false));
  }, []);
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-white">{t("settings.autostart")}</p>
        <p className="mt-0.5 text-xs text-[var(--dk-text-muted)]">
          {error ? t("settings.autostartFailed") : t("settings.autostartHint")}
        </p>
      </div>
      <Switch
        checked={enabled === true}
        disabled={enabled === null}
        label={t("settings.autostart")}
        onChange={(next) => {
          setError(false);
          void autostartSet(next)
            .then(setEnabled)
            .catch(() => setError(true));
        }}
      />
    </div>
  );
}

/** Bütün sistem geneli kısayollar tek yerde (kayıt ve ekran görüntüsü). */
export function HotkeysSection() {
  const { t } = useTranslation();
  return (
    <section className="dk-card space-y-4 p-5" data-tour="settings-hotkeys">
      <h2 className="flex items-center gap-2.5 text-base font-semibold text-white">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--dk-accent)]/15 text-[var(--dk-accent-hover)]">
          <Keyboard size={18} />
        </span>
        {t("settings.hotkeys")}
      </h2>
      <p className="-mt-2 text-xs text-[var(--dk-text-muted)]">{t("settings.hotkeysHint")}</p>
      <div className="grid gap-x-6 gap-y-3 lg:grid-cols-2">
        <HotkeyInput id="record" label={t("recorder.hotkeyRecord")} />
        <HotkeyInput id="snip" label={t("snip.hotkeyRegion")} />
        <HotkeyInput id="saveReplay" label={t("recorder.hotkeySave")} />
        <HotkeyInput id="snipFull" label={t("snip.hotkeyFull")} />
        <HotkeyInput id="toggleReplay" label={t("recorder.hotkeyToggleReplay")} />
        <HotkeyInput id="snipTranslate" label={t("snip.hotkeyTranslate")} />
        <HotkeyInput id="marker" label={t("recorder.hotkeyMarker")} />
      </div>
    </section>
  );
}

/** Önbellek: önizleme kopyaları, küçük resimler ve yarım dışa aktarımlar. */
export function StorageRow() {
  const { t } = useTranslation();
  const [bytes, setBytes] = useState<number | null>(null);
  const [freed, setFreed] = useState<number | null>(null);
  const busy = useJobsStore((s) =>
    s.jobs.some(
      (j) => ACTIVE_STATUSES.includes(j.status) || j.status === "queued" || j.status === "paused",
    ),
  );
  useEffect(() => {
    if (!inTauri()) return;
    void cacheUsage()
      .then(setBytes)
      .catch(() => setBytes(null));
  }, [freed]);
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm text-white">
          <HardDrive size={14} className="text-[var(--dk-text-muted)]" />
          {t("settings.cache")}
          <span className="font-mono text-xs text-[var(--dk-text-muted)]">
            {bytes === null ? "…" : formatBytes(bytes)}
          </span>
        </p>
        <p className="mt-0.5 text-xs text-[var(--dk-text-muted)]">
          {busy
            ? t("settings.cacheBusy")
            : freed !== null
              ? t("settings.cacheFreed", { size: formatBytes(freed) })
              : t("settings.cacheHint")}
        </p>
      </div>
      <Button
        size="sm"
        variant="secondary"
        disabled={busy || !bytes}
        onClick={() => void cacheClear().then(setFreed)}
      >
        {t("settings.cacheClear")}
      </Button>
    </div>
  );
}

/** Kullanıcının kendi Discord kanalı: kayıt ve kliplerdeki "Discord'a gönder" düğmesi buraya yollar. */
export function DiscordWebhookRow() {
  const { t } = useTranslation();
  const saved = useSettingsStore((s) => s.discordWebhook);
  const update = useSettingsStore((s) => s.update);
  const [draft, setDraft] = useState(saved ?? "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = isDiscordWebhook(draft);

  async function test() {
    if (!valid) return;
    setBusy(true);
    setMessage(null);
    try {
      await discordSend(draft.trim(), null, t("share.webhookTestMessage"));
      update({ discordWebhook: draft.trim() });
      setMessage({ ok: true, text: t("share.webhookOk") });
    } catch (err) {
      setMessage({ ok: false, text: localizeError(err, "share.discordFailed").message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm text-white">{t("share.webhook")}</p>
        <p className="mt-0.5 text-xs text-[var(--dk-text-muted)]">{t("share.webhookHint")}</p>
      </div>
      <div className="flex gap-2">
        <input
          value={draft}
          spellCheck={false}
          placeholder={t("share.webhookPlaceholder")}
          aria-label={t("share.webhook")}
          onChange={(e) => {
            setDraft(e.target.value);
            setMessage(null);
            const next = e.target.value.trim();
            if (next === "") update({ discordWebhook: null });
            else if (isDiscordWebhook(next)) update({ discordWebhook: next });
          }}
          className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--dk-border)] bg-[var(--dk-surface-2)] px-3 text-xs outline-none focus:border-[var(--dk-accent)]"
        />
        <Button size="sm" variant="secondary" disabled={!valid || busy} onClick={() => void test()}>
          {t("share.webhookTest")}
        </Button>
      </div>
      {draft.trim() !== "" && !valid ? (
        <p className="text-xs text-[var(--dk-error)]">{t("share.webhookInvalid")}</p>
      ) : message ? (
        <p
          className={`text-xs ${message.ok ? "text-[var(--dk-success)]" : "text-[var(--dk-error)]"}`}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
