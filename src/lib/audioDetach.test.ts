import { describe, expect, it } from "vitest";
import { detachAudio, isDetached, reattachAudio, type DetachSource } from "./audioDetach";
import type { SeqClip } from "./sequence";

const sources: DetachSource[] = [
  { id: "s1", path: "C:\\oyun.mp4", title: "oyun.mp4", duration: 60, hasAudio: true },
  { id: "s2", path: "C:\\sessiz.mp4", title: "sessiz.mp4", duration: 30, hasAudio: false },
];
const clip = (id: string, extra: Partial<SeqClip> = {}): SeqClip => ({
  id,
  sourceId: "s1",
  track: 0,
  start: 10,
  srcStart: 5,
  srcEnd: 15,
  speed: 1,
  name: "",
  ...extra,
});
let n = 0;
const newId = () => `m${(n += 1)}`;

describe("sesi ayır", () => {
  it("klibin sesi aynı aralıkla A1'e konur, videonun sesi kısılır", () => {
    const r = detachAudio([clip("a", { volume: 0.8, fadeIn: 1 })], [], ["a"], sources, newId);
    expect(r.detached).toBe(1);
    expect(r.clips[0].volume).toBe(0);
    expect(r.music).toHaveLength(1);
    expect(r.music[0]).toMatchObject({
      path: "C:\\oyun.mp4",
      start: 10,
      srcStart: 5,
      length: 10,
      volume: 0.8,
      fadeIn: 1,
      lane: 0,
      linkedClipId: "a",
    });
    expect(isDetached(r.music, "a")).toBe(true);
  });

  it("hızı değişmiş, sesi olmayan ve zaten ayrılmış klipler atlanır", () => {
    const first = detachAudio([clip("a")], [], ["a"], sources, newId);
    const again = detachAudio(first.clips, first.music, ["a"], sources, newId);
    expect(again.detached).toBe(0);
    expect(again.music).toHaveLength(1);
    const r = detachAudio(
      [clip("hizli", { speed: 2 }), clip("sessiz", { sourceId: "s2" })],
      [],
      ["hizli", "sessiz"],
      sources,
      newId,
    );
    expect([r.detached, r.skippedSpeed, r.noAudio]).toEqual([0, 1, 1]);
    expect(r.clips.every((c) => c.volume === undefined)).toBe(true);
  });

  it("geri bağlanınca ses bloğu silinir, klibin sesi bloğun düzeyiyle açılır", () => {
    const d = detachAudio([clip("a"), clip("b", { start: 30 })], [], ["a", "b"], sources, newId);
    const music = d.music.map((m) => (m.linkedClipId === "a" ? { ...m, volume: 1.5 } : m));
    const r = reattachAudio(d.clips, music, ["a"]);
    expect(r.reattached).toBe(1);
    expect(r.clips.find((c) => c.id === "a")?.volume).toBe(1.5);
    expect(r.clips.find((c) => c.id === "b")?.volume).toBe(0);
    expect(r.music.map((m) => m.linkedClipId)).toEqual(["b"]);
  });
});
