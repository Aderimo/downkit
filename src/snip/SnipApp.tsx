import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Languages, Maximize, PenLine, Save, X } from "lucide-react";
import "@fontsource/nunito/latin-800.css";
import "../styles/globals.css";
import { onSnipOpen, snipFinish, snipShow, snipState } from "../lib/tauri-api";
import { selectionToPixels } from "../lib/snip";
import type { PixelRect, SnipAction, SnipState } from "../types/snip";

interface Point {
  x: number;
  y: number;
}

/** Donmuş ekran görüntüsü üzerinde alan seçimi (Lightshot gibi). Sürükle → araç
 * çubuğu: Düzenle, Çevir, Kopyala, Kaydet. Enter: pencerenin açılış işi (düzenle
 * ya da hızlı çeviride çevir), Esc: vazgeç. */
export function SnipApp() {
  const { t } = useTranslation();
  const [state, setState] = useState<SnipState | null>(null);
  const [start, setStart] = useState<Point | null>(null);
  const [end, setEnd] = useState<Point | null>(null);
  const [dragging, setDragging] = useState(false);
  // Görüntü pencereyi kaplar: genişliği ölçeği verir (CSS pikseli → görüntü pikseli).
  const [viewWidth, setViewWidth] = useState(() => window.innerWidth);
  // Aynı seçim iki kez gönderilmesin (çift tıklama, Enter + tık).
  const finishing = useRef(false);

  // Pencere ikinci seçimde yeniden kullanılır: durum yeni görüntüyle sıfırlanır.
  const reset = useCallback((next: SnipState | null) => {
    finishing.current = false;
    setStart(null);
    setEnd(null);
    setDragging(false);
    setState(next);
  }, []);

  useEffect(() => {
    void snipState().then(reset);
    let unlisten: (() => void) | undefined;
    void onSnipOpen(() => void snipState().then(reset)).then((fn) => (unlisten = fn));
    return () => unlisten?.();
  }, [reset]);

  useEffect(() => {
    const onResize = () => setViewWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /** CSS pikseli başına görüntü pikseli (ekran ölçeği). */
  const s = state && viewWidth > 0 ? state.width / viewWidth : 1;

  const selection: PixelRect | null =
    state && start && end
      ? selectionToPixels(start, end, s, state.width, state.height)
      : null;
  const hasSelection = selection !== null && selection.width >= 4 && selection.height >= 4;

  const finish = useCallback(
    (rect: PixelRect | null, action: SnipAction) => {
      if (finishing.current) return;
      finishing.current = true;
      void snipFinish(rect, action).catch(() => {
        finishing.current = false;
      });
    },
    [],
  );

  const fullScreen = useCallback(() => {
    if (state) finish({ x: 0, y: 0, width: state.width, height: state.height }, state.mode);
  }, [finish, state]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!state) return;
      const key = e.key.toLowerCase();
      if (key === "escape") {
        e.preventDefault();
        finish(null, "edit");
      } else if (key === "enter") {
        e.preventDefault();
        if (hasSelection) finish(selection, state.mode);
        else fullScreen();
      } else if (hasSelection && e.ctrlKey && key === "c") {
        e.preventDefault();
        finish(selection, "copy");
      } else if (hasSelection && e.ctrlKey && key === "s") {
        e.preventDefault();
        finish(selection, "save");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finish, fullScreen, hasSelection, selection, state]);

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) {
      // Sağ tık: seçim varsa temizler, yoksa kapatır (Lightshot gibi).
      if (hasSelection) {
        setStart(null);
        setEnd(null);
      } else {
        finish(null, "edit");
      }
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    setStart({ x: e.clientX, y: e.clientY });
    setEnd({ x: e.clientX, y: e.clientY });
    setDragging(true);
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (dragging) setEnd({ x: e.clientX, y: e.clientY });
  }

  function onPointerUp() {
    setDragging(false);
    if (!hasSelection) {
      setStart(null);
      setEnd(null);
    }
  }

  if (!state) return null;

  // Seçimin ekrandaki (CSS) konumu.
  const box = hasSelection
    ? {
        left: selection.x / s,
        top: selection.y / s,
        width: selection.width / s,
        height: selection.height / s,
      }
    : null;
  // Araç çubuğu seçimin altına, sığmazsa üstüne, o da olmazsa içine.
  const barTop = box
    ? box.top + box.height + 52 < window.innerHeight
      ? box.top + box.height + 8
      : box.top > 52
        ? box.top - 48
        : box.top + 8
    : 0;

  const actions: { action: SnipAction; icon: typeof Copy; label: string; hint: string }[] = [
    { action: "edit", icon: PenLine, label: t("snip.edit"), hint: state.mode === "edit" ? "Enter" : "" },
    {
      action: "translate",
      icon: Languages,
      label: t("snip.translate"),
      hint: state.mode === "translate" ? "Enter" : "",
    },
    { action: "copy", icon: Copy, label: t("snip.copy"), hint: "Ctrl+C" },
    { action: "save", icon: Save, label: t("snip.save"), hint: "Ctrl+S" },
  ];

  return (
    <div
      className="fixed inset-0 cursor-crosshair overflow-hidden select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <img
        src={state.url}
        alt=""
        draggable={false}
        onLoad={(e) => {
          setViewWidth(e.currentTarget.clientWidth || window.innerWidth);
          void snipShow();
        }}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
      {box ? (
        <div
          className="pointer-events-none absolute border border-white shadow-[0_0_0_9999px_rgb(0_0_0/50%)]"
          style={box}
        >
          <span className="absolute -top-6 left-0 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[11px] text-white">
            {selection?.width} × {selection?.height}
          </span>
        </div>
      ) : (
        <div className="pointer-events-none absolute inset-0 bg-black/40">
          <p className="absolute top-6 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-sm text-white shadow-lg">
            {state.mode === "translate" ? t("snip.hintTranslate") : t("snip.hint")}
          </p>
        </div>
      )}

      {box && !dragging ? (
        <div
          className="absolute flex items-center gap-1 rounded-xl border border-white/15 bg-[#11151f]/95 p-1 shadow-2xl"
          style={{ top: barTop, left: Math.max(8, Math.min(box.left, window.innerWidth - 470)) }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {actions.map(({ action, icon: Icon, label, hint }) => (
            <button
              key={action}
              type="button"
              onClick={() => finish(selection, action)}
              title={hint ? `${label} (${hint})` : label}
              className={`flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm text-white transition hover:bg-white/10 ${
                hint === "Enter" ? "bg-[var(--dk-accent)]/80 hover:bg-[var(--dk-accent)]" : ""
              }`}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={fullScreen}
            title={t("snip.fullScreen")}
            aria-label={t("snip.fullScreen")}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white"
          >
            <Maximize size={15} />
          </button>
          <button
            type="button"
            onClick={() => finish(null, "edit")}
            title={`${t("snip.cancel")} (Esc)`}
            aria-label={t("snip.cancel")}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
