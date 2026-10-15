import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { HelpTip } from "../ui/HelpTip";

// Sağ paneldeki katlanabilir bölüm. Hangi bölümün açık olduğu bu bilgisayarda hatırlanır.

const STORAGE_KEY = "downkit.panelSections";

function readOpen(): Record<string, boolean> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as unknown;
    return raw && typeof raw === "object" ? (raw as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeOpen(id: string, open: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readOpen(), [id]: open }));
  } catch {
    // Saklanamazsa yalnızca bu oturumda geçerli.
  }
}

export function PanelSection({
  id,
  title,
  icon,
  summary,
  defaultOpen = true,
  tour,
  help,
  children,
}: {
  id: string;
  title: string;
  icon?: ReactNode;
  /** Kapalıyken de görünen kısa değer (ör. "1.5×"). */
  summary?: ReactNode;
  defaultOpen?: boolean;
  tour?: string;
  /** Açıklama: başlığın yanındaki "?" baloncuğunda (ekranda yer kaplamaz). */
  help?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => readOpen()[id] ?? defaultOpen);
  return (
    <section
      className="rounded-xl border border-[var(--dk-border)]"
      data-tour={tour}
      data-panel-section={id}
    >
      <div className="flex items-center hover:bg-white/5">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
            writeOpen(id, !open);
          }}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm font-medium"
        >
          {icon ? <span className="text-[var(--dk-accent-hover)]">{icon}</span> : null}
          <span className="flex-1">{title}</span>
          {summary ? (
            <span className="rounded-md bg-[var(--dk-bg)] px-1.5 py-0.5 font-mono text-xs">
              {summary}
            </span>
          ) : null}
          <ChevronDown
            size={15}
            className={`shrink-0 text-[var(--dk-text-muted)] transition-transform ${open ? "" : "-rotate-90"}`}
          />
        </button>
        {help ? (
          <span className="pr-2.5">
            <HelpTip title={title} text={help} />
          </span>
        ) : null}
      </div>
      {open ? (
        <div className="space-y-3 border-t border-[var(--dk-border)] p-3">{children}</div>
      ) : null}
    </section>
  );
}
