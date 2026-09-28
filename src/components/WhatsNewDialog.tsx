import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Sparkles, Wrench, X } from "lucide-react";
import { useWhatsNewStore } from "../lib/whatsNew";
import { Button } from "./ui/Button";

/** Güncelleme (ya da ilk kurulum) sonrası ilk açılışta o sürümün yama notları. */
export function WhatsNewDialog() {
  const { t } = useTranslation();
  const version = useWhatsNewStore((s) => s.version);
  const notes = useWhatsNewStore((s) => s.notes);
  const close = useWhatsNewStore((s) => s.close);

  useEffect(() => {
    if (!version) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [version, close]);

  if (!version) return null;
  const empty = !notes || (notes.added.length === 0 && notes.fixed.length === 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("whatsNew.title", { version })}
        className="dk-card flex max-h-[80vh] w-full max-w-lg flex-col p-5 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <span className="dk-gradient flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white">
            <Sparkles size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-white">{t("whatsNew.title", { version })}</h2>
            <p className="mt-1 text-sm leading-relaxed text-[var(--dk-text-muted)]">
              {t("whatsNew.subtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label={t("clipboard.dismiss")}
            className="rounded-md p-1 text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-white"
          >
            <X size={17} />
          </button>
        </div>

        <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {empty ? (
            <p className="text-sm text-[var(--dk-text-muted)]">{t("whatsNew.empty")}</p>
          ) : (
            <>
              {notes.added.length > 0 ? (
                <Group title={t("whatsNew.added")} icon={<Plus size={14} />} items={notes.added} />
              ) : null}
              {notes.fixed.length > 0 ? (
                <Group title={t("whatsNew.fixed")} icon={<Wrench size={14} />} items={notes.fixed} />
              ) : null}
            </>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between gap-2 border-t border-[var(--dk-border)] pt-4">
          <p className="text-xs text-[var(--dk-text-muted)]">{t("whatsNew.readLater")}</p>
          <Button size="sm" onClick={close}>
            {t("whatsNew.gotIt")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Group({
  title,
  icon,
  items,
}: {
  title: string;
  icon: React.ReactNode;
  items: string[];
}) {
  return (
    <section>
      <h3 className="flex items-center gap-1.5 text-sm font-medium text-[var(--dk-accent-hover)]">
        {icon}
        {title}
      </h3>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-[var(--dk-text-muted)]">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
