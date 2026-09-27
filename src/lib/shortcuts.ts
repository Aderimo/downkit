import { create } from "zustand";

// Klip Düzenleyici kısayolları: kullanıcı Ayarlar ya da düzenleyicideki
// "Kısayollar" penceresinden değiştirebilir, ekleyebilir, kaldırabilir.

export const SHORTCUT_ACTIONS = [
  "playPause",
  "back1",
  "forward1",
  "back5",
  "forward5",
  "prevFrame",
  "nextFrame",
  "toStart",
  "toEnd",
  "split",
  "deleteClip",
  "duplicate",
  "toggleMute",
  "trimStart",
  "trimEnd",
  "undo",
  "redo",
  "selectAll",
  "deselect",
  "zoomIn",
  "zoomOut",
  "zoomFit",
] as const;
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];

export const SHORTCUT_GROUPS: { id: string; actions: ShortcutAction[] }[] = [
  {
    id: "playback",
    actions: [
      "playPause",
      "back1",
      "forward1",
      "back5",
      "forward5",
      "prevFrame",
      "nextFrame",
      "toStart",
      "toEnd",
    ],
  },
  {
    id: "editing",
    actions: [
      "split",
      "deleteClip",
      "duplicate",
      "toggleMute",
      "trimStart",
      "trimEnd",
      "undo",
      "redo",
      "selectAll",
      "deselect",
    ],
  },
  { id: "view", actions: ["zoomIn", "zoomOut", "zoomFit"] },
];

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string[]> = {
  playPause: ["Space", "K"],
  back1: ["ArrowLeft"],
  forward1: ["ArrowRight"],
  back5: ["J", "Shift+ArrowLeft"],
  forward5: ["L", "Shift+ArrowRight"],
  prevFrame: [","],
  nextFrame: ["."],
  toStart: ["Home"],
  toEnd: ["End"],
  split: ["S"],
  deleteClip: ["Delete", "Backspace"],
  duplicate: ["Ctrl+D"],
  toggleMute: ["M"],
  trimStart: ["Q"],
  trimEnd: ["W"],
  undo: ["Ctrl+Z"],
  redo: ["Ctrl+Y", "Ctrl+Shift+Z"],
  selectAll: ["Ctrl+A"],
  deselect: ["Escape"],
  zoomIn: ["+", "="],
  zoomOut: ["-"],
  zoomFit: ["0"],
};

const MODIFIER_KEYS = ["Control", "Shift", "Alt", "Meta", "AltGraph", "CapsLock"];

/** Tuş olayını "Ctrl+Shift+S" gibi bir kısayol dizisine çevirir. Harf ve rakamlar
 * fiziksel tuştan okunur (Türkçe klavyede "I" tuşu "ı" üretse de "I" sayılır);
 * noktalama ise üretilen karakterden (",", ".", "+") okunur. Yalnızca değiştirici
 * tuşa basıldıysa null. */
export function comboFromEvent(e: {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}): string | null {
  if (MODIFIER_KEYS.includes(e.key)) return null;
  let key: string;
  let usesShift = true;
  const letter = /^Key([A-Z])$/.exec(e.code);
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(e.code);
  if (letter) key = letter[1];
  else if (digit) key = digit[1];
  else if (e.key === " ") key = "Space";
  else if (e.key.length === 1) {
    // "+" gibi karakterler zaten Shift ile üretilir; Shift ayrıca yazılmaz.
    key = e.key;
    usesShift = false;
  } else key = e.key;

  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey && usesShift) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

const KEY_LABELS: Record<string, string> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Space: "Space",
  Escape: "Esc",
  Delete: "Delete",
  Backspace: "Backspace",
};

/** Ekranda gösterim: "Shift+ArrowLeft" → "Shift + ←". */
export function formatCombo(combo: string): string {
  return combo
    .split("+")
    .map((part, i, all) => (part === "" && i === all.length - 1 ? "+" : (KEY_LABELS[part] ?? part)))
    .filter((part) => part !== "")
    .join(" + ");
}

export type ShortcutMap = Record<ShortcutAction, string[]>;

/** Kayıtlı eşlemeyi okur; bilinmeyen eylem ya da bozuk değer varsayılana döner. */
export function normalizeShortcuts(raw: unknown): ShortcutMap {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const result = {} as ShortcutMap;
  for (const action of SHORTCUT_ACTIONS) {
    const value = source[action];
    result[action] =
      Array.isArray(value) && value.every((v) => typeof v === "string")
        ? (value as string[]).slice(0, 4)
        : [...DEFAULT_SHORTCUTS[action]];
  }
  return result;
}

/** Kombinasyonu eyleme bağlar; başka bir eylemde varsa oradan kaldırır. Kaldırılan
 * eylemi döner (arayüz "S artık Böl'e bağlı" diye söyleyebilsin). */
export function assignCombo(
  map: ShortcutMap,
  action: ShortcutAction,
  combo: string,
): { map: ShortcutMap; takenFrom: ShortcutAction | null } {
  let takenFrom: ShortcutAction | null = null;
  const next = {} as ShortcutMap;
  for (const a of SHORTCUT_ACTIONS) {
    const list = map[a].filter((c) => c !== combo);
    if (list.length !== map[a].length && a !== action) takenFrom = a;
    next[a] = list;
  }
  next[action] = [...next[action], combo];
  return { map: next, takenFrom };
}

export function findAction(map: ShortcutMap, combo: string): ShortcutAction | null {
  return SHORTCUT_ACTIONS.find((a) => map[a].includes(combo)) ?? null;
}

const STORAGE_KEY = "downkit.shortcuts";

function load(): ShortcutMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return normalizeShortcuts(raw ? JSON.parse(raw) : {});
  } catch {
    return normalizeShortcuts({});
  }
}

function save(map: ShortcutMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Depolama yoksa değişiklik yalnızca bu oturumda geçerli olur.
  }
}

interface ShortcutState {
  map: ShortcutMap;
  assign: (action: ShortcutAction, combo: string) => ShortcutAction | null;
  remove: (action: ShortcutAction, combo: string) => void;
  resetAction: (action: ShortcutAction) => void;
  resetAll: () => void;
}

export const useShortcutStore = create<ShortcutState>((set, get) => ({
  map: load(),
  assign: (action, combo) => {
    const { map, takenFrom } = assignCombo(get().map, action, combo);
    set({ map });
    save(map);
    return takenFrom;
  },
  remove: (action, combo) => {
    const map = { ...get().map, [action]: get().map[action].filter((c) => c !== combo) };
    set({ map });
    save(map);
  },
  resetAction: (action) => {
    const { map } = get();
    let next = { ...map, [action]: [] as string[] };
    for (const combo of DEFAULT_SHORTCUTS[action]) next = assignCombo(next, action, combo).map;
    set({ map: next });
    save(next);
  },
  resetAll: () => {
    const map = normalizeShortcuts({});
    set({ map });
    save(map);
  },
}));
