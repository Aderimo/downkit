import type { ClipOverlayReq, EditClip } from "../types/edit";
import type { EditorSourceEntry } from "../store/editorStore";

// Dışa aktarım planı: zaman çizelgesi parçalarının hangi kaynaklarla
// gönderileceğini hesaplayan saf işlevler (arayüzden ayrı, doğrudan test edilir).

/** Dışa aktarım isteğindeki tek girdi: yerel dosya yolu ya da link. */
export interface ExportInput {
  inputPath: string | null;
  url: string | null;
}

/** Grubun kliplerinin kullandığı kaynakları süzer ve kliplerdeki `source`
 * indekslerini bu yerel listeye çevirir. Böylece tek kaynaklı bir grup
 * tek girdili istek olur ve arka uç hızlı (yeniden kodlamasız) yola düşer;
 * ayrı dosya dışa aktarımında her parça yalnızca kendi kaynağını gönderir. */
export function localizeGroupInputs(
  clips: EditClip[],
  usedInputs: EditorSourceEntry[],
  overlays: ClipOverlayReq[] = [],
): { clips: EditClip[]; inputs: ExportInput[]; overlays: ClipOverlayReq[] } {
  const order: number[] = [];
  for (const clip of clips) {
    const global = clip.source ?? 0;
    if (!order.includes(global)) order.push(global);
  }
  if (order.length === 0) order.push(0);
  // Bindirilen kliplerin kaynakları da isteğe girer (aynı kaynak tek girdi kalır).
  for (const overlay of overlays) if (!order.includes(overlay.source)) order.push(overlay.source);
  const remap = new Map(order.map((global, local) => [global, local]));
  return {
    clips: clips.map((clip) =>
      clip.black ? clip : { ...clip, source: remap.get(clip.source ?? 0) ?? 0 },
    ),
    inputs: order.map((global) => {
      const entry = usedInputs[global];
      return { inputPath: entry ? entry.source.path : null, url: null };
    }),
    overlays: overlays.map((o) => ({ ...o, source: remap.get(o.source) ?? 0 })),
  };
}
