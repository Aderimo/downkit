import { describe, expect, it } from "vitest";
import {
  applyTransitionAt,
  chapterAt,
  clipFades,
  hasEffects,
  segmentEffects,
  setFade,
  setVolume,
  clipAt,
  clipEnd,
  closeGaps,
  deleteClips,
  duplicateClip,
  exportPieces,
  flatten,
  initialClips,
  keepOnly,
  moveClip,
  nextSegment,
  outputDuration,
  piecesDuration,
  segmentAt,
  sequenceEnd,
  setSpeed,
  snap,
  sourceTimeAt,
  splitAt,
  splitAtChapters,
  splitClip,
  timelineTimeAt,
  timelineTimeOfSource,
  trimEnd,
  trimStart,
  type SeqClip,
} from "./sequence";

const clip = (
  id: string,
  track: number,
  start: number,
  srcStart: number,
  srcEnd: number,
  speed = 1,
): SeqClip => ({
  id,
  track,
  start,
  srcStart,
  srcEnd,
  speed,
  name: "",
});

let counter = 0;
const makeId = () => `n${++counter}`;

describe("bölme", () => {
  it("klip oynatma imlecinden ikiye bölünür", () => {
    const [a, b] = splitClip(initialClips(100, "a"), "a", 40, "b");
    expect(a).toMatchObject({ id: "a", start: 0, srcStart: 0, srcEnd: 40 });
    expect(b).toMatchObject({ id: "b", start: 40, srcStart: 40, srcEnd: 100 });
  });

  it("hızlandırılmış klipte kaynak zamanı hıza göre hesaplanır", () => {
    const [, b] = splitClip([clip("a", 0, 10, 0, 60, 2)], "a", 20, "b");
    // 10 sn zaman çizelgesi × 2 hız = kaynakta 20. saniye
    expect(b).toMatchObject({ start: 20, srcStart: 20, srcEnd: 60 });
  });

  it("kenara çok yakın bölme yok sayılır", () => {
    expect(splitClip(initialClips(100, "a"), "a", 0.05, "b")).toHaveLength(1);
  });

  it("seçim yoksa imlecin altındaki tüm izler bölünür, seçim varsa yalnızca seçili", () => {
    const clips = [clip("a", 0, 0, 0, 100), clip("o", 1, 10, 50, 80)];
    expect(splitAt(clips, 20, [], makeId)).toHaveLength(4);
    expect(splitAt(clips, 20, ["o"], makeId)).toHaveLength(3);
  });
});

describe("kırpma", () => {
  const clips = [clip("a", 0, 0, 0, 30), clip("b", 0, 30, 50, 80), clip("c", 0, 60, 90, 100)];

  it("sol kenar kaynağın başını ve önceki klibi geçemez", () => {
    const moved = trimStart(clips, "b", 10).find((c) => c.id === "b")!;
    expect(moved).toMatchObject({ start: 30, srcStart: 50 });
    const shorter = trimStart(clips, "b", 40).find((c) => c.id === "b")!;
    expect(shorter).toMatchObject({ start: 40, srcStart: 60 });
  });

  it("boşluk varsa sol kenar kaynakta geriye uzar", () => {
    const withGap = [clip("b", 0, 30, 50, 80)];
    const longer = trimStart(withGap, "b", 20).find((c) => c.id === "b")!;
    expect(longer).toMatchObject({ start: 20, srcStart: 40 });
    const limit = trimStart(withGap, "b", -100).find((c) => c.id === "b")!;
    expect(limit).toMatchObject({ start: 0, srcStart: 20 });
  });

  it("sağ kenar kaynağın sonunu ve sonraki klibi geçemez", () => {
    const b = trimEnd(clips, "b", 90, 100).find((c) => c.id === "b")!;
    expect(clipEnd(b)).toBe(60);
    const c = trimEnd(clips, "c", 500, 100).find((x) => x.id === "c")!;
    expect(c.srcEnd).toBe(100);
    const tiny = trimEnd(clips, "a", -5, 100).find((x) => x.id === "a")!;
    expect(clipEnd(tiny)).toBeCloseTo(0.2);
  });
});

