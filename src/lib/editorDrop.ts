import { useEffect } from "react";
import { create } from "zustand";
import i18n from "../i18n";
import { useEditorStore } from "../store/editorStore";
import { addImageFile, addMusicFile } from "./layerActions";
import { IMAGE_EXTENSIONS, MUSIC_EXTENSIONS } from "./layers";
import { onFileDrop } from "./tauri-api";
import { isMediaPath } from "./validation";

// Düzenleyici açıkken pencereye bırakılan dosyalar — hangi panel açık olursa olsun:
//   ses dosyası  → imleçten başlayan müzik katmanı (zaman çizelgesinde hemen görünür)
//   resim        → logo / resim katmanı
//   video        → medya kitaplığı (oradan zaman çizelgesine sürüklenir)

export const useEditorDrop = create<{ hovering: boolean; message: string | null }>(() => ({
  hovering: false,
  message: null,
}));

const extOf = (path: string) => /\.([^.\\/]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";

export type DropKind = "music" | "image" | "video" | null;

export function dropKind(path: string): DropKind {
  const ext = extOf(path);
  if (MUSIC_EXTENSIONS.includes(ext)) return "music";
  if (IMAGE_EXTENSIONS.includes(ext)) return "image";
  if (isMediaPath(path)) return "video";
  return null;
}

export async function dropIntoEditor(paths: string[]): Promise<void> {
  const known = paths.filter((p) => dropKind(p) !== null);
  if (known.length === 0) {
    useEditorDrop.setState({ message: i18n.t("drop.rejected") });
    return;
  }
  useEditorDrop.setState({ message: null });
  for (const path of known) {
    const kind = dropKind(path);
    try {
      if (kind === "music") await addMusicFile(path);
      else if (kind === "image") await addImageFile(path);
      else await useEditorStore.getState().addSourceFile(path);
    } catch (err) {
      useEditorDrop.setState({
        message: err instanceof Error ? err.message : i18n.t("editor.musicFailed"),
      });
    }
  }
}

/** Düzenleyici ekranında bir kez çağrılır. */
export function useEditorFileDrop() {
  useEffect(() => {
    const unlisten = onFileDrop(
      (paths) => void dropIntoEditor(paths),
      (hovering) => useEditorDrop.setState({ hovering }),
    );
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);
}
