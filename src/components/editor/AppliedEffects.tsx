import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Blend,
  Gauge,
  Palette,
  Sparkles,
  SunMedium,
  Unlink,
  VolumeX,
  Wand2,
  X,
} from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { DEFAULT_LOOK, isDefaultLook, normalizeLook } from "../../lib/clipLook";
import { refreshPlayback } from "../../lib/sequencePlayer";
import { toggleAudioLink } from "../../lib/editorActions";
import { setSpeed, type SeqClip } from "../../lib/sequence";

/** Efekt denetimleri: bu klibe uygulanan her şey tek listede, her biri tek tıkla kaldırılır.
 * Panellerden sürükleyip klibe bırakılanlar da burada görünür. */
export function AppliedEffects({ clip }: { clip: SeqClip }) {
  const { t } = useTranslation();
  const look = normalizeLook(clip.look);
  const detached = useEditorStore((s) => s.music.some((m) => m.linkedClipId === clip.id));
  const edit = (patch: (c: SeqClip) => SeqClip) => {
    useEditorStore.getState().apply((clips) => clips.map((c) => (c.id === clip.id ? patch(c) : c)));
    refreshPlayback();
  };
  const rows: { key: string; icon: ReactNode; label: string; remove: () => void }[] = [];

  if (look.filter !== "none") {
    rows.push({
      key: "filter",
      icon: <Sparkles size={14} />,
      label: `${t("editor.toolFilters")}: ${t(`editor.filter.${look.filter}`)}`,
      remove: () => edit((c) => ({ ...c, look: { ...look, filter: "none" } })),
    });
  }
  const colorChanged =
    look.brightness !== 0 || look.contrast !== 0 || look.saturation !== 0 || look.temperature !== 0;
  if (colorChanged) {
    rows.push({
      key: "color",
      icon: <SunMedium size={14} />,
      label: t("editor.appliedColor"),
      remove: () =>
        edit((c) => ({
          ...c,
          look: { ...look, brightness: 0, contrast: 0, saturation: 0, temperature: 0 },
        })),
    });
  }
  const effectsChanged = !isDefaultLook({
    ...look,
    filter: DEFAULT_LOOK.filter,
    brightness: 0,
    contrast: 0,
    saturation: 0,
    temperature: 0,
  });
  if (effectsChanged) {
    rows.push({
      key: "effects",
      icon: <Palette size={14} />,
      label: t("editor.toolEffects"),
      remove: () =>
        edit((c) => ({
          ...c,
          look: {
            ...DEFAULT_LOOK,
            filter: look.filter,
            brightness: look.brightness,
            contrast: look.contrast,
            saturation: look.saturation,
            temperature: look.temperature,
          },
        })),
    });
  }
  if (clip.motion) {
    rows.push({
      key: "motion",
      icon: <Wand2 size={14} />,
      label: `${t("editor.motion")}: ${t(`editor.motionName.${clip.motion}`)}`,
      remove: () => edit((c) => ({ ...c, motion: undefined, motionStrength: undefined })),
    });
  }
  if ((clip.fadeIn ?? 0) > 0 || (clip.fadeOut ?? 0) > 0 || clip.transition) {
    rows.push({
      key: "intro",
      icon: <Blend size={14} />,
      label: `${t("editor.transitionStyle")}: ${t(`editor.transitionStyleName.${clip.transition ?? "fade"}`)}`,
      remove: () =>
        edit((c) => ({ ...c, fadeIn: 0, fadeOut: 0, fadeWhite: false, transition: undefined })),
    });
  }
  if (clip.xfade) {
    rows.push({
      key: "xfade",
      icon: <Blend size={14} />,
      label: `${t("editor.appliedXfade")}: ${t(`editor.xfadeName.${clip.xfade.kind}`)}`,
      remove: () => edit((c) => ({ ...c, xfade: undefined })),
    });
  }
  if (clip.speed !== 1) {
    rows.push({
      key: "speed",
      icon: <Gauge size={14} />,
      label: `${t("editor.appliedSpeed")}: ${clip.speed.toFixed(2).replace(/\.?0+$/, "")}×`,
      remove: () => {
        useEditorStore.getState().apply((clips) => setSpeed(clips, clip.id, 1));
        refreshPlayback();
      },
    });
  }
  if (detached) {
    rows.push({
      key: "detached",
      icon: <Unlink size={14} />,
      label: t("editor.appliedDetached"),
      remove: () => {
        useEditorStore.getState().select([clip.id]);
        toggleAudioLink();
      },
    });
  } else if (clip.volume === 0) {
    rows.push({
      key: "mute",
      icon: <VolumeX size={14} />,
      label: t("editor.appliedMuted"),
      remove: () => edit((c) => ({ ...c, volume: 1 })),
    });
  }

  // Efekt yoksa blok hiç görünmez (boş durum yazısı panelde yer kaplamasın).
  if (rows.length === 0) return null;
  return (
    <div className="space-y-1.5" data-applied-effects>
      <p className="text-xs font-semibold tracking-wide text-[var(--dk-text-muted)] uppercase">
        {t("editor.appliedTitle")}
      </p>
      {
        <ul className="space-y-1">
          {rows.map((row) => (
            <li
              key={row.key}
              className="flex items-center gap-2 rounded-lg border border-[var(--dk-border)] bg-[var(--dk-surface-2)] px-2 py-1.5 text-xs"
            >
              <span className="text-[var(--dk-accent-hover)]">{row.icon}</span>
              <span className="min-w-0 flex-1 truncate">{row.label}</span>
              <button
                type="button"
                aria-label={t("editor.appliedRemove", { name: row.label })}
                title={t("editor.appliedRemove", { name: row.label })}
                className="flex h-5 w-5 items-center justify-center rounded text-[var(--dk-text-muted)] hover:bg-white/10 hover:text-white"
                onClick={row.remove}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      }
    </div>
  );
}
