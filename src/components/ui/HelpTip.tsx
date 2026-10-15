import { CircleHelp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tip } from "./Tip";

/** Başlığın yanındaki "?" : açıklama ekrana gömülmez, üzerine gelince açılır. */
export function HelpTip({ title, text }: { title: string; text: string }) {
  const { t } = useTranslation();
  return (
    <Tip label={title} description={text} side="bottom" instant>
      <button
        type="button"
        aria-label={t("common.helpFor", { title })}
        data-help={title}
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--dk-text-muted)] hover:text-white focus-visible:text-white"
      >
        <CircleHelp size={13} />
      </button>
    </Tip>
  );
}
