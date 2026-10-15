import { describe, expect, it } from "vitest";
import { laneEnd, moveLaneItem } from "./laneItems";
import type { ImageItem, MusicItem } from "./layers";

const song: MusicItem = {
  id: "m1",
  path: "a.mp3",
  name: "a.mp3",
  start: 10,
  srcStart: 5,
  length: 20,
  sourceDuration: 40,
  volume: 1,
  fadeIn: 0,
  fadeOut: 0,
};
const logo: ImageItem = {
  id: "i1",
  path: "l.png",
  name: "l.png",
  start: 2,
  end: 8,
  x: 0.5,
  y: 0.5,
  size: 0.2,
  opacity: 1,
};

describe("moveLaneItem", () => {
  it("müziği taşır, 0'ın altına inmez", () => {
    expect(moveLaneItem(song, "move", song, 4).start).toBe(14);
    expect(moveLaneItem(song, "move", song, -50).start).toBe(0);
  });
  it("müziğin sonu dosyanın dışına uzamaz", () => {
    expect(moveLaneItem(song, "end", song, 100).length).toBe(35);
    expect(moveLaneItem(song, "end", song, -100).length).toBeCloseTo(0.2);
  });
  it("baştan kırpınca bitiş yerinde kalır, dosyada da ilerler", () => {
    const cut = moveLaneItem(song, "start", song, 3);
    expect([cut.start, cut.srcStart, cut.length]).toEqual([13, 8, 17]);
    expect(laneEnd(cut)).toBe(laneEnd(song));
    // Dosyanın başından öteye geri çekilemez.
    expect(moveLaneItem(song, "start", song, -20).srcStart).toBe(0);
  });
  it("logo taşınınca süresi korunur, kenarı kısaltılır", () => {
    const moved = moveLaneItem(logo, "move", logo, 3);
    expect([moved.start, moved.end]).toEqual([5, 11]);
    expect(moveLaneItem(logo, "end", logo, -10).end).toBeCloseTo(2.2);
    expect(moveLaneItem(logo, "start", logo, -5).start).toBe(0);
  });
});
