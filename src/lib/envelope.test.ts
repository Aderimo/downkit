import { describe, expect, it } from "vitest";
import { envelopeAt, parseEnvelope, toMusicTracks, type MusicItem } from "./layers";

const item: MusicItem = {
  id: "m",
  path: "C:/m.mp3",
  name: "m",
  start: 2,
  srcStart: 0,
  length: 10,
  sourceDuration: 60,
  volume: 0.8,
  fadeIn: 0,
  fadeOut: 0,
  envelope: [
    [0, 1],
    [4, 0.2],
    [10, 1],
  ],
};

describe("ses zarfı", () => {
  it("noktalar arası doğrusal, uçlarda sabit, zarf yoksa 1", () => {
    expect(envelopeAt(item.envelope, 2)).toBeCloseTo(0.6);
    expect(envelopeAt(item.envelope, -1)).toBe(1);
    expect(envelopeAt(item.envelope, 20)).toBe(1);
    expect(envelopeAt(undefined, 3)).toBe(1);
  });

  it("kayıttan okunur: sınırlanır, sıralanır, düz zarf atılır", () => {
    expect(
      parseEnvelope([
        [5, 3],
        [1, -1],
        ["x", 1],
      ]),
    ).toEqual([
      [1, 0],
      [5, 2],
    ]);
    expect(
      parseEnvelope([
        [0, 1],
        [3, 1],
      ]),
    ).toBeUndefined();
  });

  it("dışa aktarmada parçanın başına göre kayar", () => {
    // Zaman çizelgesi 0–4 kesilip atılmış gibi: ikinci parça 6. saniyeden başlar.
    const [, second] = toMusicTracks(
      [item],
      [
        { tStart: 0, tEnd: 4 },
        { tStart: 6, tEnd: 12 },
      ],
    );
    expect(second!.envelope![1]).toEqual([0, 0.2]);
    expect(second!.envelope![0]).toEqual([-4, 1]);
  });
});
