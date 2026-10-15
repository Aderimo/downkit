import { describe, expect, it } from "vitest";
import { allBeatTimes, beatTimes, splitAtTimes } from "./beats";
import { parseMusic, type MusicItem } from "./layers";
import { clipEnd, type SeqClip } from "./sequence";

const music = (over: Partial<MusicItem> = {}): MusicItem => ({
  id: "m",
  path: "C:/m.mp3",
  name: "m",
  start: 10,
  srcStart: 5,
  length: 4,
  sourceDuration: 60,
  volume: 1,
  fadeIn: 0,
  fadeOut: 0,
  ...over,
});

describe("ritim", () => {
  it("vuruşlar müziğin görünen kısmında, zaman çizelgesine çevrilir", () => {
    const m = music({ beats: [4, 5, 6.5, 8, 9.5] });
    expect(beatTimes(m)).toEqual([10, 11.5, 13]);
    expect(beatTimes(music())).toEqual([]);
    expect(allBeatTimes([m, music({ id: "x", start: 0, srcStart: 0, beats: [1] })])).toEqual([
      10, 11.5, 13, 1,
    ]);
  });

  it("kayıttan okunur: bozuk değerler atılır, sıralanır", () => {
    const [m] = parseMusic([{ ...music(), beats: [3, "x", -1, 2, Infinity] }]);
    expect(m!.beats).toEqual([2, 3]);
    const [plain] = parseMusic([music()]);
    expect(plain).not.toHaveProperty("beats");
  });

  it("ana izdeki klipler verilen anlardan bölünür, üst iz ve kenarlar değişmez", () => {
    let n = 0;
    const clips: SeqClip[] = [
      { id: "a", track: 0, start: 0, srcStart: 0, srcEnd: 10, speed: 1, name: "" },
      { id: "t", track: 1, start: 0, srcStart: 0, srcEnd: 10, speed: 1, name: "" },
    ];
    const out = splitAtTimes(clips, [6, 2, 10, 0.05], () => `n${(n += 1)}`);
    const main = out.filter((c) => c.track === 0).sort((a, b) => a.start - b.start);
    expect(main.map((c) => [c.start, clipEnd(c)])).toEqual([
      [0, 2],
      [2, 6],
      [6, 10],
    ]);
    expect(out.filter((c) => c.track === 1)).toHaveLength(1);
  });
});
