import { useEditorStore } from "../store/editorStore";
import { refreshPlayback } from "./sequencePlayer";

// Kaydırıcıların klavye geri alma adımı. Yalnızca değeri değiştiren tuşlar (oklar,
// Page Up/Down, Home/End) sürükleme gibi tek adım açar; Ctrl+Z gibi kısayollar
// kaydırıcı odaktayken geçmişi bozmaz. Ok tuşları da oynatma imlecini değil
// kaydırıcıyı oynatır (bkz. EditorScreen `isTyping`).

export const SLIDER_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
]);

export const isSliderKey = (e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}) => SLIDER_KEYS.has(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey;

/** Bir range girdisine verilir: `<input type="range" {...sliderKeys()} />`. */
export function sliderKeys(onCommit: () => void = refreshPlayback) {
  return {
    onKeyDown: (e: React.KeyboardEvent) => {
      if (!isSliderKey(e)) return;
      // Tuş basılı tutulunca yinelenen olaylarda yeni adım açılmaz.
      if (!useEditorStore.getState().dragOrigin) useEditorStore.getState().beginDrag();
    },
    onKeyUp: (e: React.KeyboardEvent) => {
      if (!isSliderKey(e) || !useEditorStore.getState().dragOrigin) return;
      useEditorStore.getState().endDrag();
      onCommit();
    },
  };
}
