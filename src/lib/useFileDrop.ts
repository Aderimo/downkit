import { useEffect } from "react";
import { onFileDrop } from "./tauri-api";
import { isMediaPath } from "./validation";

/** Pencereye bırakılan ilk medya dosyasını `onFile`'a verir.
 * `onFile` kararlı bir referans olmalı (ör. zustand eylemi), yoksa her render'da
 * yeniden abone olunur. */
export function useFileDrop(
  onFile: (path: string) => void,
  options: {
    enabled?: boolean;
    onHover?: (hovering: boolean) => void;
    onRejected?: () => void;
  } = {},
) {
  const { enabled = true, onHover, onRejected } = options;
  useEffect(() => {
    if (!enabled) return;
    const unlisten = onFileDrop((paths) => {
      const media = paths.find(isMediaPath);
      if (media) onFile(media);
      else onRejected?.();
    }, onHover);
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [onFile, enabled, onHover, onRejected]);
}
