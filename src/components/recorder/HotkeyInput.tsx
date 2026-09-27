import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CircleCheck, X } from "lucide-react";
import { useRecorderStore } from "../../store/recorderStore";
import {
  DEFAULT_HOTKEYS,
  getRecorderSettings,
  useRecorderSettings,
  type RecorderHotkey,
} from "../../lib/recorderSettings";
import { pauseHotkeys, resumeHotkeys } from "../../lib/recorder";
import {
  HOTKEY_KEYS,
  HOTKEY_SUGGESTIONS,
  buildHotkey,
  toAccelerator,
  hotkeyFromEvent,
  hotkeyLabel,
  parseHotkey,
  type HotkeyParts,
} from "../../lib/recorderLogic";
import { hotkeyProbe } from "../../lib/tauri-api";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";

function Toggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={`h-8 rounded-lg border px-3 font-mono text-xs transition-colors ${
        on
          ? "dk-gradient border-transparent text-white"
          : "border-[var(--dk-border-strong)] bg-[var(--dk-surface-2)] text-[var(--dk-text-muted)] hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

/** Bir kayıt kısayolu. Tıklayınca düzenleyici açılır: Ctrl / Alt / Shift seçilip tuş
 * listeden seçilir (başka bir programın tuttuğu birleşim de böyle atanabilir) ya da
 * DownKit penceresindeyken doğrudan tuşlara basılır. Yanında çalışıp çalışmadığı görünür. */
export function HotkeyInput({ id, label }: { id: RecorderHotkey; label: string }) {
  const { t } = useTranslation();
  const combo = useRecorderSettings((s) => s.hotkeys[id]);
  const update = useRecorderSettings((s) => s.update);
  const error = useRecorderStore((s) => s.hotkeyErrors[id]);
  const active = useRecorderStore((s) => s.activeHotkeys.includes(id));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<HotkeyParts>(() => parseHotkey(combo));
  const [detected, setDetected] = useState(false);
  // Her açılış bir oturum: kendi kısayollarımız bırakılınca (hazır) Windows'a
  // hangi birleşimin boş olduğu sorulur; sonuçlar oturuma göre saklanır.
  const [session, setSession] = useState(0);
  const [readySession, setReadySession] = useState(-1);
  const [probed, setProbed] = useState<Record<string, boolean | null>>({});
  const ready = editing && readySession === session;

  const save = (next: string | null) => {
    const hotkeys = getRecorderSettings().hotkeys;
    // Aynı kısayol başka bir işteyse oradan kaldırılır.
    const cleared = Object.fromEntries(
      Object.entries(hotkeys).map(([k, v]) => [k, next !== null && v === next ? null : v]),
    ) as typeof hotkeys;
    update({ hotkeys: { ...cleared, [id]: next } });
    setEditing(false);
  };

  // Kısayola basılınca kısa süre "Algılandı" yazar: çalıştığı buradan denenebilir.
  useEffect(() => {
    let timer = 0;
    const off = useRecorderStore.subscribe((next, prev) => {
      if (next.lastHotkey === prev.lastHotkey || next.lastHotkey?.key !== id) return;
      setDetected(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setDetected(false), 2500);
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, [id]);

  useEffect(() => {
    if (!editing) return;
    // Düzenlerken DownKit'in kendi kısayolları kapatılır ki aynı tuşlara basılabilsin
    // ve denetim onları "başka programda" saymasın.
    let cancelled = false;
    void pauseHotkeys().then(() => {
      if (!cancelled) setReadySession(session);
    });
    const onKey = (e: KeyboardEvent) => {
      // Açık tuş listesi klavyeyle gezilebilsin.
      if (e.target instanceof HTMLElement && e.target.closest("[role=listbox]")) return;
      if (e.key === "Escape") {
        e.preventDefault();
        setEditing(false);
        return;
      }
      const result = hotkeyFromEvent(e);
      if ("combo" in result) {
        e.preventDefault();
        setDraft(parseHotkey(result.combo));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKey, true);
      void resumeHotkeys();
    };
  }, [editing, session]);

  const built = buildHotkey(draft);
  const draftAccelerator = "combo" in built ? toAccelerator(built.combo) : null;

  // Seçilen birleşim ve öneriler Windows'a sorulur (sorulmamış olanlar).
  useEffect(() => {
    if (!ready) return;
    const wanted = [draftAccelerator, ...HOTKEY_SUGGESTIONS].filter(
      (a): a is string => !!a && !(`${session}:${a}` in probed),
    );
    if (wanted.length === 0) return;
    let cancelled = false;
    hotkeyProbe(wanted)
      .then((results) => {
        if (cancelled) return;
        setProbed((prev) => ({
          ...prev,
          ...Object.fromEntries(wanted.map((a, i) => [`${session}:${a}`, results[i] ?? null])),
        }));
      })
      .catch(() => {
        // Tauri dışında (tarayıcı önizlemesi) denetim yok.
      });
    return () => {
      cancelled = true;
    };
  }, [ready, draftAccelerator, session, probed]);

  const free = draftAccelerator ? probed[`${session}:${draftAccelerator}`] : undefined;
  const others = Object.entries(getRecorderSettings().hotkeys)
    .filter(([k]) => k !== id)
    .map(([, v]) => v);
  const suggestions = ready
    ? HOTKEY_SUGGESTIONS.filter(
        (c) =>
          probed[`${session}:${c}`] === true &&
          !others.includes(c) &&
          c !== ("combo" in built ? built.combo : null),
      ).slice(0, 3)
    : [];
  const problem = "problem" in built && draft.key ? built.problem : null;
  // Türkçe Q'da Ctrl+Alt = AltGr: Ctrl+Alt+Q "@" yazar; kısayol olursa o karakter yazılamaz.
  const altGrRisk =
    !problem && draft.ctrl && draft.alt && !draft.shift && /^[A-Z0-9]$/.test(draft.key);

  const status = editing ? null : detected ? (
    <span className="flex items-center gap-1 text-[var(--dk-success)]">
      <CircleCheck size={12} />
      {t("recorder.hotkeyDetected")}
    </span>
  ) : combo && active ? (
    <span className="flex items-center gap-1 text-[var(--dk-text-muted)]">
      <span className="h-1.5 w-1.5 rounded-full bg-[var(--dk-success)]" />
      {t("recorder.hotkeyReady")}
    </span>
  ) : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">{label}</p>
          {status ? <p className="text-[11px]">{status}</p> : null}
        </div>
        <button
          type="button"
          aria-expanded={editing}
          onClick={() => {
            setDraft(parseHotkey(combo));
            setSession((n) => n + 1);
            setEditing((v) => !v);
          }}
          className={`h-8 min-w-36 rounded-lg border px-2.5 font-mono text-xs ${
            editing
              ? "border-[var(--dk-accent)] bg-[var(--dk-accent)]/10 text-white"
              : "border-[var(--dk-border-strong)] bg-[var(--dk-surface-2)] hover:border-[var(--dk-accent)]"
          }`}
        >
          {combo ? hotkeyLabel(combo) : t("recorder.noHotkey")}
        </button>
        {combo ? (
          <button
            type="button"
            title={t("recorder.removeHotkey")}
            aria-label={t("recorder.removeHotkey")}
            onClick={() => save(null)}
            className="rounded-md p-1 text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-white"
          >
            <X size={14} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => save(DEFAULT_HOTKEYS[id])}
            className="text-xs text-[var(--dk-accent-hover)] hover:underline"
          >
            {t("recorder.defaultHotkey")}
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2 rounded-xl border border-[var(--dk-border)] bg-[var(--dk-surface-2)] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Toggle
              label="Ctrl"
              on={draft.ctrl}
              onChange={(ctrl) => setDraft({ ...draft, ctrl })}
            />
            <Toggle label="Alt" on={draft.alt} onChange={(alt) => setDraft({ ...draft, alt })} />
            <Toggle
              label="Shift"
              on={draft.shift}
              onChange={(shift) => setDraft({ ...draft, shift })}
            />
            <span className="text-[var(--dk-text-muted)]">+</span>
            <Select
              className="w-36"
              value={draft.key}
              onChange={(key) => setDraft({ ...draft, key })}
              options={[
                { value: "", label: t("recorder.hotkeyPickKey") },
                ...HOTKEY_KEYS.map((k) => ({ value: k, label: hotkeyLabel(k) })),
              ]}
              ariaLabel={t("recorder.hotkeyPickKey")}
            />
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                {t("recorder.hotkeyCancel")}
              </Button>
              <Button
                size="sm"
                disabled={!("combo" in built)}
                onClick={() => {
                  if ("combo" in built) save(built.combo);
                }}
              >
                {t("recorder.hotkeyApply")}
              </Button>
            </div>
          </div>
          <p
            className={`text-xs ${
              problem || altGrRisk ? "text-[var(--dk-warning)]" : "text-[var(--dk-text-muted)]"
            }`}
          >
            {problem === "reserved"
              ? t("recorder.hotkeyReserved")
              : problem === "needsModifier"
                ? t("recorder.hotkeyNeedsModifier")
                : altGrRisk
                  ? t("recorder.hotkeyAltGrRisk")
                  : t("recorder.hotkeyEditHint")}
          </p>
          {free === true ? (
            <p className="flex items-center gap-1.5 text-xs text-[var(--dk-success)]">
              <CircleCheck size={13} />
              {t("recorder.hotkeyFree")}
            </p>
          ) : free === false ? (
            <p className="flex items-start gap-1.5 text-xs text-[var(--dk-warning)]">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {t("recorder.hotkeyBusy")}
            </p>
          ) : null}
          {suggestions.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--dk-text-muted)]">
              {t("recorder.hotkeySuggestions")}
              {suggestions.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setDraft(parseHotkey(c))}
                  className="rounded-md border border-[var(--dk-border-strong)] px-2 py-0.5 font-mono text-[11px] text-[var(--dk-text)] hover:border-[var(--dk-accent)]"
                >
                  {hotkeyLabel(c)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : error ? (
        <p className="text-right text-xs text-[var(--dk-warning)]">{error}</p>
      ) : null}
    </div>
  );
}
