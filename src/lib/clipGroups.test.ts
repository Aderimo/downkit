import { describe, expect, it } from "vitest";
import {
  copyClips,
  expandGroups,
  groupClips,
  moveClips,
  pasteClips,
  rippleDelete,
  ungroupClips,
} from "./clipGroups";
import type { SeqClip } from "./sequence";

const c = (
  id: string,
  start: number,
  length: number,
  track = 0,
  extra: Partial<SeqClip> = {},
): SeqClip => ({
  id,
  track,
  start,
  srcStart: 0,
  srcEnd: length,
  speed: 1,
  name: "",
  ...extra,
});
const at = (clips: SeqClip[]) => Object.fromEntries(clips.map((x) => [x.id, [x.start, x.track]]));

describe("çoklu klip işlemleri", () => {
  it("dalgalı silme: aynı izde arkadakiler boşluğu kapatır, diğer iz yerinde kalır", () => {
    const clips = [c("a", 0, 5), c("b", 5, 3), c("d", 8, 4), c("ust", 6, 2, 1)];
    expect(at(rippleDelete(clips, ["b"]))).toEqual({ a: [0, 0], d: [5, 0], ust: [6, 1] });
    expect(at(rippleDelete(clips, ["a", "b"]))).toEqual({ d: [0, 0], ust: [6, 1] });
  });

  it("birlikte taşıma düzeni korur; doluysa en yakın boş yere oturur", () => {
    const clips = [c("a", 0, 2), c("b", 3, 2), c("engel", 10, 5)];
    expect(at(moveClips(clips, ["a", "b"], 2))).toMatchObject({ a: [2, 0], b: [5, 0] });
    // 9'a istenirse engelle çakışır: en yakın geçerli yer engelin hemen önü (a=5, b=8).
    expect(at(moveClips(clips, ["a", "b"], 9))).toMatchObject({ a: [5, 0], b: [8, 0] });
    // Üst ize birlikte geçer.
    expect(at(moveClips(clips, ["a", "b"], 0, 1))).toMatchObject({ a: [0, 1], b: [3, 1] });
    // Sınır dışı iz: yerinde kalır.
    expect(at(moveClips(clips, ["a"], 0, 5))).toMatchObject({ a: [0, 0] });
  });

  it("grup üyesi seçilince tüm grup seçilir; grup çözülür", () => {
    const clips = groupClips([c("a", 0, 1), c("b", 2, 1), c("x", 5, 1)], ["a", "b"], "g1");
    expect(expandGroups(clips, ["b"])).toEqual(["a", "b"]);
    expect(expandGroups(clips, ["x"])).toEqual(["x"]);
    expect(ungroupClips(clips, ["a"]).every((x) => x.group === undefined)).toBe(true);
  });

  it("yapıştırma imlece; doluysa ileride ilk boş yere, yeni kimlik ve yeni grupla", () => {
    let n = 0;
    const newId = () => `n${(n += 1)}`;
    const clips = [c("a", 0, 4), c("b", 4, 2, 0, { group: "g" }), c("d", 6, 2, 0, { group: "g" })];
    const copied = copyClips(clips, ["b", "d"]);
    expect(copied.map((x) => x.start)).toEqual([0, 2]);
    const empty = pasteClips(clips, copied, 20, newId);
    expect(empty.clips.slice(-2).map((x) => x.start)).toEqual([20, 22]);
    const busy = pasteClips(clips, copied, 1, newId);
    const pasted = busy.clips.filter((x) => busy.ids.includes(x.id));
    expect(pasted.map((x) => x.start)).toEqual([8, 10]);
    expect(new Set(pasted.map((x) => x.group)).size).toBe(1);
    expect(pasted[0].group).not.toBe("g");
  });
});
