import { describe, expect, it } from "vitest";
import { audioLaneNumbers, volumeDb } from "./laneItems";
import { audibleMusic, type MusicItem } from "./layers";
import { audioLaneAudible, audioLaneKey, audioSoloActive, flatten, type SeqClip } from "./sequence";

const m = (id: string, lane?: number): MusicItem => ({
  id,
  path: `${id}.mp3`,
  name: id,
  start: 0,
  srcStart: 0,
  length: 5,
  sourceDuration: 10,
  volume: 1,
  fadeIn: 0,
  fadeOut: 0,
  ...(lane === undefined ? {} : { lane }),
});

describe("ses izleri", () => {
  it("ses düzeyi desibel olarak", () => {
    expect(volumeDb(1)).toBe("0 dB");
    expect(volumeDb(0.5)).toBe("−6 dB");
    expect(volumeDb(2)).toBe("+6 dB");
    expect(volumeDb(0)).toBe("−∞ dB");
  });

  it("A1'den kullanılan son ize kadar izler gösterilir; müzik varsayılan A2", () => {
    expect(audioLaneNumbers([])).toEqual([]);
    expect(audioLaneNumbers([m("muzik")])).toEqual([0, 1]);
    expect(audioLaneNumbers([m("a", 0), m("b", 2)])).toEqual([0, 1, 2]);
  });

  it("sessiz iz duyulmaz; yalnız dinlemede yalnızca o iz duyulur", () => {
    const tracks = { [audioLaneKey(1)]: { muted: true } };
    expect(audioLaneAudible(tracks, 1)).toBe(false);
    expect(audioLaneAudible(tracks, 0)).toBe(true);
    const solo = { [audioLaneKey(0)]: { solo: true } };
    expect(audioSoloActive(solo)).toBe(true);
    expect(audibleMusic([m("ses", 0), m("muzik", 1)], solo).map((x) => x.id)).toEqual(["ses"]);
    // Video izlerinin durumu yalnız dinlemeyi açmaz.
    expect(audioSoloActive({ 0: { solo: true } })).toBe(false);
  });

  it("bir ses izi yalnız dinlenirken videonun kendi sesi susar", () => {
    const clip: SeqClip = {
      id: "c",
      track: 0,
      start: 0,
      srcStart: 0,
      srcEnd: 4,
      speed: 1,
      name: "",
    };
    expect(flatten([clip], {})[0].volume).toBe(1);
    expect(flatten([clip], { [audioLaneKey(0)]: { solo: true } })[0].volume).toBe(0);
  });
});
