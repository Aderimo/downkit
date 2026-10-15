import { describe, expect, test } from "vitest";
import { isMediaPath } from "./validation";

describe("isMediaPath", () => {
  test("medya uzantıları büyük/küçük harften bağımsız tanınır", () => {
    expect(isMediaPath("C:\\Videolar\\klip.MP4")).toBe(true);
    expect(isMediaPath("/home/kisi/ses.flac")).toBe(true);
  });

  test("medya olmayan ve uzantısız dosyalar reddedilir", () => {
    expect(isMediaPath("C:\\belge.pdf")).toBe(false);
    expect(isMediaPath("C:\\program.exe")).toBe(false);
    expect(isMediaPath("C:\\klasor.mp4\\dosya")).toBe(false);
  });
});
