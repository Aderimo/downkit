import type { PointerEvent as ReactPointerEvent } from "react";

// Program içi sürükle-bırak (medya → zaman çizelgesi, geçiş → klip).
//
// Windows'ta Tauri'nin dosya bırakma özelliği açıkken (Gezgin'den dosya atmak için
// gerekli) WebView2 HTML5 `draggable` sürüklemesini hiç başlatmaz. Bu yüzden
// sürükleme fare/kalem olaylarıyla yürütülür; imlecin altındaki öğeye gerçek
// `dragover` / `dragleave` / `drop` olayları gönderilir. Böylece bırakma tarafındaki
// mevcut `onDragOver` / `onDrop` kodu (dataTransfer.types, getData) aynen çalışır.

const THRESHOLD = 5;

/** Bir öğeyi sürüklenebilir yapar: `{...pointerDrag(MIME, değer, etiket)}`. */
export function pointerDrag(mime: string, value: string, label?: string) {
  return {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      startDrag(
        e.clientX,
        e.clientY,
        mime,
        value,
        label ?? e.currentTarget.textContent?.trim() ?? "",
      );
    },
  };
}

function startDrag(x0: number, y0: number, mime: string, value: string, label: string) {
  let dragging = false;
  let over: Element | null = null;
  let ghost: HTMLDivElement | null = null;
  const data = new DataTransfer();
  data.setData(mime, value);

  const fire = (type: string, target: Element, x: number, y: number) => {
    const event = new DragEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      dataTransfer: data,
    });
    target.dispatchEvent(event);
    return event;
  };

  const targetAt = (x: number, y: number) => {
    if (ghost) ghost.style.display = "none";
    const el = document.elementFromPoint(x, y);
    if (ghost) ghost.style.display = "";
    return el;
  };

  const move = (e: PointerEvent) => {
    if (!dragging) {
      if (Math.hypot(e.clientX - x0, e.clientY - y0) < THRESHOLD) return;
      dragging = true;
      ghost = document.createElement("div");
      ghost.textContent = label;
      ghost.setAttribute("aria-hidden", "true");
      ghost.style.cssText =
        "position:fixed;z-index:9999;pointer-events:none;max-width:180px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;" +
        "padding:4px 10px;border-radius:8px;font:600 12px system-ui,sans-serif;color:#fff;" +
        "background:var(--dk-accent,#3b5bfd);box-shadow:0 4px 14px rgba(0,0,0,.35);opacity:.92";
      document.body.appendChild(ghost);
      document.body.style.cursor = "grabbing";
    }
    if (ghost) ghost.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 10}px)`;
    const el = targetAt(e.clientX, e.clientY);
    if (over && over !== el) fire("dragleave", over, e.clientX, e.clientY);
    over = el;
    if (el) fire("dragover", el, e.clientX, e.clientY);
  };

  const finish = (e: PointerEvent, drop: boolean) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", escape);
    if (!dragging) return;
    ghost?.remove();
    document.body.style.cursor = "";
    const el = targetAt(e.clientX, e.clientY);
    if (over) fire("dragleave", over, e.clientX, e.clientY);
    if (drop && el) {
      // Bırakma ancak hedef dragover'da kabul ettiyse (preventDefault) yapılır.
      if (fire("dragover", el, e.clientX, e.clientY).defaultPrevented)
        fire("drop", el, e.clientX, e.clientY);
    }
    // Sürükleme bitince kaynaktaki tıklama (ör. "geçişi uygula") tetiklenmesin.
    const swallow = (c: Event) => {
      c.stopPropagation();
      c.preventDefault();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
  };
  const up = (e: PointerEvent) => finish(e, true);
  const cancel = (e: PointerEvent) => finish(e, false);
  const escape = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !dragging) return;
    finish(new PointerEvent("pointercancel", { clientX: -1, clientY: -1 }), false);
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", escape);
}
