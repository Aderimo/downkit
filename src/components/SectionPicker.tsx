import { useTranslation } from "react-i18next";
import { Clapperboard, Scissors } from "lucide-react";
import type { TimeRange } from "../lib/timeRange";
import { formatBytes } from "../lib/format";
import { Switch } from "./ui/Switch";
import { Button } from "./ui/Button";
import { TimeRangeEditor } from "./TimeRangeEditor";

interface SectionPickerProps {
  duration: number;
  section: TimeRange | null;
  onChange: (section: TimeRange | null) => void;
  /** Seçili bölümün tahmini boyutu (bayt). */
  estimatedBytes: number | null;
  /** Klip Düzenleyici'de aç: zaman çizelgesinde izleyerek, birden çok sahne seçerek. */
  onOpenEditor?: () => void;
}

/** "Videonun yalnızca bir bölümünü indir": 1 saatlik bir videodan istenen
 * sahneyi almak için tamamını indirmeye gerek kalmaz. */
export function SectionPicker({
  duration,
  section,
  onChange,
  estimatedBytes,
  onOpenEditor,
}: SectionPickerProps) {
  const { t } = useTranslation();

  function toggle(on: boolean) {
    // İlk açılışta ilk dakika (ya da daha kısa videolarda tamamı) seçilir.
    onChange(on ? { start: 0, end: Math.min(duration, 60) } : null);
  }

  return (
    <section data-tour="home-section" className={`dk-card p-4 ${section ? "dk-selected" : ""}`}>
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--dk-accent)]/15 text-[var(--dk-accent-hover)]">
          <Scissors size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-white">{t("section.title")}</p>
          <p className="text-xs text-[var(--dk-text-muted)]">{t("section.hint")}</p>
        </div>
        <Switch checked={section !== null} onChange={toggle} label={t("section.title")} />
      </div>

      {section ? (
        <div className="mt-4">
          <TimeRangeEditor
            duration={duration}
            value={section}
            onChange={onChange}
            extra={estimatedBytes ? `~${formatBytes(estimatedBytes)}` : null}
            actions={
              <>
                {onOpenEditor ? (
                  <Button size="sm" icon={<Clapperboard size={14} />} onClick={onOpenEditor}>
                    {t("section.pickInEditor")}
                  </Button>
                ) : null}
              </>
            }
          />
        </div>
      ) : null}
    </section>
  );
}
