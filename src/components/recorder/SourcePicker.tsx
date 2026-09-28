import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppWindow, Check, Minimize2, Monitor, RefreshCw, X } from "lucide-react";
import { useRecorderStore } from "../../store/recorderStore";
import { useRecorderSettings, type RecorderSource } from "../../lib/recorderSettings";
import { refreshSources } from "../../lib/recorder";
import { monitorLabel, resolveMonitors, resolveSource } from "../../lib/recorderLogic";
import { recorderSourceThumbs } from "../../lib/tauri-api";
import type { MonitorInfo, WindowInfo } from "../../types/recorder";
import { Button } from "../ui/Button";

type Tab = "screens" | "windows";

interface Card {
  key: string;
  source: RecorderSource;
  title: string;
  subtitle: string;
  thumb: string | null;
  minimized?: boolean;
  selected: boolean;
}

function sameSource(a: RecorderSource, b: RecorderSource): boolean {
  if (a.kind === "monitor" && b.kind === "monitor") return a.number === b.number;
  if (a.kind === "window" && b.kind === "window") return a.exe === b.exe && a.title === b.title;
  return false;
}

/** Şu anki kaynaktan seçili ekran numaraları (çoklu seçimin başlangıcı). */
function currentNumbers(source: RecorderSource, monitors: MonitorInfo[]): number[] {
  if (source.kind === "monitors") {
    return resolveMonitors(source.numbers, {
      monitors,
      windows: [],
      microphones: [],
      speakers: [],
    }).map((m) => m.number);
  }
  if (source.kind === "monitor") {
    const item = resolveSource(source, {
      monitors,
      windows: [],
      microphones: [],
      speakers: [],
    });
    return item && "hmonitor" in item ? [item.number] : [];
  }
  return [];
}

/** Discord'un ekran paylaşımındaki gibi: ekranlar ve pencereler küçük önizlemeleriyle.
 * Ekranlar sekmesinde birden çok ekran seçilebilir (yan yana tek kayıt olur). */
