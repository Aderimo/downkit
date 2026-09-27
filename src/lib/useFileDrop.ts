import { useEffect } from "react";
import { onFileDrop } from "./tauri-api";
import { isMediaPath } from "./validation";

/** Pencereye bırakılan medya dosyalarını iletir.
 * `onFiles` verilirse bırakılan TÜM medya dosyaları ona gider (toplu içe
 * aktarma); yoksa yalnızca ilk dosya `onFile`'a verilir.
 * Geri çağrılar kararlı referans olmalı (ör. zustand eylemi), yoksa her
 * render'da yeniden abone olunur. */
export function useFileDrop(
  onFile: (path: string) => void,
  options: {
    enabled?: boolean;
    onHover?: (hovering: boolean) => void;
    onRejected?: () => void;
    onFiles?: (paths: string[]) => void;
  } = {},
) {
  const { enabled = true, onHover, onRejected, onFiles } = options;
  useEffect(() => {
    if (!enabled) return;
    const unlisten = onFileDrop((paths) => {
      const media = paths.filter(isMediaPath);
      if (media.length === 0) {
        onRejected?.();
        return;
      }
      if (onFiles) onFiles(media);
      else if (media[0]) onFile(media[0]);
    }, onHover);
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [onFile, enabled, onHover, onRejected, onFiles]);
}
