import { describe, expect, it } from "vitest";
import { isBrowserShortcut } from "./browserKeys";

const key = (k: string, mods: { ctrl?: boolean; alt?: boolean; shift?: boolean } = {}) => ({
  key: k,
  ctrlKey: !!mods.ctrl,
  metaKey: false,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
});

describe("tarayıcı kısayolları", () => {
  it("yazdırma, bul ve imleç ile gezinme engellenir", () => {
    expect(isBrowserShortcut(key("p", { ctrl: true }), false)).toBe(true);
    expect(isBrowserShortcut(key("P", { ctrl: true, shift: true }), false)).toBe(true);
    expect(isBrowserShortcut(key("f", { ctrl: true }), false)).toBe(true);
    expect(isBrowserShortcut(key("F7"), false)).toBe(true);
    expect(isBrowserShortcut(key("ArrowLeft", { alt: true }), false)).toBe(true);
  });

  it("uygulamanın kısayolları ve düzenleme tuşları serbest kalır", () => {
    expect(isBrowserShortcut(key("v", { ctrl: true }), false)).toBe(false);
    expect(isBrowserShortcut(key("z", { ctrl: true }), false)).toBe(false);
    expect(isBrowserShortcut(key("d", { ctrl: true }), false)).toBe(false);
    expect(isBrowserShortcut(key("ArrowLeft"), false)).toBe(false);
    expect(isBrowserShortcut(key("ArrowLeft", { ctrl: true, alt: true }), false)).toBe(false);
  });

  it("geliştirirken yenileme serbesttir", () => {
    expect(isBrowserShortcut(key("F5"), true)).toBe(false);
    expect(isBrowserShortcut(key("r", { ctrl: true }), true)).toBe(false);
    expect(isBrowserShortcut(key("F5"), false)).toBe(true);
  });
});