describe("taşıma", () => {
  it("klip dolu yere bırakılırsa en yakın boşluğa yerleşir", () => {
    const clips = [clip("a", 0, 0, 0, 10), clip("b", 0, 10, 10, 20), clip("x", 1, 0, 50, 55)];
    const moved = moveClip(clips, "x", 8, 0).find((c) => c.id === "x")!;
    expect(moved).toMatchObject({ track: 0, start: 20 });
  });

  it("üst ize taşınan klip alttakinin üzerini örter", () => {
    const clips = [clip("a", 0, 0, 0, 100), clip("x", 0, 100, 200, 210)];
    const moved = moveClip(clips, "x", 40, 1);
    expect(moved.find((c) => c.id === "x")).toMatchObject({ track: 1, start: 40 });
    expect(clipAt(moved, 45)?.id).toBe("x");
    expect(clipAt(moved, 55)?.id).toBe("a");
  });

  it("negatif başlangıç sıfıra çekilir", () => {
    expect(moveClip([clip("a", 0, 5, 0, 10)], "a", -3, 0)[0].start).toBe(0);
  });
});

describe("hız, silme, çoğaltma", () => {
  it("hız artınca klip kısalır, azalınca arkadakiler itilir", () => {
    const clips = [clip("a", 0, 0, 0, 20), clip("b", 0, 20, 20, 30)];
    expect(clipEnd(setSpeed(clips, "a", 2).find((c) => c.id === "a")!)).toBe(10);
    const slow = setSpeed(clips, "a", 0.5);
    expect(clipEnd(slow.find((c) => c.id === "a")!)).toBe(40);
    expect(slow.find((c) => c.id === "b")!.start).toBe(40);
    expect(setSpeed(clips, "a", 99).find((c) => c.id === "a")!.speed).toBe(4);
  });

  it("silme boşluk bırakır, boşluklar kapatılabilir", () => {
    const clips = splitAt(
      splitAt(initialClips(100, "a"), 30, [], () => "b"),
      60,
      [],
      () => "c",
    );
    const without = deleteClips(clips, ["b"]);
    expect(sequenceEnd(without)).toBe(100);
    expect(sequenceEnd(closeGaps(without))).toBe(70);
    expect(keepOnly(clips, ["b"]).map((c) => c.id)).toEqual(["b"]);
  });

  it("çoğaltılan klip hemen arkasına gelir", () => {
    const clips = [clip("a", 0, 0, 0, 10), clip("b", 0, 10, 50, 60)];
    const result = duplicateClip(clips, "a", "a2");
    expect(result.find((c) => c.id === "a2")!.start).toBe(10);
    expect(result.find((c) => c.id === "b")!.start).toBe(20);
  });
});

describe("düzleştirme ve oynatma eşlemesi", () => {
  it("boşluklar atlanır, üst iz alttakini böler", () => {
    const clips = [clip("a", 0, 0, 0, 30), clip("b", 0, 50, 100, 110), clip("o", 1, 10, 300, 305)];
    const segments = flatten(clips);
    expect(segments.map((s) => [s.clipId, s.srcStart, s.srcEnd])).toEqual([
      ["a", 0, 10],
      ["o", 300, 305],
      ["a", 15, 30],
      ["b", 100, 110],
    ]);
    expect(outputDuration(segments)).toBe(40);
  });

  it("klipler arasındaki ve baştaki boşluk siyah parça olur, sondaki boş alan dışa aktarılmaz", () => {
    // 5–16 sn klip, 16–106 boşluk, 106–117 klip (Clipchamp örneği: 11 sn + 1,5 dk siyah + 11 sn).
    const clips = [clip("a", 0, 5, 0, 11), clip("b", 0, 106, 20, 31)];
    const pieces = exportPieces(flatten(clips));
    expect(pieces.map((p) => [p.kind, p.tStart, p.tEnd])).toEqual([
      ["gap", 0, 5],
      ["clip", 5, 16],
      ["gap", 16, 106],
      ["clip", 106, 117],
    ]);
    expect(piecesDuration(pieces)).toBe(117);
    // Ayrı dosyada baştaki boşluk olmaz.
    expect(exportPieces(flatten([clips[1]]), false).map((p) => p.kind)).toEqual(["clip"]);
  });

  it("gizli iz görünmez (alttaki oynar), sessiz izin sesi kısılır", () => {
    const clips = [clip("a", 0, 0, 0, 30), clip("o", 1, 10, 300, 305)];
    expect(flatten(clips, { 1: { hidden: true } }).map((s) => s.clipId)).toEqual(["a"]);
    const muted = flatten(clips, { 1: { muted: true } });
    expect(muted.find((s) => s.clipId === "o")?.volume).toBe(0);
    expect(muted.find((s) => s.clipId === "a")?.volume).toBe(1);
  });

  it("zaman çizelgesi ile kaynak zamanı birbirine çevrilir", () => {
    const [segment] = flatten([clip("a", 0, 10, 100, 140, 2)]);
    expect(sourceTimeAt(segment, 15)).toBe(110);
    expect(timelineTimeAt(segment, 110)).toBe(15);
    expect(segmentAt([segment], 5)).toBeNull();
    expect(nextSegment([segment], 5)).toBe(segment);
  });

  it("yapışma en yakın adaya, tolerans içindeyse olur", () => {
    expect(snap(9.8, [0, 10, 20], 0.5)).toBe(10);
    expect(snap(9, [0, 10, 20], 0.5)).toBe(9);
  });
});

