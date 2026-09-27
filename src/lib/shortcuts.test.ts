import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHORTCUTS,
  assignCombo,
  comboFromEvent,
  findAction,
  formatCombo,
  normalizeShortcuts,
} from "./shortcuts";

const key = (
  k: string,
  code: string,
  mods: Partial<Record<"ctrl" | "alt" | "shift", boolean>> = {},
) => ({
  key: k,
  code,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
  metaKey: false,
});

describe("kısayol okuma", () => {
  it("Türkçe klavyede ı üreten tuş I olarak okunur", () => {
    expect(comboFromEvent(key("ı", "KeyI"))).toBe("I");
    expect(comboFromEvent(key("s", "KeyS", { ctrl: true, shift: true }))).toBe("Ctrl+Shift+S");
  });

  it("noktalama üretilen karakterden, Shift'siz okunur", () => {
    expect(comboFromEvent(key("+", "Equal", { shift: true }))).toBe("+");
    expect(comboFromEvent(key(".", "Slash"))).toBe(".");
    expect(comboFromEvent(key(" ", "Space"))).toBe("Space");
    expect(comboFromEvent(key("ArrowLeft", "ArrowLeft", { shift: true }))).toBe("Shift+ArrowLeft");
  });

  it("yalnızca değiştirici tuş kısayol sayılmaz", () => {
    expect(comboFromEvent(key("Control", "ControlLeft", { ctrl: true }))).toBeNull();
  });

  it("gösterim okunaklıdır", () => {
    expect(formatCombo("Shift+ArrowLeft")).toBe("Shift + ←");
    expect(formatCombo("Ctrl++")).toBe("Ctrl + +");
    expect(formatCombo("+")).toBe("+");
  });
});

describe("kısayol eşleme", () => {
  it("başka eylemdeki tuş atanınca oradan kaldırılır", () => {
    const map = normalizeShortcuts({});
    const { map: next, takenFrom } = assignCombo(map, "deleteClip", "S");
    expect(takenFrom).toBe("split");
    expect(next.split).toEqual([]);
    expect(findAction(next, "S")).toBe("deleteClip");
  });

  it("bozuk kayıt varsayılana döner", () => {
    const map = normalizeShortcuts({ split: "S", undo: ["Ctrl+U"], bilinmeyen: ["X"] });
    expect(map.split).toEqual(DEFAULT_SHORTCUTS.split);
    expect(map.undo).toEqual(["Ctrl+U"]);
  });
});
