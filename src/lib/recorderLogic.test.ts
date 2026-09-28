import { describe, expect, it } from "vitest";
import {
  captureTarget,
  fileStamp,
  hotkeyFromEvent,
  hotkeyLabel,
  resolveSource,
  toAccelerator,
} from "./recorderLogic";
import { DEFAULT_RECORDER_SETTINGS, normalizeRecorderSettings } from "./recorderSettings";
import type { RecorderSources } from "../types/recorder";

const sources: RecorderSources = {
  monitors: [
    { hmonitor: 11, ddaIndex: 1, x: 0, y: 0, width: 2560, height: 1440, primary: false, number: 1 },
    {
      hmonitor: 22,
      ddaIndex: 0,
      x: 2560,
      y: 0,
      width: 1920,
      height: 1080,
      primary: true,
      number: 2,
    },
  ],
  windows: [
    {
      hwnd: 5,
      title: "Oyun",
      exe: "game.exe",
      width: 1920,
      height: 1080,
      minimized: false,
      own: false,
    },
    {
      hwnd: 6,
      title: "Ayarlar",
      exe: "Game.exe",
      width: 800,
      height: 600,
      minimized: false,
      own: false,
    },
  ],
  microphones: [],
  speakers: [],
};

describe("kayıt kaynağı", () => {
  it("0 birincil ekran demektir; olmayan ekran birincile düşer", () => {
    expect(resolveSource({ kind: "monitor", number: 0 }, sources)).toMatchObject({ hmonitor: 22 });
    expect(resolveSource({ kind: "monitor", number: 1 }, sources)).toMatchObject({ hmonitor: 11 });
    expect(resolveSource({ kind: "monitor", number: 9 }, sources)).toMatchObject({ hmonitor: 22 });
  });

  it("pencere program ve başlıkla, yoksa aynı programın başka penceresiyle bulunur", () => {
    expect(
      resolveSource({ kind: "window", exe: "GAME.EXE", title: "Ayarlar" }, sources),
    ).toMatchObject({ hwnd: 6 });
    expect(
      resolveSource({ kind: "window", exe: "game.exe", title: "Kapandı" }, sources),
    ).toMatchObject({ hwnd: 5 });
    expect(resolveSource({ kind: "window", exe: "yok.exe", title: "x" }, sources)).toBeNull();
  });

  it("yakalama hedefi türüne göre kurulur", () => {
    expect(captureTarget(sources.monitors[1])).toEqual({
      kind: "monitor",
      hmonitor: 22,
      ddaIndex: 0,
      width: 1920,
      height: 1080,
    });
    expect(captureTarget(sources.windows[0])).toEqual({
      kind: "window",
      hwnd: 5,
      width: 1920,
      height: 1080,
    });
  });
});

describe("kayıt dosyası ve kısayol", () => {
  it("dosya adı zamanı iki nokta içermez", () => {
    expect(fileStamp(new Date(2026, 8, 5, 7, 3, 9))).toBe("2026-09-05 07.03.09");
  });

  it("sistem geneli kısayol değiştirici ya da F tuşu ister", () => {
    expect(toAccelerator("Ctrl+Alt+F9")).toBe("Ctrl+Alt+F9");
    expect(toAccelerator("F8")).toBe("F8");
    expect(toAccelerator("Ctrl+,")).toBe("Ctrl+Comma");
    expect(toAccelerator("Ctrl++")).toBe("Ctrl+Equal");
    expect(toAccelerator("S")).toBeNull();
    expect(toAccelerator("Shift+S")).toBeNull();
    expect(toAccelerator("Alt+Shift+S")).toBe("Alt+Shift+S");
  });

  it("bozuk kayıt ayarları varsayılana döner", () => {
    const s = normalizeRecorderSettings({
      fps: 45,
      maxHeight: 1080,
      systemVolume: 9,
      source: { kind: "window", exe: "a.exe" },
      hotkeys: { record: null, saveReplay: 5 },
    });
    expect(s.fps).toBe(DEFAULT_RECORDER_SETTINGS.fps);
    expect(s.maxHeight).toBe(1080);
    expect(s.systemVolume).toBe(2);
    expect(s.source).toEqual(DEFAULT_RECORDER_SETTINGS.source);
    expect(s.hotkeys.record).toBeNull();
    expect(s.hotkeys.saveReplay).toBe(DEFAULT_RECORDER_SETTINGS.hotkeys.saveReplay);
  });
});

const press = (
  keyCode: number,
  key: string,
  mods: { ctrl?: boolean; alt?: boolean; shift?: boolean } = {},
) =>
  hotkeyFromEvent({
    keyCode,
    key,
    ctrlKey: !!mods.ctrl,
    altKey: !!mods.alt,
    shiftKey: !!mods.shift,
    metaKey: false,
  });

describe("kısayol atama", () => {
  it("tuş klavye düzeninden bağımsız, Windows'un sanal tuş koduyla okunur", () => {
    // Türkçe Q: I tuşu 'ı' yazar ama sanal kodu yine I'dır.
    expect(press(73, "ı", { alt: true })).toEqual({ combo: "Alt+I" });
    expect(press(120, "F9", { ctrl: true, alt: true })).toEqual({ combo: "Ctrl+Alt+F9" });
    expect(press(121, "F10", { ctrl: true, alt: true, shift: true })).toEqual({
      combo: "Ctrl+Alt+Shift+F10",
    });
    expect(press(70, "f", { alt: true })).toEqual({ combo: "Alt+F" });
  });

  it("numpad rakamı üst sıradaki rakamdan ayrı tuştur", () => {
    expect(press(97, "1", { ctrl: true })).toEqual({ combo: "Ctrl+Numpad1" });
    expect(press(49, "1", { ctrl: true })).toEqual({ combo: "Ctrl+1" });
    expect(toAccelerator("Ctrl+Numpad1")).toBe("Ctrl+Numpad1");
    expect(hotkeyLabel("Ctrl+Numpad1")).toBe("Ctrl + Num 1");
    expect(hotkeyLabel("Ctrl+Alt+F9")).toBe("Ctrl + Alt + F9");
  });

  it("yalnızca değiştirici tuş ya da düzene bağlı noktalama kabul edilmez", () => {
    expect(press(18, "Alt", { alt: true })).toEqual({ reason: "modifier" });
    expect(press(188, "ö", { ctrl: true })).toEqual({ reason: "unsupported" });
    expect(press(70, "f")).toEqual({ reason: "needsModifier" });
    expect(press(115, "F4", { alt: true })).toEqual({ reason: "reserved" });
  });

  it("AltGr ile karakter yazan birleşim reddedilir", () => {
    // Türkçe Q'da Ctrl+Alt+Q "@" yazar.
    expect(press(81, "@", { ctrl: true, alt: true })).toEqual({ reason: "altGr", char: "@" });
    expect(press(82, "r", { ctrl: true, alt: true })).toEqual({ combo: "Ctrl+Alt+R" });
  });
});
