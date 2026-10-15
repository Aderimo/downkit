import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Plus, Wrench } from "lucide-react";
import { RELEASE_NOTES } from "../lib/releaseNotes";
import { releasePageUrl } from "../lib/links";
import { openExternalLink } from "../lib/tauri-api";

/** Ayarlar → Yama notları: tek kutu, içinde aşağı kaydırılır, en yeni sürüm en üstte.
 * Sürüm başlığına tıklayınca sitedeki sürüm sayfasına gitmek için onay sorulur. */
export function PatchNotesPanel() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("tr") ? "tr" : "en";
  const [asking, setAsking] = useState<string | null>(null);

  return (
    <div
      className="max-h-[420px] overflow-y-auto rounded-xl border border-[var(--dk-border-strong)] bg-[var(--dk-surface-2)]"
      tabIndex={0}
      aria-label={t("settings.releaseNotes")}
    >
      {RELEASE_NOTES.map((note, index) => {
        const n = note[lang];
        return (
          <article
            key={note.version}
            className={`p-4 ${index > 0 ? "border-t border-[var(--dk-border)]" : ""}`}
          >
            <header className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setAsking(asking === note.version ? null : note.version)}
                aria-expanded={asking === note.version}
                title={t("settings.notesOpenPage")}
                className="flex items-center gap-1.5 rounded-md text-sm font-bold text-white hover:text-[var(--dk-accent-hover)]"
              >
                v{note.version}
                <ExternalLink size={12} className="opacity-60" />
              </button>
              {index === 0 ? (
                <span className="rounded-full bg-[var(--dk-accent-2)] px-2 py-0.5 text-[10px] font-bold text-[#111]">
                  {t("settings.notesLatest")}
                </span>
              ) : null}
              <time className="text-xs text-[var(--dk-text-muted)]">
                {new Date(`${note.date}T00:00:00`).toLocaleDateString(i18n.language, {
                  dateStyle: "medium",
                })}
              </time>
            </header>
            {asking === note.version ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--dk-border-strong)] bg-[var(--dk-surface)] px-3 py-2 text-xs text-[var(--dk-text)]">
                <span className="mr-auto">
                  {t("settings.notesAskOpen", { version: note.version })}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setAsking(null);
                    void openExternalLink(releasePageUrl(note.version));
                  }}
                  className="rounded-md bg-[var(--dk-accent)] px-3 py-1 font-semibold text-white"
                >
                  {t("settings.notesGo")}
                </button>
                <button
                  type="button"
                  onClick={() => setAsking(null)}
                  className="rounded-md px-3 py-1 text-[var(--dk-text-muted)] hover:bg-white/5"
                >
                  {t("common.cancel")}
                </button>
              </div>
            ) : null}
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
