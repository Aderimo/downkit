import { describe, expect, it } from "vitest";
import { mergeEffectLook, newEffect, parseEffects, withEffects } from "./effectLane";
import { flatten, type SeqClip } from "./sequence";
import { packRows } from "./laneItems";
import { cutTimeline } from "./rangeCut";

const clip = (id: string, start: number, length: number, patch: Partial<SeqClip> = {}) =>
  ({
    id,
    track: 0,
    start,
    srcStart: 100 + start,
    srcEnd: 100 + start + length,
    speed: 1,
    name: "",
    ...patch,
  }) as SeqClip;

describe("effect lane", () => {
  it("splits segments at block edges and applies the block only inside", () => {
    const segments = flatten([clip("a", 0, 10, { fadeIn: 1, fadeOut: 1 })]);
    const bw = newEffect("e", 2, 5, { look: { filter: "bw" } });
    const out = withEffects(segments, [bw]);
    expect(out.map((s) => [s.tStart, s.tEnd, s.srcStart, s.look?.filter ?? "none"])).toEqual([
      [0, 2, 100, "none"],
      [2, 5, 102, "bw"],
      [5, 10, 105, "none"],
    ]);
    // Açılma yalnız ilk parçada, kararma yalnız son parçada.
    expect(out.map((s) => [s.fadeIn, s.fadeOut])).toEqual([
      [1, 0],
      [0, 0],
      [0, 1],
    ]);
    expect(withEffects(segments, [])).toBe(segments);
  });

  it("motion follows the block (starts and ends with it)", () => {
    const [, mid] = withEffects(flatten([clip("a", 0, 10)]), [
      newEffect("m", 4, 8, { motion: "zoomIn", motionStrength: 0.4 }),
    ]);
    expect(mid).toMatchObject({
      motion: "zoomIn",
      motionStrength: 0.4,
      clipStart: 4,
      clipLength: 4,
    });
  });

  it("merges looks: filter replaces, blur keeps the larger, mirror / vignette switch on", () => {
    const look = mergeEffectLook({ filter: "sepia", blur: 0.5 } as never, [
      newEffect("a", 0, 1, { look: { filter: "bw", blur: 0.2 } }),
      newEffect("b", 0, 1, { look: { vignette: true, mirror: true } }),
    ]);
    expect(look).toMatchObject({ filter: "bw", blur: 0.5, vignette: true, mirror: true });
  });

  it("parses saved blocks and keeps them in sync when the timeline is cut", () => {
    expect(
      parseEffects([
        { id: "a", start: 1, end: 3, look: { filter: "bw", blur: 9 } },
        { id: "b", start: 3, end: 1, look: { filter: "bw" } },
        { id: "c", start: 0, end: 2, look: { filter: "nope" } },
        { id: "d", start: 0, end: 2, motion: "shake", motionStrength: 0.3 },
      ]),
    ).toEqual([
      { id: "a", start: 1, end: 3, look: { filter: "bw", blur: 1 } },
      { id: "d", start: 0, end: 2, motion: "shake", motionStrength: 0.3 },
    ]);
    const cut = cutTimeline(
      {
        clips: [clip("a", 0, 10)],
        texts: [],
        images: [],
        blurs: [],
        music: [],
        effects: [newEffect("e", 6, 8, { look: { filter: "bw" } })],
      },
      [{ start: 1, end: 3 }],
      () => "x",
    );
    expect(cut.effects).toEqual([{ id: "e", start: 4, end: 6, look: { filter: "bw" } }]);
  });
});

describe("lane packing", () => {
  it("puts overlapping blocks on separate rows and reuses free rows", () => {
    const { rows, count } = packRows([
      { id: "a", start: 0, end: 5 },
      { id: "b", start: 2, end: 4 },
      { id: "c", start: 5, end: 7 },
      { id: "d", start: 3, end: 6 },
    ]);
    expect(count).toBe(3);
    expect([rows.get("a"), rows.get("b"), rows.get("d"), rows.get("c")]).toEqual([0, 1, 2, 0]);
    expect(packRows([]).count).toBe(1);
  });
});
