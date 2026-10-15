import { useTranslation } from "react-i18next";
import {
  ArrowDownToLine,
  ChevronRight,
  Maximize2,
  RefreshCw,
  Shrink,
  type LucideIcon,
} from "lucide-react";
import type { WorkspaceAction } from "../store/workspaceStore";

interface ActionCardDef {
  action: WorkspaceAction;
  icon: LucideIcon;
  titleKey: string;
  descKey: string;
  buttonKey: string;
}

const CARDS: ActionCardDef[] = [
  {
    action: "download",
    icon: ArrowDownToLine,
    titleKey: "actions.downloadTitle",
    descKey: "actions.downloadDesc",
    buttonKey: "actions.downloadButton",
  },
  {
    action: "convert",
    icon: RefreshCw,
    titleKey: "actions.convertTitle",
    descKey: "actions.convertDesc",
    buttonKey: "actions.convertButton",
  },
  {
    action: "compress",
    icon: Shrink,
    titleKey: "actions.compressTitle",
    descKey: "actions.compressDesc",
    buttonKey: "actions.compressButton",
  },
  {
    action: "resize",
    icon: Maximize2,
    titleKey: "actions.resizeTitle",
    descKey: "actions.resizeDesc",
    buttonKey: "actions.resizeButton",
  },
];

interface ActionCardsProps {
  selected: WorkspaceAction;
  /** Kart gövdesine tıklanınca: işlemi seç. */
  onSelect: (action: WorkspaceAction) => void;
  /** Karttaki düğmeye tıklanınca: seç ve (mümkünse) başlat. */
  onRun: (action: WorkspaceAction) => void;
}

export function ActionCards({ selected, onSelect, onRun }: ActionCardsProps) {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      {CARDS.map((card) => {
        const active = card.action === selected;
        const Icon = card.icon;
        return (
          <div
            key={card.action}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(card.action)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(card.action);
              }
            }}
            className={`dk-card flex cursor-pointer flex-col gap-3 p-5 text-left transition-all hover:border-[var(--dk-border-strong)] ${
              active
                ? "dk-selected bg-[linear-gradient(180deg,color-mix(in_srgb,var(--dk-accent)_14%,transparent),transparent)]"
                : ""
            }`}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--dk-accent)_16%,transparent)] text-[var(--dk-accent-hover)]">
              <Icon size={22} />
            </span>
            <div className="flex-1">
              <p className="text-base font-semibold text-[var(--dk-text)]">{t(card.titleKey)}</p>
              <p className="mt-1 text-sm leading-snug text-[var(--dk-text-muted)]">
                {t(card.descKey)}
              </p>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRun(card.action);
              }}
              className={`flex h-10 items-center justify-between rounded-xl px-4 text-sm font-medium transition ${
                active
                  ? "dk-gradient text-white shadow-[0_8px_24px_-12px_color-mix(in_srgb,var(--dk-accent)_90%,transparent)] hover:brightness-110"
                  : "border border-[var(--dk-border-strong)] bg-[var(--dk-surface-2)] text-[var(--dk-accent-hover)] hover:border-[var(--dk-accent)]"
              }`}
            >
              {t(card.buttonKey)}
              <ChevronRight size={17} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
