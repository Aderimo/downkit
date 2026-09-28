import { useTranslation } from "react-i18next";
import { Plus, Wrench } from "lucide-react";
import { RELEASE_NOTES } from "../lib/releaseNotes";

/** Ayarlar → Yama notları: tüm sürümlerin yenilik ve düzeltme listesi. */
export function PatchNotesPanel() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("tr") ? "tr" : "en";

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {RELEASE_NOTES.map((note) => {
        const n = note[lang];
        return (
          <article
            key={note.version}
            className="rounded-xl border border-[var(--dk-border)] bg-[var(--dk-surface-2)] p-4"
          >
            <header className="flex flex-wrap items-baseline gap-2">
              <h3 className="text-sm font-semibold text-white">v{note.version}</h3>
              <time className="text-xs text-[var(--dk-text-muted)]">
                {new Date(`${note.date}T00:00:00`).toLocaleDateString(i18n.language, {
                  dateStyle: "medium",
                })}
              </time>
            </header>
            {n.added.length > 0 ? (
              <List title={t("settings.notesAdded")} icon={<Plus size={13} />} items={n.added} />
            ) : null}
            {n.fixed.length > 0 ? (
              <List title={t("settings.notesFixed")} icon={<Wrench size={13} />} items={n.fixed} />
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function List({ title, icon, items }: { title: string; icon: React.ReactNode; items: string[] }) {
  return (
    <div className="mt-2.5">
      <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--dk-accent-hover)]">
        {icon}
        {title}
      </p>
      <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs leading-relaxed text-[var(--dk-text-muted)]">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
