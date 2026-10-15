import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPlacements,
  exportFrames,
  frameSuffix,
  placementsDiffer,
  parseAlsoFrames,
  parsePlacement,
  previewFrame,
  swapPlacement,
  textsForFrame,
  toggleFrame,
} from "./multiFormat";
import { newText, type TextItem } from "./textItems";
import { retargetTrack } from "./faceTrack";
import { useEditorStore } from "../store/editorStore";
import { parseProject } from "./projectFile";

const text = (id: string, x: number, y: number, size = 0.07): TextItem => ({
  ...newText(id, 0, id),
  x,
  y,
  size,
});

describe("swapPlacement", () => {
  it("stores the old format and inherits the position when the new one is unplaced", () => {
    const [a] = swapPlacement([text("a", 0.5, 0.8)], "9:16", "16:9");
    expect(a).toMatchObject({ x: 0.5, y: 0.8, at: { "9:16": { x: 0.5, y: 0.8, size: 0.07 } } });
  });

  it("round-trips positions between formats", () => {
    let texts = swapPlacement([text("a", 0.5, 0.8)], "9:16", "16:9");
    texts = texts.map((t) => ({ ...t, x: 0.2, y: 0.3, size: 0.1 }));
    texts = swapPlacement(texts, "16:9", "9:16");
    expect(texts[0]).toMatchObject({ x: 0.5, y: 0.8, size: 0.07 });
    expect(texts[0].at).toEqual({ "16:9": { x: 0.2, y: 0.3, size: 0.1 } });
    texts = swapPlacement(texts, "9:16", "16:9");
    expect(texts[0]).toMatchObject({ x: 0.2, y: 0.3, size: 0.1 });
    expect(texts[0].at).toEqual({ "9:16": { x: 0.5, y: 0.8, size: 0.07 } });
  });

  it("is a no-op for the same format", () => {
    const texts = [text("a", 0.5, 0.8)];
    expect(swapPlacement(texts, "1:1", "1:1")).toBe(texts);
  });
});

describe("textsForFrame", () => {
  const placed: TextItem = {
    ...text("a", 0.5, 0.8),
    at: { "1:1": { x: 0.3, y: 0.6, size: 0.05 } },
  };
  it("uses the stored position of another format, else the current one", () => {
    expect(textsForFrame([placed], "1:1", "9:16")[0]).toMatchObject({ x: 0.3, y: 0.6, size: 0.05 });
    expect(textsForFrame([placed], "16:9", "9:16")[0]).toMatchObject({ x: 0.5, y: 0.8 });
    expect(textsForFrame([placed], "9:16", "9:16")[0]).toBe(placed);
  });

  it("clears format positions", () => {
    expect(placementsDiffer([placed], ["9:16", "1:1"])).toBe(true);
    expect(placementsDiffer([placed], ["9:16", "16:9"])).toBe(false);
    // Aynı yerde duran kayıt fark sayılmaz.
    expect(
      placementsDiffer([{ ...placed, at: { "1:1": { x: 0.5, y: 0.8, size: 0.07 } } }], ["1:1"]),
    ).toBe(false);
    const [cleared] = clearPlacements([placed]);
    expect(cleared.at).toBeUndefined();
    expect(placementsDiffer([cleared], ["1:1"])).toBe(false);
  });
});

