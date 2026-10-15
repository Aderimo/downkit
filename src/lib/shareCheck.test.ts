import { describe, expect, it } from "vitest";
import { missingFiles, shareIssues, textBox, type ShareCheckInput } from "./shareCheck";
import type { SeqClip } from "./sequence";
import type { TextItem } from "./textItems";

const clip = (over: Partial<SeqClip> = {}): SeqClip => ({
  id: "a",
  track: 0,
  start: 0,
  srcStart: 0,
  srcEnd: 20,
  speed: 1,
  name: "",
  ...over,
});

const base = (over: Partial<ShareCheckInput> = {}): ShareCheckInput => ({
  clips: [clip()],
  tracks: {},
  texts: [],
  images: [],
  music: [],
  frame: "9:16",
  loudness: true,
  sourceAspect: 9 / 16,
  template: "sideButtons",
  ...over,
});

const text = (over: Partial<TextItem>): TextItem =>
  ({
    id: "t",
    text: "Merhaba",
    start: 0,
    end: 2,
    x: 0.5,
    y: 0.5,
    size: 0.07,
    color: "#fff",
    box: false,
    bold: true,
    ...over,
  }) as TextItem;

describe("paylaşmadan önce kontrol", () => {
  it("temiz projede uyarı yok", () => {
    expect(shareIssues(base())).toEqual([]);
  });

  it("boş zaman çizelgesi", () => {
    expect(shareIssues(base({ clips: [] })).map((i) => i.id)).toEqual(["empty"]);
  });

  it("alttaki açıklama alanına giren yazı uyarılır, ortadaki uyarılmaz", () => {
    const issues = shareIssues(base({ texts: [text({ y: 0.9 }), text({ id: "u", y: 0.5 })] }));
    expect(issues).toContainEqual({ id: "textInZone", level: "warn", params: { count: 1 } });
    // Yatay çıktıda telefon alanı denetlenmez.
    expect(
      shareIssues(base({ frame: "16:9", texts: [text({ y: 0.9 })] })).map((i) => i.id),
    ).not.toContain("textInZone");
  });

  it("siyah boşluk, sessizlik, ses seviyesi, oran ve süre", () => {
    const ids = shareIssues(
      base({
        clips: [clip(), clip({ id: "b", start: 25, srcStart: 30, srcEnd: 110 })],
        tracks: {},
        loudness: false,
        frame: "9:16",
      }),
    ).map((i) => i.id);
    expect(ids).toEqual(["gap", "loudness", "long"]);
    const silent = shareIssues(base({ clips: [clip({ volume: 0 })] })).map((i) => i.id);
    expect(silent).toContain("silent");
    const wide = shareIssues(base({ frame: "original", sourceAspect: 16 / 9 })).map((i) => i.id);
    expect(wide).toContain("landscape");
  });

  it("yazı kutusu kısa kenara göre", () => {
    const box = textBox({ x: 0.5, y: 0.5, size: 0.1, text: "abcd" });
    expect(box.w).toBeCloseTo(0.22);
    expect(box.x).toBeCloseTo(0.39);
  });

  it("eksik dosyalar adlarıyla", async () => {
    const names = await missingFiles(["C:/a/x.mp4", "C:/b/y.png", "C:/a/x.mp4", ""], async (p) =>
      p.map((x) => !x.endsWith("y.png")),
    );
    expect(names).toEqual(["y.png"]);
  });
});
