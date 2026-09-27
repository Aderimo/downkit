// Ekran kaydının saf yardımcıları: kaynak seçimi, dosya adı, sistem geneli kısayol.

import type { CaptureTarget, MonitorInfo, RecorderSources, WindowInfo } from "../types/recorder";
import type { RecorderSource } from "./recorderSettings";

/** Kayıtlı seçimi o anki kaynaklarla eşler. Monitör yoksa birincil ekrana düşer;
 * pencere kapandıysa aynı programın başka penceresine, o da yoksa null. */
export function resolveSource(
  source: RecorderSource,
  sources: RecorderSources,
): MonitorInfo | WindowInfo | null {
  if (source.kind === "monitors") {
    // Çoklu seçim tek öğeye indirgenmez; ilk ekran döner (etiketler için).
    return resolveMonitors(source.numbers, sources)[0] ?? null;
  }
  if (source.kind === "monitor") {
    const primary = sources.monitors.find((m) => m.primary) ?? sources.monitors[0] ?? null;
    if (source.number === 0) return primary;
    return sources.monitors.find((m) => m.number === source.number) ?? primary;
  }
  const exe = source.exe.toLowerCase();
  const sameExe = sources.windows.filter((w) => w.exe.toLowerCase() === exe);
  return sameExe.find((w) => w.title === source.title) ?? sameExe[0] ?? null;
}

export function isMonitor(item: MonitorInfo | WindowInfo): item is MonitorInfo {
  return "hmonitor" in item;
}

/** Çoklu ekran seçimindeki numaraları o anki ekranlarla eşler. 0 birincil
 * ekran demektir. Kapalı / çıkarılmış ekranlar atlanır; yinelenenler alınmaz. */
export function resolveMonitors(numbers: number[], sources: RecorderSources): MonitorInfo[] {
  const primary = sources.monitors.find((m) => m.primary) ?? sources.monitors[0];
  const seen = new Set<number>();
  const out: MonitorInfo[] = [];
  for (const n of numbers) {
    const m = n === 0 ? primary : sources.monitors.find((x) => x.number === n);
    if (m && !seen.has(m.hmonitor)) {
      seen.add(m.hmonitor);
      out.push(m);
    }
  }
  return out;
}

/** Seçili ekranlar masaüstündeki kaplayan kutusu (çoklu ekran etiketi için). */
export function monitorsBounds(monitors: MonitorInfo[]): { width: number; height: number } {
  const left = Math.min(...monitors.map((m) => m.x));
  const top = Math.min(...monitors.map((m) => m.y));
  const right = Math.max(...monitors.map((m) => m.x + m.width));
  const bottom = Math.max(...monitors.map((m) => m.y + m.height));
  return { width: right - left, height: bottom - top };
}

/** Ekranın görünen adı: birincil "Ana ekran", ötekiler masaüstü sırasıyla
 * "2. ekran", "3. ekran" (Windows'un soldan sağa numarası). */
export function monitorLabel(
  m: MonitorInfo,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  return m.primary ? t("recorder.primaryScreen") : t("recorder.screenN", { n: m.number });
}

export function captureTarget(item: MonitorInfo | WindowInfo): CaptureTarget {
  return isMonitor(item)
    ? {
        kind: "monitor",
        hmonitor: item.hmonitor,
        ddaIndex: item.ddaIndex,
        width: item.width,
        height: item.height,
      }
    : { kind: "window", hwnd: item.hwnd, width: item.width, height: item.height };
}

/** Birden çok ekran tek hedef olarak: Rust tarafı masaüstü konumuyla dizer. */
export function captureTargetMulti(monitors: MonitorInfo[]): CaptureTarget {
  return {
    kind: "monitors",
    monitors: monitors.map((m) => ({
      hmonitor: m.hmonitor,
      ddaIndex: m.ddaIndex,
      x: m.x,
      y: m.y,
      width: m.width,
      height: m.height,
    })),
  };
}

