import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Scissors } from "lucide-react";
import { useTrimFile } from "../store/localFileStore";
import { enqueueLocal } from "../lib/jobEngine";
import { formatClock, type TimeRange } from "../lib/timeRange";
import type { LocalMediaInfo } from "../types/convert";
import { LocalToolShell } from "../components/LocalToolShell";
import { TimeRangeEditor } from "../components/TimeRangeEditor";
import { ChoiceCards } from "../components/ui/ChoiceCards";

type CutMode = "fast" | "precise";

/** Video Kes: bilgisayardaki bir videodan seçilen aralığı yeni dosyaya çıkarır.
 * Linkten bölüm indirmek için Ana Sayfa'daki "bölüm indir" kullanılır. */
export function TrimScreen() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<CutMode>("fast");
  // Her dosyanın aralığı ayrı tutulur; başka dosya seçip dönünce seçim kaybolmaz.
  const [ranges, setRanges] = useState<Record<string, TimeRange>>({});
  const info = useTrimFile((s) => s.info);

  const rangeFor = (file: LocalMediaInfo): TimeRange =>
    ranges[file.filePath] ?? { start: 0, end: file.durationSeconds ?? 0 };

  return (
    <LocalToolShell
      title={t("trim.title")}
      subtitle={t("trim.subtitle")}
      icon={<Scissors size={24} />}
      useFile={useTrimFile}
      startLabel={t("trim.button")}
      startIcon={<Scissors size={18} />}
      canStart={!!info?.durationSeconds}
      summary={(file) => {
        if (!file.durationSeconds) return null;
        const range = rangeFor(file);
        return t("trim.summary", {
          from: formatClock(range.start),
          to: formatClock(range.end),
          length: formatClock(range.end - range.start),
        });
      }}
      renderOptions={(file) =>
        file.durationSeconds ? (
          <div className="space-y-5">
            <TimeRangeEditor
              duration={file.durationSeconds}
              value={rangeFor(file)}
              onChange={(range) => setRanges((prev) => ({ ...prev, [file.filePath]: range }))}
            />
            <ChoiceCards
              value={mode}
              onChange={setMode}
              columns={2}
              choices={[
                { value: "fast", title: t("trim.fast"), desc: t("trim.fastDesc") },
                { value: "precise", title: t("trim.precise"), desc: t("trim.preciseDesc") },
              ]}
            />
          </div>
        ) : (
          <p className="text-sm text-[var(--dk-warning)]">{t("trim.noDuration")}</p>
        )
      }
      onStart={(file, destinationDir) => {
        const range = rangeFor(file);
        return enqueueLocal(
          {
            kind: "trim",
            inputPath: file.filePath,
            destinationDir,
            startSeconds: range.start,
            endSeconds: range.end,
            precise: mode === "precise",
          },
          file,
        );
      }}
    />
  );
}