describe("format set", () => {
  it("lists the previewed format first, then the extras in a fixed order", () => {
    expect(exportFrames({ frame: "1:1", alsoFrames: ["16:9", "9:16", "1:1"] })).toEqual([
      "1:1",
      "9:16",
      "16:9",
    ]);
    expect(exportFrames({ frame: "original", alsoFrames: ["9:16"] })).toEqual(["original"]);
  });

  it("toggles extras and keeps the set when switching the preview", () => {
    const o = {
      frame: "9:16" as const,
      alsoFrames: toggleFrame({ frame: "9:16", alsoFrames: [] }, "1:1"),
    };
    expect(o.alsoFrames).toEqual(["1:1"]);
    const next = previewFrame(o, "1:1");
    expect(next).toEqual({ frame: "1:1", alsoFrames: ["9:16"] });
    expect(exportFrames(next)).toEqual(["1:1", "9:16"]);
    expect(toggleFrame(o, "1:1")).toEqual([]);
  });

  it("names files and parses saved values", () => {
    expect(frameSuffix("9:16")).toBe("9x16");
    expect(parseAlsoFrames(["16:9", "x", 3, "1:1"])).toEqual(["1:1", "16:9"]);
    expect(parseAlsoFrames("9:16")).toEqual([]);
    expect(
      parsePlacement({ "1:1": { x: 2, y: 0.5, size: 0.08 }, bad: { x: 1 }, "9:16": { x: 0.1 } }),
    ).toEqual({ "1:1": { x: 1, y: 0.5, size: 0.08 } });
    expect(parsePlacement([])).toBeUndefined();
  });
});

describe("retargetTrack", () => {
  it("keeps the same face centre in a wider crop", () => {
    // 16:9 kaynak: 9:16 kırpma payı 0.316, 1:1 payı 0.5625.
    const [[, p]] = retargetTrack([[0, 1]], 16 / 9, 9 / 16, 1)!;
    const center916 = 1 * (1 - 0.31640625) + 0.31640625 / 2;
    expect(p).toBeCloseTo(Math.min(1, (center916 - 0.5625 / 2) / (1 - 0.5625)), 5);
    expect(retargetTrack([[0, 0.5]], 16 / 9, 9 / 16, 1)![0][1]).toBeCloseTo(0.5, 5);
  });

  it("drops the track when the format no longer crops or the axis changes", () => {
    expect(retargetTrack([[0, 0.3]], 16 / 9, 9 / 16, 16 / 9)).toBeNull();
    expect(retargetTrack([[0, 0.3]], 1, 9 / 16, 16 / 9)).toBeNull();
    const same: [number, number][] = [[0, 0.3]];
    expect(retargetTrack(same, 16 / 9, 9 / 16, 9 / 16)).toBe(same);
  });
});

describe("editor store", () => {
  beforeEach(() => {
    useEditorStore.setState({
      texts: [text("a", 0.5, 0.8)],
      past: [],
      future: [],
      dragOrigin: null,
      exportOptions: { ...useEditorStore.getState().exportOptions, frame: "9:16", alsoFrames: [] },
    });
  });

  it("swaps text positions and history when the previewed format changes", () => {
    const s = useEditorStore.getState();
    s.applyTexts((texts) => texts.map((t) => ({ ...t, y: 0.7 })));
    s.setExportOptions({ frame: "16:9" });
    s.applyTexts((texts) => texts.map((t) => ({ ...t, y: 0.4 })));
    expect(useEditorStore.getState().texts[0]).toMatchObject({
      y: 0.4,
      at: { "9:16": { y: 0.7 } },
    });
    useEditorStore.getState().setExportOptions({ frame: "9:16" });
    expect(useEditorStore.getState().texts[0]).toMatchObject({
      y: 0.7,
      at: { "16:9": { y: 0.4 } },
    });
    // Geri alma da önizlenen biçimde: 16:9'daki taşıma geri alınır, 9:16 yeri durur.
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().texts[0]).toMatchObject({
      y: 0.7,
      at: { "16:9": { y: 0.7 } },
    });
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().texts[0].y).toBe(0.8);
  });

  it("keeps format positions in the project file", () => {
    const data = parseProject(
      JSON.stringify({
        schemaVersion: 1,
        sources: [{ id: "s1", path: "C:/a.mp4", title: "a.mp4" }],
        clips: [],
        texts: [{ ...text("a", 0.5, 0.8), at: { "1:1": { x: 0.4, y: 0.5, size: 0.06 }, x: 1 } }],
      }),
    );
    expect(data.texts[0].at).toEqual({ "1:1": { x: 0.4, y: 0.5, size: 0.06 } });
  });
});