/** Dosya adı için yerel zaman: "2026-09-25 23.14.05" (Windows ":" kabul etmez). */
export function fileStamp(date: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ` +
    `${two(date.getHours())}.${two(date.getMinutes())}.${two(date.getSeconds())}`
  );
}

const PUNCTUATION: Record<string, string> = {
  ",": "Comma",
  ".": "Period",
  "-": "Minus",
  "=": "Equal",
  "+": "Equal",
  "/": "Slash",
  ";": "Semicolon",
  "'": "Quote",
  "[": "BracketLeft",
  "]": "BracketRight",
  "\\": "Backslash",
  "`": "Backquote",
};

const FUNCTION_KEY = /^F([1-9]|1[0-9]|2[0-4])$/;

/** Uygulama içi kısayol yazımını ("Ctrl+Alt+F9") sistem geneli kısayol biçimine
 * çevirir. Sistem geneli kısayol yazı yazarken tetiklenmesin diye en az bir
 * değiştirici (Ctrl/Alt/Shift) ya da F tuşu gerekir; uygun değilse null. */
export function toAccelerator(combo: string): string | null {
  const parts = combo.split("+");
  // "Ctrl++" gibi: son parça boşsa tuş "+"dır.
  let key = parts.pop() ?? "";
  if (key === "" && combo.endsWith("+")) {
    parts.pop();
    key = "+";
  }
  if (!key) return null;
  const modifiers = parts.filter((p) => ["Ctrl", "Alt", "Shift"].includes(p));
  if (modifiers.length !== parts.length) return null;
  if (modifiers.length === 0 && !FUNCTION_KEY.test(key)) return null;
  if (modifiers.length === 1 && modifiers[0] === "Shift" && !FUNCTION_KEY.test(key)) return null;
  const mapped = PUNCTUATION[key] ?? key;
  return [...modifiers, mapped].join("+");
}

const VK_NAMES: Record<number, string> = {
  8: "Backspace",
  9: "Tab",
  13: "Enter",
  19: "Pause",
  32: "Space",
  33: "PageUp",
  34: "PageDown",
  35: "End",
  36: "Home",
  37: "ArrowLeft",
  38: "ArrowUp",
  39: "ArrowRight",
  40: "ArrowDown",
  45: "Insert",
  46: "Delete",
  106: "NumpadMultiply",
  107: "NumpadAdd",
  109: "NumpadSubtract",
  110: "NumpadDecimal",
  111: "NumpadDivide",
  145: "ScrollLock",
};

const MODIFIER_VK = [16, 17, 18, 91, 92, 93];

export type HotkeyCapture =
  | { combo: string }
  | {
      reason: "modifier" | "unsupported" | "needsModifier" | "altGr" | "reserved";
      char?: string;
    };

/** Sistem geneli kısayol için basılan tuşu okur. Windows kısayolu sanal tuş
 * koduyla (VK) eşlediği için tuş `keyCode`tan okunur: böylece Türkçe Q/F gibi
 * düzenlerde de kaydedilen tuş basılan tuşun aynısıdır. Harf/rakam/F/numpad ve
 * gezinme tuşları kabul edilir; noktalama ve ç, ş, ğ gibi düzene bağlı tuşlar
 * sistem genelinde güvenilir eşlenemediği için reddedilir. */
export function hotkeyFromEvent(e: {
  key: string;
  keyCode: number;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}): HotkeyCapture {
  const vk = e.keyCode;
  if (MODIFIER_VK.includes(vk) || ["Control", "Alt", "Shift", "Meta", "AltGraph"].includes(e.key))
    return { reason: "modifier" };
  let key: string | undefined;
  if (vk >= 65 && vk <= 90) key = String.fromCharCode(vk);
  else if (vk >= 48 && vk <= 57) key = String.fromCharCode(vk);
  else if (vk >= 96 && vk <= 105) key = `Numpad${vk - 96}`;
  else if (vk >= 112 && vk <= 135) key = `F${vk - 111}`;
  else key = VK_NAMES[vk];
  // Windows tuşlu birleşimler çoğunlukla Windows'un kendisine ayrılmıştır.
  if (!key || e.metaKey) return { reason: "unsupported" };
  // Türkçe Q'da Ctrl+Alt = AltGr: Ctrl+Alt+Q "@" yazar. Kısayol olursa o
  // karakter hiçbir programda yazılamaz.
  if (e.ctrlKey && e.altKey && e.key.length === 1 && !/^[\p{L}\p{N}]$/u.test(e.key))
    return { reason: "altGr", char: e.key };
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(key);
  const combo = parts.join("+");
  // Alt+F4 Windows'ta pencereyi kapatır; kısayol yapılamaz.
  if (combo === "Alt+F4") return { reason: "reserved" };
  return toAccelerator(combo) ? { combo } : { reason: "needsModifier" };
}

