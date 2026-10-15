import { useTranslation } from "react-i18next";
import { ContextMenu } from "../ui/ContextMenu";
import { duplicateLayer } from "../../lib/layerActions";
import { toggleAudioLink } from "../../lib/editorActions";
import { useEditorStore } from "../../store/editorStore";
import type { LaneKind } from "../../lib/laneItems";

/** Müzik, resim, gizleme ve efekt bloklarının sağ tık menüsü. */
export function LaneMenu({
  x,
  y,
  kind,
  id,
  onClose,
  onOpen,
  onRemove,
}: {
  x: number;
  y: number;
  kind: LaneKind;
  id: string;
  onClose: () => void;
  onOpen: (kind: LaneKind) => void;
  onRemove: (kind: LaneKind, id: string) => void;
}) {
  const { t } = useTranslation();
  const linked = useEditorStore((s) =>
    kind === "music" ? s.music.find((m) => m.id === id)?.linkedClipId : undefined,
  );
  const items: { label: string; action: () => void; danger?: boolean }[] = [
    { label: t(`laneMenu.settings.${kind}`), action: () => onOpen(kind) },
    { label: t("laneMenu.duplicate"), action: () => duplicateLayer(kind, id) },
    ...(linked
      ? [
          {
            label: t("laneMenu.reattach"),
            action: () => {
              useEditorStore.getState().select([linked]);
              toggleAudioLink();
            },
          },
        ]
      : []),
    { label: t("laneMenu.delete"), action: () => onRemove(kind, id), danger: true },
  ];
  return (
    <ContextMenu x={x} y={y} width={200} onClose={onClose}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          onClick={() => {
            item.action();
            onClose();
          }}
          className={`flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-[var(--dk-accent)]/15 ${
            item.danger ? "text-[var(--dk-error)]" : "text-[var(--dk-text)]"
          }`}
        >
          {item.label}
        </button>
      ))}
    </ContextMenu>
  );
}