describe("bölümler", () => {
  const chapters = [
    { start: 0, end: 30, title: "Giriş" },
    { start: 30, end: 70, title: "Orta" },
    { start: 70, end: 100, title: "" },
  ];

  it("klipler bölüm başlarından bölünür ve bölüm adını alır", () => {
    const result = splitAtChapters(initialClips(100, "a"), chapters, makeId);
    expect(result.map((c) => [c.srcStart, c.srcEnd, c.name])).toEqual([
      [0, 30, "Giriş"],
      [30, 70, "Orta"],
      [70, 100, ""],
    ]);
  });

  it("hızlandırılmış ve taşınmış klipte bölme yeri kaynağa göre hesaplanır", () => {
    const result = splitAtChapters([clip("a", 0, 50, 20, 80, 2)], chapters, makeId);
    // Kaynakta 30. saniye: 50 + (30 - 20) / 2 = 55
    expect(result.map((c) => c.start)).toEqual([50, 55, 75]);
    expect(result[0].name).toBe("Giriş");
  });

  it("adı verilmiş klibin adı korunur", () => {
    const named = { ...clip("a", 0, 0, 0, 100), name: "Benim" };
    const result = splitAtChapters([named], chapters, makeId);
    expect(result.every((c) => c.name === "Benim")).toBe(true);
  });

  it("kaynak anı zaman çizelgesinde bulunur; silinmişse null", () => {
    const clips = [clip("a", 0, 0, 0, 30), clip("b", 0, 30, 70, 100, 2)];
    expect(timelineTimeOfSource(clips, 80)).toBe(35);
    expect(timelineTimeOfSource(clips, 50)).toBeNull();
    expect(chapterAt(chapters, 30)?.title).toBe("Orta");
    expect(chapterAt(chapters, 150)).toBeNull();
  });
});

describe("ses ve geçiş", () => {
  it("bölünen klipte açılma ilk, kararma son parçada kalır", () => {
    const base = { ...clip("a", 0, 0, 0, 10), fadeIn: 1, fadeOut: 2 };
    const [a, b] = splitClip([base], "a", 4, "b");
    expect([a.fadeIn, a.fadeOut, b.fadeIn, b.fadeOut]).toEqual([1, 0, 0, 2]);
  });

  it("geçiş yalnızca klibin gerçek başında ve sonunda uygulanır", () => {
    // Üst katman ana klibi ikiye böler: ortadaki kesimde geçiş olmaz.
    const clips = [{ ...clip("a", 0, 0, 0, 10), fadeIn: 1, fadeOut: 1 }, clip("o", 1, 4, 100, 102)];
    const segments = flatten(clips);
    expect(segments.map((s) => [s.clipId, s.fadeIn, s.fadeOut])).toEqual([
      ["a", 1, 0],
      ["o", 0, 0],
      ["a", 0, 1],
    ]);
  });

  it("ses kazancı düzey ve geçişle hesaplanır", () => {
    const [segment] = flatten([{ ...clip("a", 0, 0, 0, 10), volume: 0.5, fadeIn: 2 }]);
    expect(segmentEffects(segment, 1)).toEqual({ gain: 0.25, opacity: 0.5 });
    expect(segmentEffects(segment, 5)).toEqual({ gain: 0.5, opacity: 1 });
  });

  it("düzey sınırlanır, geçiş klip süresini aşamaz, efekt tanınır", () => {
    const [muted] = setVolume([clip("a", 0, 0, 0, 4)], ["a"], 5);
    expect(muted.volume).toBe(2);
    const [faded] = setFade([clip("a", 0, 0, 0, 4)], "a", "in", 9);
    expect(clipFades(faded)).toEqual([2, 0]);
    expect(hasEffects(faded)).toBe(true);
    expect(hasEffects(clip("b", 0, 0, 0, 4))).toBe(false);
  });
});