const KEY_LABELS: Record<string, string> = {
  NumpadMultiply: "Num *",
  NumpadAdd: "Num +",
  NumpadSubtract: "Num -",
  NumpadDecimal: "Num .",
  NumpadDivide: "Num /",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  PageUp: "PgUp",
  PageDown: "PgDn",
  ScrollLock: "Scroll Lock",
};

/** Kısayolun ekranda yazılışı: "Ctrl + Alt + F9", "Ctrl + Num 1". */
export function hotkeyLabel(combo: string): string {
  const parts = combo.split("+");
  if (parts[parts.length - 1] === "" && combo.endsWith("+")) {
    parts.splice(-2, 2, "+");
  }
  return parts
    .map((part) => KEY_LABELS[part] ?? part.replace(/^Numpad(\d)$/, "Num $1"))
    .join(" + ");
}

/** Kısayol düzenleyicisinde listeden seçilebilen tuşlar (sistem geneli kısayol adlarıyla). */
export const HOTKEY_KEYS: readonly string[] = [
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
  ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)),
  ...Array.from({ length: 10 }, (_, i) => String(i)),
  ...Array.from({ length: 10 }, (_, i) => `Numpad${i}`),
  "NumpadAdd",
  "NumpadSubtract",
  "NumpadMultiply",
  "NumpadDivide",
  "Insert",
  "Delete",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Pause",
  "ScrollLock",
  "Space",
];

export interface HotkeyParts {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

/** "Ctrl+Alt+F9" → parçalar (düzenleyicide göstermek için). */
export function parseHotkey(combo: string | null): HotkeyParts {
  const parts = (combo ?? "").split("+").filter(Boolean);
  return {
    ctrl: parts.includes("Ctrl"),
    alt: parts.includes("Alt"),
    shift: parts.includes("Shift"),
    key: parts.filter((p) => !["Ctrl", "Alt", "Shift"].includes(p)).pop() ?? "",
  };
}

export type HotkeyProblem = "noKey" | "needsModifier" | "reserved";

/** Parçalardan kısayol; kullanılamıyorsa nedeni. */
export function buildHotkey(p: HotkeyParts): { combo: string } | { problem: HotkeyProblem } {
  if (!p.key) return { problem: "noKey" };
  const combo = [p.ctrl && "Ctrl", p.alt && "Alt", p.shift && "Shift", p.key]
    .filter(Boolean)
    .join("+");
  if (combo === "Alt+F4") return { problem: "reserved" };
  return toAccelerator(combo) ? { combo } : { problem: "needsModifier" };
}

/** Boş kısayol önerisi için denenen birleşimler (sırayla; ilk boş olanlar önerilir). */
export const HOTKEY_SUGGESTIONS: readonly string[] = [
  "Ctrl+Shift+F9",
  "Ctrl+Shift+F10",
  "Ctrl+Shift+F11",
  "Ctrl+Shift+F12",
  "Alt+Shift+F9",
  "Alt+Shift+F11",
  "Alt+Shift+F12",
  "Ctrl+Alt+F11",
  "Ctrl+Alt+F12",
  "Ctrl+Alt+Shift+F9",
  "Ctrl+Alt+Shift+F11",
  "Ctrl+Alt+Shift+F12",
  "Ctrl+Alt+Numpad0",
  "Ctrl+Alt+Numpad1",
];
