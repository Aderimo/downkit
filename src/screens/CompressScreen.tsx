import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Shrink } from "lucide-react";
import { useCompressFile } from "../store/localFileStore";
import { enqueueLocal } from "../lib/jobEngine";
import { formatBytes } from "../lib/format";
import {
  FPS_LIMITS,
  PRESET_MAX_SHORT_SIDE,
  RESOLUTION_LIMITS,
  estimateOutputSizeBytes,
  resolutionLabel,
  scaledSize,
  targetPlan,
  type CompressMode,
  type CompressPreset,
} from "../types/compress";
import type { LocalMediaInfo } from "../types/convert";
import { LocalToolShell } from "../components/LocalToolShell";
import { ChoiceCards } from "../components/ui/ChoiceCards";
import { Tabs } from "../components/ui/Tabs";
import { Select } from "../components/ui/Select";

const QUICK_TARGETS = [8, 10, 25, 50, 100];

export function CompressScreen() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<CompressMode>("preset");
  const [preset, setPreset] = useState<CompressPreset>("balanced");
  const [targetMb, setTargetMb] = useState<number | null>(null);
  // Gelişmiş: 0 = otomatik (seviyeye ya da hedef boyuta göre).
  const [maxShortSide, setMaxShortSide] = useState(0);
  const [maxFps, setMaxFps] = useState(0);

  function estimate(info: LocalMediaInfo): number | null {
    if (mode !== "targetSize" || !targetMb || !info.durationSeconds) return null;
    const plan = targetPlan(targetMb * 1024 * 1024, info.durationSeconds);
    return estimateOutputSizeBytes(plan, info.durationSeconds);
  }

  /** Çıkacak çözünürlük: "1440p → 720p"; küçültme yoksa yalnızca mevcut çözünürlük. */
  function resolutionNote(info: LocalMediaInfo): string | null {
    if (!info.width || !info.height) return null;
    const limit =
      maxShortSide > 0
        ? maxShortSide
        : mode === "preset"
          ? PRESET_MAX_SHORT_SIDE[preset]
          : targetMb && info.durationSeconds
            ? targetPlan(targetMb * 1024 * 1024, info.durationSeconds).maxShortSide
            : null;
    if (limit === null) return null;
    const from = resolutionLabel(info.width, info.height);
    const scaled = scaledSize(info.width, info.height, limit);
    return scaled
      ? t("compress.resolutionDown", { from, to: resolutionLabel(scaled.width, scaled.height) })
      : t("compress.resolutionKept", { resolution: from });
  }

  return (
    <LocalToolShell
      title={t("compress.title")}
      subtitle={t("compress.subtitle")}
      icon={<Shrink size={24} />}
      useFile={useCompressFile}
      startLabel={t("compress.compressButton")}
      startIcon={<Shrink size={18} />}
      canStart={mode === "preset" || (targetMb !== null && targetMb > 0)}
      summary={(info) => {
        const est = estimate(info);
        const resolution = resolutionNote(info);
        const base = est
          ? t("compress.summaryTarget", {
              from: formatBytes(info.fileSizeBytes),
              to: formatBytes(est),
              reduction: Math.max(0, Math.round((1 - est / info.fileSizeBytes) * 100)),
            })
          : t("compress.summaryPreset", { size: formatBytes(info.fileSizeBytes) });
        return resolution ? `${base} · ${resolution}` : base;
      }}
      renderOptions={(info) => {
        const est = estimate(info);
        const tooSmall = est !== null && targetMb !== null && est > targetMb * 1024 * 1024 * 1.05;
        return (
          <>
            <Tabs
              value={mode}
              onChange={setMode}
              items={[
                { value: "preset", label: t("compress.modePreset") },
                { value: "targetSize", label: t("compress.modeTargetSize") },
              ]}
            />
            {mode === "preset" ? (
              <ChoiceCards
                value={preset}
                onChange={setPreset}
                columns={2}
                choices={[
                  {
                    value: "high",
                    title: t("compress.presetHigh"),
                    desc: t("compress.presetHighDesc"),
                  },
                  {
                    value: "balanced",
                    title: t("compress.presetBalanced"),
                    desc: t("compress.presetBalancedDesc"),
                  },
                  {
                    value: "small",
                    title: t("compress.presetSmall"),
                    desc: t("compress.presetSmallDesc"),
                  },
                  {
                    value: "tiny",
                    title: t("compress.presetTiny"),
                    desc: t("compress.presetTinyDesc"),
                  },
                ]}
              />
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  {QUICK_TARGETS.map((mb) => (
                    <button
                      key={mb}
                      type="button"
                      onClick={() => setTargetMb(mb)}
                      className={`rounded-lg border px-3 py-1.5 text-sm ${
                        targetMb === mb
                          ? "border-[var(--dk-accent)] bg-[var(--dk-accent)]/15 text-white"
                          : "border-[var(--dk-border)] text-[var(--dk-text-muted)] hover:text-white"
                      }`}
                    >
                      {mb} MB
                    </button>
                  ))}
                  <label className="flex items-center gap-2 text-sm text-[var(--dk-text-muted)]">
                    {t("compress.targetSizeLabel")}
                    <input
                      type="number"
                      min={1}
                      value={targetMb ?? ""}
                      onChange={(e) => {
                        const mb = Number(e.target.value);
                        setTargetMb(Number.isFinite(mb) && mb > 0 ? mb : null);
                      }}
                      className="h-9 w-24 rounded-lg border border-[var(--dk-border)] bg-[var(--dk-surface-2)] px-2 text-white outline-none focus:border-[var(--dk-accent)]"
                    />
                  </label>
                </div>
                {est !== null ? (
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <Stat label={t("compress.original")} value={formatBytes(info.fileSizeBytes)} />
                    <Stat label={t("compress.estimated")} value={`~${formatBytes(est)}`} />
                    <Stat
                      label={t("compress.reduction")}
                      value={t("common.percent", {
                        value: Math.max(0, Math.round((1 - est / info.fileSizeBytes) * 100)),
                      })}
                    />
                  </div>
                ) : null}
                {tooSmall ? (
                  <p className="text-xs text-[var(--dk-warning)]">{t("compress.tooSmall")}</p>
                ) : null}
              </div>
            )}
            <div className="space-y-2 rounded-xl border border-[var(--dk-border)] p-3">
              <div>
                <p className="text-sm font-medium text-white">{t("compress.advanced")}</p>
                <p className="text-xs text-[var(--dk-text-muted)]">{t("compress.advancedHint")}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-xs text-[var(--dk-text-muted)]">
                  <span>{t("compress.resolutionLimit")}</span>
                  <Select
                    value={maxShortSide}
                    onChange={setMaxShortSide}
                    ariaLabel={t("compress.resolutionLimit")}
                    options={RESOLUTION_LIMITS.map((v) => ({
                      value: v,
                      label: v === 0 ? t("compress.auto") : `${v}p`,
                    }))}
                  />
                </label>
                <label className="space-y-1 text-xs text-[var(--dk-text-muted)]">
                  <span>{t("compress.fpsLimit")}</span>
                  <Select
                    value={maxFps}
                    onChange={setMaxFps}
                    ariaLabel={t("compress.fpsLimit")}
                    options={FPS_LIMITS.map((v) => ({
                      value: v,
                      label: v === 0 ? t("compress.auto") : `${v} fps`,
                    }))}
                  />
                </label>
              </div>
            </div>
          </>
        );
      }}
      onStart={(info, destinationDir) =>
        enqueueLocal(
          {
            kind: "compress",
            inputPath: info.filePath,
            destinationDir,
            mode,
            targetSizeMb: mode === "targetSize" ? targetMb : null,
            preset: mode === "preset" ? preset : null,
            maxShortSide: maxShortSide || null,
            maxFps: maxFps || null,
          },
          info,
        )
      }
    />
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--dk-border)] bg-[var(--dk-surface-2)] p-3">
      <p className="text-xs text-[var(--dk-text-muted)]">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}
