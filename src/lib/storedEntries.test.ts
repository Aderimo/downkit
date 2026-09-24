import { describe, expect, test } from "vitest";
import { normalizeHistoryEntry } from "./downloadHistory";
import { normalizeSearchEntry } from "./recentSearches";
import { isMediaPath } from "./validation";

describe("normalizeHistoryEntry", () => {
  test("eski sürümün kaydı eksik alanlarla okunabilir", () => {
    const entry = normalizeHistoryEntry({
      filePath: "C:\\Videolar\\Şarkı ığüşöç.mp3",
      fileSizeBytes: 1234,
      completedAt: "2026-09-01T10:00:00.000Z",
    });
    expect(entry).toMatchObject({
      fileName: "Şarkı ığüşöç.mp3",
      title: "Şarkı ığüşöç.mp3",
      platform: "local",
      operation: "convert",
      formatLabel: "MP3",
      sourceUrl: null,
    });
    expect(entry?.id).toBeTruthy();
  });

  test("platformu olan eski kayıt indirme sayılır", () => {
    const entry = normalizeHistoryEntry({ filePath: "/tmp/a.mp4", platform: "youtube" });
    expect(entry?.operation).toBe("download");
  });

  test("dosya yolu olmayan ya da bozuk kayıt atlanır", () => {
    expect(normalizeHistoryEntry(null)).toBeNull();
    expect(normalizeHistoryEntry("metin")).toBeNull();
    expect(normalizeHistoryEntry({ title: "yolsuz" })).toBeNull();
  });
});

describe("normalizeSearchEntry", () => {
  test("eski sürümdeki düz metin link okunur ve platformu tespit edilir", () => {
    expect(normalizeSearchEntry("https://youtu.be/abc")).toEqual({
      url: "https://youtu.be/abc",
      title: null,
      thumbnailUrl: null,
      platform: "youtube",
      searchedAt: null,
    });
  });

  test("platformu tanınmayan eski link platformsuz kalır", () => {
    expect(normalizeSearchEntry("https://example.com/v")?.platform).toBeNull();
  });

  test("yeni kayıt olduğu gibi korunur", () => {
    const raw = {
      url: "https://youtu.be/abc",
      title: "Başlık",
      thumbnailUrl: "https://i.ytimg.com/x.jpg",
      platform: "youtube",
      searchedAt: "2026-09-01T10:00:00.000Z",
    };
    expect(normalizeSearchEntry(raw)).toEqual(raw);
  });

  test("linki olmayan kayıt atlanır", () => {
    expect(normalizeSearchEntry({ title: "linksiz" })).toBeNull();
    expect(normalizeSearchEntry(42)).toBeNull();
  });
});

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