describe("geçişi bırakılan uca uygulama", () => {
  // S ile bölünmüş iki bitişik klip ve ayrı duran bir üçüncü.
  const cut = (): SeqClip[] => [
    { id: "a", track: 0, start: 0, srcStart: 0, srcEnd: 10, speed: 1, name: "" },
    { id: "b", track: 0, start: 10, srcStart: 10, srcEnd: 20, speed: 1, name: "" },
    { id: "c", track: 0, start: 30, srcStart: 40, srcEnd: 50, speed: 1, name: "" },
  ];
  const byId = (clips: SeqClip[], id: string) => clips.find((c) => c.id === id)!;

  it("kesime bırakılan kararma iki klibe birden uygulanır", () => {
    const out = applyTransitionAt(cut(), "b", "fadeBlack", "start", 0.8);
    expect(byId(out, "a").fadeOut).toBe(0.8);
    expect(byId(out, "b").fadeIn).toBe(0.8);
    expect(byId(out, "b").fadeOut).toBeUndefined();
    // Soldaki klibin sonuna bırakmak da aynı kesimdir.
    const same = applyTransitionAt(cut(), "a", "fadeWhite", "end", 0.5);
    expect(byId(same, "a").fadeOut).toBe(0.5);
    expect(byId(same, "b").fadeIn).toBe(0.5);
    expect(byId(same, "b").fadeWhite).toBe(true);
  });

  it("komşusu olmayan uçta yalnızca o klip değişir", () => {
    const out = applyTransitionAt(cut(), "c", "fadeBlack", "start", 1);
    expect(byId(out, "c").fadeIn).toBe(1);
    expect(byId(out, "b").fadeOut).toBeUndefined();
  });

  it("ortaya bırakılınca iki uç birden", () => {
    const out = applyTransitionAt(cut(), "c", "fadeBlack", "both", 1);
    expect([byId(out, "c").fadeIn, byId(out, "c").fadeOut]).toEqual([1, 1]);
  });

  it("yumuşak başlangıç kesimden sonra başlayan klibe eklenir", () => {
    const out = applyTransitionAt(cut(), "a", "fadeIn", "end", 0.8);
    expect(byId(out, "b").fadeIn).toBe(0.8);
    expect(byId(out, "a").fadeIn).toBeUndefined();
  });

  it("başka izdeki klip komşu sayılmaz", () => {
    const clips = cut().map((c) => (c.id === "a" ? { ...c, track: 1 } : c));
    const out = applyTransitionAt(clips, "b", "fadeBlack", "start", 0.8);
    expect(byId(out, "a").fadeOut).toBeUndefined();
  });
});

describe("çoklu kaynak", () => {
  const twoSources = (): SeqClip[] => [
    ...initialClips(100, "a", "s1"),
    ...initialClips(100, "b", "s2").map((c) => ({ ...c, start: 100 })),
  ];

  it("kaynak kimliği düzleştirmede parçaya taşınır", () => {
    const segments = flatten(twoSources());
    expect(segments.map((s) => s.sourceId)).toEqual(["s1", "s2"]);
  });

  it("bölme ve çoğaltmada kaynak kimliği korunur", () => {
    const [a, b] = splitClip(initialClips(100, "a", "s2"), "a", 40, "b");
    expect(a.sourceId).toBe("s2");
    expect(b.sourceId).toBe("s2");
    expect(duplicateClip(initialClips(60, "x", "s2"), "x", "y")[1].sourceId).toBe("s2");
  });

  it("bölümden bölme yalnızca istenen kaynağın kliplerine uygulanır", () => {
    const chapters = [
      { start: 0, end: 50, title: "X" },
      { start: 50, end: 100, title: "Y" },
    ];
    const out = splitAtChapters(twoSources(), chapters, makeId, "s2");
    expect(out.filter((c) => c.sourceId === "s1")).toHaveLength(1);
    expect(out.filter((c) => c.sourceId === "s2").map((c) => c.name)).toEqual(["X", "Y"]);
    // Süzgeç verilmezse iki kaynak da bölünür.
    expect(splitAtChapters(twoSources(), chapters, makeId)).toHaveLength(4);
  });

  it("kaynak anı yalnızca o kaynağın kliplerinde aranır", () => {
    expect(timelineTimeOfSource(twoSources(), 30, "s1")).toBe(30);
    expect(timelineTimeOfSource(twoSources(), 30, "s2")).toBe(130);
    // Kimlik verilmezse eski davranış: ilk tutan klip.
    expect(timelineTimeOfSource(twoSources(), 30)).toBe(30);
  });
});