export function SourcePicker({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const sources = useRecorderStore((s) => s.sources);
  const current = useRecorderSettings((s) => s.source);
  const update = useRecorderSettings((s) => s.update);
  const [tab, setTab] = useState<Tab>(current.kind === "window" ? "windows" : "screens");
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  // Ekranlar sekmesindeki taslak seçim (numaralar); null: kayıtlı kaynaktan türetilir.
  const [draft, setDraft] = useState<number[] | null>(null);

  // Kaynaklar yenilenir, sonra önizlemeler alınır. Tauri dışında (tarayıcı
  // önizlemesi) önizleme yok; simgeler gösterilir.
  const load = useCallback(
    () =>
      refreshSources()
        .then(() => recorderSourceThumbs(320))
        .then(setThumbs)
        .catch(() => {})
        .finally(() => setLoading(false)),
    [],
  );

  // Yalnızca açılışta bir kez yüklenir. (onClose her çizimde yeni bir işlev
  // olduğu için bağımlılık yapılırsa yenileme → yeniden çizim → yeniden yükleme
  // döngüsüne girer ve bilgisayar kasar.)
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    void load();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [load]);

  const monitors = sources?.monitors ?? [];
  const picked = draft ?? currentNumbers(current, monitors);
  const resolved = sources ? resolveSource(current, sources) : null;

  // Her ekran bir kez: birincil "Ana ekran", ötekiler masaüstü sırasıyla "2. ekran"…
  const screens: Card[] = monitors.map((m) => ({
    key: `m:${m.hmonitor}`,
    source: { kind: "monitor", number: m.number },
    title: monitorLabel(m, t),
    subtitle: `${m.width}×${m.height}`,
    thumb: thumbs[`m:${m.hmonitor}`] ?? null,
    selected: picked.includes(m.number),
  }));
  const windows: Card[] = (sources?.windows ?? [])
    .filter((w: WindowInfo) => !w.own)
    .map((w) => {
      const source: RecorderSource = { kind: "window", exe: w.exe, title: w.title };
      return {
        key: `w:${w.hwnd}`,
        source,
        title: w.title,
        subtitle: w.exe,
        thumb: thumbs[`w:${w.hwnd}`] ?? null,
        minimized: w.minimized,
        selected:
          sameSource(current, source) ||
          (!!resolved && "hwnd" in resolved && resolved.hwnd === w.hwnd),
      };
    });
  const cards = tab === "screens" ? screens : windows;

  function toggleScreen(number: number) {
    const next = picked.includes(number)
      ? picked.filter((n) => n !== number)
      : [...picked, number];
    setDraft(next);
  }

  function applyScreens() {
    const numbers = monitors.map((m) => m.number).filter((n) => picked.includes(n));
    if (numbers.length === 0) return;
    update({
      source:
        numbers.length === 1
          ? { kind: "monitor", number: numbers[0] }
          : { kind: "monitors", numbers },
    });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("recorder.whatToRecord")}
        className="dk-card flex max-h-[85vh] w-full max-w-4xl flex-col gap-4 p-5 shadow-2xl"
      >
        <div className="flex items-center gap-3">
          <h2 className="flex-1 text-lg font-semibold text-white">{t("recorder.whatToRecord")}</h2>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              void load();
            }}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--dk-border-strong)] px-2.5 py-1.5 text-xs hover:border-[var(--dk-accent)] disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            {t("recorder.refreshSources")}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("clipboard.dismiss")}
            className="rounded-md p-1.5 text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex gap-1 rounded-xl bg-[var(--dk-bg)] p-1" role="tablist">
          {(
            [
              ["screens", t("recorder.screens"), <Monitor key="m" size={15} />, screens.length],
              ["windows", t("recorder.windows"), <AppWindow key="w" size={15} />, windows.length],
            ] as const
          ).map(([id, label, icon, count]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                tab === id
                  ? "dk-gradient font-semibold text-white"
                  : "text-[var(--dk-text-muted)] hover:text-white"
              }`}
            >
              {icon}
              {label}
              <span className="text-xs opacity-70">{count}</span>
            </button>
          ))}
        </div>

        <div className="dk-scroll -mx-1 grid min-h-40 grid-cols-2 gap-3 overflow-y-auto px-1 pb-1 sm:grid-cols-3">
          {cards.length === 0 ? (
            <p className="col-span-full py-10 text-center text-sm text-[var(--dk-text-muted)]">
              {loading ? t("recorder.loadingSources") : t("recorder.noWindows")}
            </p>
          ) : null}
          {cards.map((card) => (
            <button
              key={card.key}
              type="button"
              aria-pressed={card.selected}
              onClick={() => {
                // Birden çok ekran varsa ekranlar seçim biriktirir (alt bardaki
                // Uygula düğmesiyle onaylanır); tek ekran ya da pencere
                // tıklanınca hemen uygulanır ve seçici kapanır.
                if (tab === "screens" && card.source.kind === "monitor" && monitors.length > 1) {
                  toggleScreen(card.source.number);
                } else {
                  update({ source: card.source });
                  onClose();
                }
              }}
              className={`group relative flex flex-col gap-2 rounded-xl border bg-[var(--dk-surface-2)] p-2 text-left transition hover:border-[var(--dk-accent)] ${
                card.selected ? "dk-selected" : "border-[var(--dk-border)]"
              }`}
            >
              <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-black">
                {card.thumb ? (
                  <img src={card.thumb} alt="" className="h-full w-full object-contain" />
                ) : (
                  <span className="flex flex-col items-center gap-1.5 text-white/50">
                    {card.minimized ? (
                      <Minimize2 size={26} />
                    ) : tab === "screens" ? (
                      <Monitor size={30} />
                    ) : (
                      <AppWindow size={30} />
                    )}
                    {card.minimized ? (
                      <span className="text-[11px]">{t("recorder.minimized")}</span>
                    ) : null}
                  </span>
                )}
                {card.selected ? (
                  <span className="dk-gradient absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full text-white shadow">
                    <Check size={14} strokeWidth={3} />
                  </span>
                ) : null}
              </div>
              <span className="min-w-0 px-0.5">
                <span className="block truncate text-sm font-medium text-white">{card.title}</span>
                <span className="block truncate text-[11px] text-[var(--dk-text-muted)]">
                  {card.subtitle}
                </span>
              </span>
            </button>
          ))}
        </div>

        {tab === "screens" && monitors.length > 1 ? (
          <div className="flex items-center gap-3 border-t border-[var(--dk-border)] pt-3">
            <p className="min-w-0 flex-1 text-xs text-[var(--dk-text-muted)]">
              {picked.length > 1
                ? t("recorder.screensSelected", { count: picked.length })
                : t("recorder.screensPickHint")}
            </p>
            <Button size="sm" disabled={picked.length === 0} onClick={applyScreens}>
              {t("recorder.applySource")}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
