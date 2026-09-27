import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Keyboard, Plus, RotateCcw, X } from "lucide-react";
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_GROUPS,
  comboFromEvent,
  formatCombo,
  useShortcutStore,
  type ShortcutAction,
} from "../../lib/shortcuts";
import { Button } from "../ui/Button";

/** Kısayolları görme ve düzenleme: tuş ekle, kaldır, varsayılana döndür. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const map = useShortcutStore((s) => s.map);
  const assign = useShortcutStore((s) => s.assign);
  const remove = useShortcutStore((s) => s.remove);
  const resetAction = useShortcutStore((s) => s.resetAction);
  const resetAll = useShortcutStore((s) => s.resetAll);
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Pencere açıkken tuşlar düzenleyiciye gitmez; kayıt sırasında basılan tuş atanır.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (recording) {
        e.preventDefault();
        if (e.key === "Escape") {
          setRecording(null);
          return;
        }
        const combo = comboFromEvent(e);
        if (!combo) return;
        const taken = assign(recording, combo);
        setNotice(
          taken
            ? t("shortcuts.moved", {
                combo: formatCombo(combo),
                from: t(`shortcuts.action.${taken}`),
                to: t(`shortcuts.action.${recording}`),
              })
            : null,
        );
        setRecording(null);
        return;
      }
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, assign, onClose, t]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t("shortcuts.title")}
    >
      <div className="dk-card flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden shadow-2xl shadow-black/60">
        <header className="flex items-start gap-3 border-b border-[var(--dk-border)] px-5 py-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--dk-accent)]/15 text-[var(--dk-accent-hover)]">
            <Keyboard size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">{t("shortcuts.title")}</h2>
            <p className="text-xs text-[var(--dk-text-muted)]">{t("shortcuts.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("media.close")}
            className="rounded-lg p-1.5 text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-white"
          >
            <X size={18} />
          </button>
        </header>

        <div className="dk-scroll min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.id}>
              <p className="mb-2 text-xs font-medium text-[var(--dk-text-muted)] uppercase">
                {t(`shortcuts.group.${group.id}`)}
              </p>
              <div className="divide-y divide-[var(--dk-border)] rounded-xl border border-[var(--dk-border)]">
                {group.actions.map((action) => {
                  const custom =
                    JSON.stringify(map[action]) !== JSON.stringify(DEFAULT_SHORTCUTS[action]);
                  return (
                    <div key={action} className="flex items-center gap-3 px-3 py-2">
                      <p className="min-w-0 flex-1 text-sm">{t(`shortcuts.action.${action}`)}</p>
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {map[action].map((combo) => (
                          <span
                            key={combo}
                            className="group inline-flex items-center gap-1 rounded-lg border border-[var(--dk-border-strong)] bg-[var(--dk-bg)] py-0.5 pr-1 pl-2 font-mono text-xs"
                          >
                            {formatCombo(combo)}
                            <button
                              type="button"
                              onClick={() => remove(action, combo)}
                              aria-label={t("shortcuts.remove", { combo: formatCombo(combo) })}
                              title={t("shortcuts.remove", { combo: formatCombo(combo) })}
                              className="rounded p-0.5 text-[var(--dk-text-muted)] hover:bg-white/10 hover:text-[var(--dk-error)]"
                            >
                              <X size={12} />
                            </button>
                          </span>
                        ))}
                        {recording === action ? (
                          <span className="animate-pulse rounded-lg border border-[var(--dk-accent)] bg-[var(--dk-accent)]/15 px-2 py-0.5 text-xs text-[var(--dk-accent-hover)]">
                            {t("shortcuts.pressKey")}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setNotice(null);
                              setRecording(action);
                            }}
                            title={t("shortcuts.add")}
                            aria-label={t("shortcuts.add")}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-dashed border-[var(--dk-border-strong)] text-[var(--dk-text-muted)] hover:border-[var(--dk-accent)] hover:text-[var(--dk-accent-hover)]"
                          >
                            <Plus size={13} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => resetAction(action)}
                          disabled={!custom}
                          title={t("shortcuts.resetOne")}
                          aria-label={t("shortcuts.resetOne")}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-[var(--dk-text-muted)] hover:text-[var(--dk-text)] disabled:opacity-0"
                        >
                          <RotateCcw size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
          <p className="text-xs text-[var(--dk-text-muted)]">{t("shortcuts.mouseHint")}</p>
        </div>

        <footer className="flex items-center gap-3 border-t border-[var(--dk-border)] px-5 py-3">
          <p className="min-w-0 flex-1 text-xs text-[var(--dk-warning)]">{notice}</p>
          <Button variant="ghost" size="sm" icon={<RotateCcw size={14} />} onClick={resetAll}>
            {t("shortcuts.resetAll")}
          </Button>
          <Button size="sm" onClick={onClose}>
            {t("shortcuts.done")}
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
