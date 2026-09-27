import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useEditorStore, newClipId } from "../../store/editorStore";
import { formatCombo, useShortcutStore, type ShortcutAction } from "../../lib/shortcuts";
import { deleteTexts } from "../../lib/textItems";

/** Yazı bloğunun sağ tık menüsü: düzenle, çoğalt, sil. */
export function TextMenu({
  x,
  y,
  textId,
  onClose,
}: {
  x: number;
  y: number;
  textId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const map = useShortcutStore((s) => s.map);
  const item = useEditorStore((s) => s.texts.find((text) => text.id === textId));

  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [onClose]);

  if (!item) return null;
  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };
  const key = (action: ShortcutAction) => (map[action][0] ? formatCombo(map[action][0]) : "");
  const items: { label: string; shortcut?: string; action: () => void; danger?: boolean }[] = [
    {
      label: t("editor.editText"),
      action: () => {
        const store = useEditorStore.getState();
        store.selectText(textId);
        store.setPanelTab("clip");
      },
    },
    {
      label: t("editor.duplicate"),
      action: () => {
        const store = useEditorStore.getState();
        const length = item.end - item.start;
        // Kopya, özgünün hemen sonrasına yerleşir.
        store.applyTexts((texts) => [
          ...texts,
          { ...item, id: newClipId(), start: item.end, end: item.end + length },
        ]);
      },
    },
    {
      label: t("editor.deleteText"),
      shortcut: key("deleteClip"),
      action: () => {
        const store = useEditorStore.getState();
        store.applyTexts((texts) => deleteTexts(texts, [textId]));
        store.selectText(null);
      },
      danger: true,
    },
  ];

  return createPortal(
    <div
      className="fixed z-[60] w-52 rounded-xl border border-[var(--dk-border-strong)] bg-[var(--dk-surface-2)] p-1 shadow-2xl shadow-black/60"
      style={{
        left: Math.min(x, window.innerWidth - 220),
        top: Math.min(y, window.innerHeight - 140),
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          onClick={run(item.action)}
          className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-[var(--dk-accent)]/15 ${
            item.danger ? "text-[var(--dk-error)]" : "text-[var(--dk-text)]"
          }`}
        >
          <span className="flex-1">{item.label}</span>
          {item.shortcut ? (
            <span className="font-mono text-[11px] text-[var(--dk-text-muted)]">
              {item.shortcut}
            </span>
          ) : null}
        </button>
      ))}
    </div>,
    document.body,
  );
}
