// Kanal şablonu: projedeki çerçeve, renk görünümü, yazı stili ve logo bir kez
// kaydedilir; sonraki projelere tek tıkla uygulanır (her klipte aynı kanal görünümü).

import { FRAME_SIZES, useEditorStore } from "../store/editorStore";
import { isDefaultLook, normalizeLook } from "./clipLook";
import { applyLookToAll } from "./editorActions";
import type { ChannelTemplate } from "./editorPresets";
import { ensureMediaUrl, nextId } from "./layerActions";
import { sequenceEnd } from "./sequence";
import { effectiveSplit } from "./splitLayout";

/** Etkin kaynağın en/boy oranı (kamera + oyun bölgeleri buna göre). */
function sourceAspect(): number {
  const info = useEditorStore.getState().source?.info;
  return info?.width && info.height ? info.width / info.height : 16 / 9;
}

/** Şu anki projeden şablon: seçili (yoksa ilk değiştirilmiş) klibin görünümü, seçili
 * (yoksa ilk) yazının stili, ilk logo. */
export function channelFromProject(): ChannelTemplate {
  const s = useEditorStore.getState();
  const o = s.exportOptions;
  const template: ChannelTemplate = {
    frame: {
      aspect: o.frame,
      fit: o.frameFit,
      blur: o.frameBlur,
      ...(o.frameGradient ? { gradient: o.frameGradient } : {}),
      position: o.framePosition,
      ...(o.frameSplit && o.frame !== "original"
        ? {
            split: effectiveSplit(o.split, sourceAspect(), ...FRAME_SIZES[o.frame]),
          }
        : {}),
    },
  };
  const clip =
    s.clips.find((c) => s.selectedIds.includes(c.id) && !isDefaultLook(c.look)) ??
    s.clips.find((c) => !isDefaultLook(c.look));
  if (clip) template.look = normalizeLook(clip.look);
  const text = s.texts.find((x) => x.id === s.selectedTextId) ?? s.texts[0];
  if (text) {
    template.text = {
      x: text.x,
      y: text.y,
      size: text.size,
      color: text.color,
      box: text.box,
      bold: text.bold,
      ...(text.style ? { style: text.style } : {}),
      ...(text.anim ? { anim: text.anim } : {}),
    };
  }
  const logo = s.images[0];
  if (logo) {
    template.logo = {
      path: logo.path,
      name: logo.name,
      x: logo.x,
      y: logo.y,
      size: logo.size,
      opacity: logo.opacity,
    };
  }
  return template;
}

/** Şablonda hangi parçalar var (listede kısaca gösterilir). */
export function channelParts(t: ChannelTemplate): ("frame" | "look" | "text" | "logo")[] {
  return [
    ...(t.frame.aspect !== "original" ? (["frame"] as const) : []),
    ...(t.look ? (["look"] as const) : []),
    ...(t.text ? (["text"] as const) : []),
    ...(t.logo ? (["logo"] as const) : []),
  ];
}

/** Şablonu projeye uygular. */
export function applyChannel(template: ChannelTemplate) {
  const store = useEditorStore.getState();
  store.setExportOptions({
    frame: template.frame.aspect,
    frameFit: template.frame.fit,
    frameBlur: template.frame.blur,
    frameGradient: template.frame.gradient ?? null,
    framePosition: template.frame.position,
    frameSplit: template.frame.split !== undefined,
    split: template.frame.split ?? null,
  });
  if (template.look) applyLookToAll(template.look);
  if (template.text) {
    const style = template.text;
    useEditorStore.getState().applyTexts((texts) => texts.map((x) => ({ ...x, ...style })));
  }
  const logo = template.logo;
  if (logo) {
    const s = useEditorStore.getState();
    if (!s.images.some((i) => i.path === logo.path)) {
      const end = Math.max(sequenceEnd(s.clips), 1);
      s.applyLayers({
        images: [...s.images, { id: nextId("i"), start: 0, end, ...logo }],
      });
      ensureMediaUrl(logo.path, "image");
    }
  }
}
