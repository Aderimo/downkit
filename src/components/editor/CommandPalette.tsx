import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import {
  SHORTCUT_ACTIONS,
  formatCombo,
  useShortcutStore,
  type ShortcutAction,
} from "../../lib/shortcuts";
import { runShortcut } from "../../lib/editorActions";
import { useAddTool, useEditTool, type AddTool, type EditTool } from "../../lib/editorPanel";
import { useEditorStore } from "../../store/editorStore";

// Araç arama (Ctrl+K): panelleri açar ya da işlemleri çalıştırır. Bir yazıyla her şeye ulaşılır.

interface Command {
  id: string;
  label: string;
  group: string;
  shortcut?: string;
  run: () => void;
}

const ADD_TOOLS: AddTool[] = [
  "media",
  "templates",
  "text",
  "motion",
  "music",
  "images",
  "transitions",
  "subtitles",
  "autocut",
  "blur",
  "presets",
];
const EDIT_TOOLS: EditTool[] = ["clip", "filters", "color", "effects"];
const ADD_LABEL: Record<AddTool, string> = {
  media: "editor.toolMedia",
  templates: "editor.toolTemplates",
  text: "editor.toolText",
  motion: "motion.title",
  music: "editor.toolMusic",
  images: "editor.toolImages",
  transitions: "editor.toolTransitions",
  subtitles: "editor.toolSubtitles",
  autocut: "editor.toolAutoCut",
  blur: "editor.toolBlur",
  presets: "editor.toolPresets",
};
const EDIT_LABEL: Record<EditTool, string> = {
  clip: "editor.toolClip",
  filters: "editor.toolFilters",
  color: "editor.toolColor",
  effects: "editor.toolEffects",
};

/** Türkçe harfleri sadeleştirerek arar ("altyazi" → "Altyazı"). */
function normalizeSearch(text: string): string {
  return text
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function CommandPalette({ onClose, fps }: { onClose: () => void; fps: number | null }) {
  const { t } = useTranslation();
  const map = useShortcutStore((s) => s.map);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Command[]>(() => {
    const open = t("palette.groupOpen");
    const action = t("palette.groupAction");
    const list: Command[] = [
      ...ADD_TOOLS.map((tool) => ({
        id: `add-${tool}`,
        label: t(ADD_LABEL[tool]),
        group: open,
        run: () => useAddTool.getState().setTool(tool),
      })),
      ...EDIT_TOOLS.map((tool) => ({
        id: `edit-${tool}`,
        label: t(EDIT_LABEL[tool]),
        group: open,
        run: () => useEditTool.getState().setTool(tool),
      })),
      {
        id: "export",
        label: t("editor.exportButton"),
        group: open,
        run: () => useEditorStore.getState().setPanelTab("export"),
      },
      ...SHORTCUT_ACTIONS.map((a: ShortcutAction) => ({
        id: `do-${a}`,
        label: t(`shortcuts.action.${a}`),
        group: action,
        shortcut: map[a][0] ? formatCombo(map[a][0]) : undefined,
        run: () => void runShortcut(a, fps),
      })),
    ];
    return list;
  }, [t, map, fps]);

  const shown = useMemo(() => {
    const q = normalizeSearch(query.trim());
    if (!q) return commands;
    const words = q.split(/\s+/);
    return commands.filter((c) => {
      const hay = normalizeSearch(`${c.label} ${c.group}`);
      return words.every((w) => hay.includes(w));
    });
  }, [commands, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const pick = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    // Pencere kapandıktan sonra çalışsın (kısayol işleyicisi açık pencerede tuş almaz).
    requestAnimationFrame(() => c.run());
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-6 pt-[12vh] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t("palette.title")}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dk-card w-full max-w-lg overflow-hidden shadow-2xl shadow-black/60">
        <label className="flex items-center gap-2 border-b border-[var(--dk-border)] px-4">
          <Search size={16} className="text-[var(--dk-text-muted)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(shown.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                pick(shown[index]);
              }
            }}
            placeholder={t("palette.placeholder")}
            aria-label={t("palette.title")}
            className="h-12 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
        <ul className="dk-scroll max-h-[50vh] overflow-y-auto p-1" role="listbox" data-palette-list>
          {shown.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-[var(--dk-text-muted)]">
              {t("palette.empty")}
            </li>
          ) : null}
          {shown.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === index}>
              <button
                type="button"
                onMouseEnter={() => setIndex(i)}
                onClick={() => pick(c)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${
                  i === index ? "bg-[var(--dk-accent)]/20" : ""
                }`}
              >
                <span className="flex-1">{c.label}</span>
                <span className="text-[11px] text-[var(--dk-text-muted)]">{c.group}</span>
                {c.shortcut ? (
                  <kbd className="rounded bg-[var(--dk-bg)] px-1.5 font-mono text-[10px]">
                    {c.shortcut}
                  </kbd>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
