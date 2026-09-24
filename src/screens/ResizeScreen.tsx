import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Maximize2, Smartphone } from "lucide-react";
import { usePrepareFile, useResizeFile } from "../store/localFileStore";
import { enqueueLocal } from "../lib/jobEngine";
import {
  ASPECT_RATIOS,
  PLATFORM_PRESETS,
  findPlatformPreset,
  resolveTargetSize,
  type AspectRatio,
  type FitMode,
} from "../types/resize";
import { LocalToolShell } from "../components/LocalToolShell";
import { ChoiceCards } from "../components/ui/ChoiceCards";
import { Select } from "../components/ui/Select";
import { PlatformIcon } from "../components/PlatformIcon";

const LONG_EDGES = [720, 1080, 1440, 1920, 2160];

/** "resize": oran + çözünürlük serbest; "platform": yalnızca hazır platform ayarları
 * (kenar çubuğundaki "Platforma Hazırla"). */
export function ResizeScreen({ variant }: { variant: "resize" | "platform" }) {
  const { t } = useTranslation();
  const isPlatform = variant === "platform";
  const [presetId, setPresetId] = useState<string | null>(isPlatform ? "tiktok" : null);
  const [ratio, setRatio] = useState<AspectRatio>(ASPECT_RATIOS[0]);
  const [longEdge, setLongEdge] = useState(1080);
  const [fitMode, setFitMode] = useState<FitMode>("crop");

  const preset = presetId ? findPlatformPreset(presetId) : undefined;
  const target = preset
    ? resolveTargetSize(preset.ratio, preset.longEdge)
    : resolveTargetSize(ratio, longEdge);

  const fitChoices = [
    { value: "crop" as const, title: t("resize.fitCrop"), desc: t("resize.fitCropDesc") },
    { value: "pad" as const, title: t("resize.fitPad"), desc: t("resize.fitPadDesc") },
  ];

  return (
    <LocalToolShell
      title={isPlatform ? t("prepare.title") : t("resize.title")}
      subtitle={isPlatform ? t("prepare.subtitle") : t("resize.subtitle")}
      icon={isPlatform ? <Smartphone size={24} /> : <Maximize2 size={24} />}
      useFile={isPlatform ? usePrepareFile : useResizeFile}
      startLabel={isPlatform ? t("prepare.button") : t("resize.resizeButton")}
      startIcon={isPlatform ? <Smartphone size={18} /> : <Maximize2 size={18} />}
      canStart={!isPlatform || preset !== undefined}
      summary={(info) =>
        t("resize.summary", {
          from: info.width && info.height ? `${info.width}×${info.height}` : "—",
          to: `${target.width}×${target.height}`,
        })
      }
      renderOptions={() => (
        <>
          <ChoiceCards
            label={t("resize.presets")}
            value={presetId}
            onChange={setPresetId}
            columns={isPlatform ? 5 : 5}
            choices={PLATFORM_PRESETS.map((p) => ({
              value: p.id,
              title: t(p.labelKey),
              desc: p.ratio.id,
              icon: <PlatformIcon platform={p.brand} size={26} />,
            }))}
          />
          {!isPlatform ? (
            <div className="grid gap-4 md:grid-cols-[1fr_200px]">
              <ChoiceCards
                label={t("resize.customRatio")}
                value={presetId ? null : ratio.id}
                onChange={(id) => {
                  const next = ASPECT_RATIOS.find((r) => r.id === id);
                  if (next) setRatio(next);
                  setPresetId(null);
                }}
                columns={5}
                choices={ASPECT_RATIOS.map((r) => ({ value: r.id, title: t(r.labelKey) }))}
              />
              <div>
                <p className="mb-2 text-sm text-[var(--dk-text-muted)]">{t("resize.resolution")}</p>
                <Select
                  value={longEdge}
                  disabled={presetId !== null}
                  options={LONG_EDGES.map((edge) => ({ value: edge, label: `${edge}p` }))}
                  onChange={setLongEdge}
                  ariaLabel={t("resize.resolution")}
                />
              </div>
            </div>
          ) : null}
          <ChoiceCards
            label={t("resize.fitMode")}
            value={fitMode}
            onChange={setFitMode}
            choices={fitChoices}
            columns={2}
          />
        </>
      )}
      onStart={(info, destinationDir) =>
        enqueueLocal(
          {
            kind: "resize",
            inputPath: info.filePath,
            destinationDir,
            targetWidth: target.width,
            targetHeight: target.height,
            fitMode,
          },
          info,
        )
      }
    />
  );
}
