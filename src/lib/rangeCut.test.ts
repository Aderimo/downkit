import { describe, expect, it } from "vitest";
import { cutTimeline, keptPieces, mapTime, mergeRanges, moveRange } from "./rangeCut";
import { timelineSilences, DEFAULT_SILENCE } from "./silence";
import type { SeqClip } from "./sequence";
import type { MusicItem } from "./layers";
import { newText } from "./textItems";

const clip = (
  id: string,
  start: number,
  srcStart: number,
  srcEnd: number,
  extra: Partial<SeqClip> = {},
): SeqClip => ({
  id,
  track: 0,
  start,
  srcStart,
  srcEnd,
  speed: 1,
  name: "",
  ...extra,
});

let n = 0;
const newId = () => `n${++n}`;
const empty = { texts: [], images: [], blurs: [], music: [] };

describe("aralık kesme", () => {
  it("aralıklar birleşir, zaman haritası kesilenleri atlar", () => {
    const r = mergeRanges([
      { start: 5, end: 6 },
      { start: 1, end: 2 },
      { start: 1.5, end: 3 },
      { start: 9, end: 9 },
    ]);
    expect(r).toEqual([
      { start: 1, end: 3 },
      { start: 5, end: 6 },
    ]);
    expect(mapTime(r, 0.5)).toBe(0.5);
    expect(mapTime(r, 2)).toBe(1);
    expect(mapTime(r, 4)).toBe(2);
    expect(mapTime(r, 10)).toBe(7);
    expect(keptPieces(r, 0, 8)).toEqual([
      { start: 0, end: 1 },
      { start: 3, end: 5 },
      { start: 6, end: 8 },
    ]);
  });

  it("klip ortadan kesilince iki parça olur, sonraki klip sola kayar; geçişler uçlarda kalır", () => {
    n = 0;
    const clips = [
      clip("a", 0, 10, 20, {
        fadeIn: 0.5,
        fadeOut: 0.5,
        xfade: { kind: "fade", duration: 0.5 } as never,
      }),
      clip("b", 10, 0, 5),
    ];
    const out = cutTimeline({ clips, ...empty }, [{ start: 4, end: 6 }], newId);
    expect(out.removed).toBe(2);
    expect(out.clips.map((c) => [c.id, c.start, c.srcStart, c.srcEnd])).toEqual([
      ["a", 0, 10, 14],
      ["n1", 4, 16, 20],
      ["b", 8, 0, 5],
    ]);
    expect(out.clips[0].fadeIn).toBe(0.5);
    expect(out.clips[0].fadeOut).toBeUndefined();
    expect(out.clips[0].xfade).toBeUndefined();
    expect(out.clips[1].fadeIn).toBeUndefined();
    expect(out.clips[1].xfade).toBeDefined();
  });

  it("hızlı klipte kaynak aralığı hızla çarpılır", () => {
    n = 0;
    const out = cutTimeline(
      { clips: [clip("a", 0, 0, 20, { speed: 2 })], ...empty },
      [{ start: 2, end: 3 }],
      newId,
    );
    expect(out.clips.map((c) => [c.start, c.srcStart, c.srcEnd])).toEqual([
      [0, 0, 4],
      [2, 6, 20],
    ]);
  });

  it("altyazı kelimeleri kesilen yerde düşer, sonrası kayar; tamamen kesilen yazı silinir", () => {
    n = 0;
    const words = [
      { text: "bir", start: 1, end: 1.4 },
      { text: "ııı", start: 1.5, end: 2.5 },
      { text: "iki", start: 2.6, end: 3 },
    ];
    const line = { ...newText("t", 1, "bir ııı iki"), end: 3, words, auto: true };
    const gone = { ...newText("g", 1.6, "x"), end: 2.4 };
    const after = { ...newText("z", 5, "son"), end: 6 };
    const out = cutTimeline(
      { clips: [clip("a", 0, 0, 10)], ...empty, texts: [line, gone, after] },
      [{ start: 1.45, end: 2.55 }],
      newId,
    );
    expect(out.texts.map((t) => t.id)).toEqual(["t", "z"]);
    expect(out.texts[0].text).toBe("bir iki");
    expect(out.texts[0].end).toBeCloseTo(1.9);
    expect(out.texts[0].words![1].start).toBeCloseTo(1.5);
    expect(out.texts[1].start).toBeCloseTo(3.9);
  });

  it("videodan ayrılmış ses klibiyle aynı yerden bölünür ve yeni parçaya bağlanır; müzik yalnızca kayar", () => {
    n = 0;
    const linked: MusicItem = {
      id: "m1",
      path: "a.mp4",
      name: "a",
      start: 0,
      srcStart: 0,
      length: 10,
      sourceDuration: 10,
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      lane: 0,
      linkedClipId: "a",
    };
    const song: MusicItem = {
      ...linked,
      id: "m2",
      path: "song.mp3",
      start: 5,
      length: 30,
      linkedClipId: undefined,
    };
    delete song.linkedClipId;
    const out = cutTimeline(
      { clips: [clip("a", 0, 0, 10, { volume: 0 })], ...empty, music: [linked, song] },
      [{ start: 2, end: 4 }],
      newId,
    );
    expect(out.clips.map((c) => c.id)).toEqual(["a", "n1"]);
    const audio = out.music.filter((m) => m.linkedClipId);
    expect(audio.map((m) => [m.start, m.srcStart, m.length, m.linkedClipId])).toEqual([
      [0, 0, 2, "a"],
      [2, 4, 6, "n1"],
    ]);
    expect(out.music.find((m) => m.id === "m2")!.start).toBe(3);
    expect(out.music.find((m) => m.id === "m2")!.length).toBe(30);
  });
});

describe("zaman çizelgesindeki sessizlikler", () => {
  const base = { music: [], tracks: {}, sourceOfPath: {}, firstSourceId: "s1" };

  it("kaynak sessizlikleri klip kırpması ve hızıyla eşlenir, kenarlarda pay kalır", () => {
    const clips = [
      clip("a", 0, 10, 30, { sourceId: "s1" }),
      clip("b", 20, 0, 10, { sourceId: "s2", speed: 2 }),
    ];
    const silences = {
      s1: [
        { start: 8, end: 12 },
        { start: 15, end: 17 },
        { start: 20, end: 20.3 },
      ],
      s2: [{ start: 4, end: 8 }],
    };
    const r = timelineSilences({ ...base, clips, silences }, DEFAULT_SILENCE);
    // a: 8–12 → 0–2 (başta pay yok), 15–17 → 5–7; 0.3 sn sayılmaz. b: 4–8 → 22–24.
    expect(r.map((x) => [+x.start.toFixed(2), +x.end.toFixed(2)])).toEqual([
      [0, 1.88],
      [5.12, 6.88],
      [22.12, 23.88],
    ]);
  });

  it("üst izde konuşma sürerken alttaki sessizlik kesilmez; sessiz iz ses saymaz", () => {
    const clips = [
      clip("a", 0, 0, 10, { sourceId: "s1" }),
      clip("cam", 0, 0, 10, { sourceId: "s2", track: 1 }),
    ];
    const silences = { s1: [{ start: 2, end: 5 }], s2: [{ start: 3, end: 8 }] };
    const both = timelineSilences({ ...base, clips, silences }, { ...DEFAULT_SILENCE, pad: 0 });
    expect(both).toEqual([{ start: 3, end: 5 }]);
    const muted = timelineSilences(
      { ...base, clips, silences, tracks: { 1: { muted: true } } },
      { ...DEFAULT_SILENCE, pad: 0 },
    );
    expect(muted).toEqual([{ start: 2, end: 5 }]);
  });

  it("sesi ayrılmış klipte ses bloğunun sessizliği kullanılır, müzik hesaba katılmaz", () => {
    const clips = [clip("a", 0, 0, 10, { sourceId: "s1", volume: 0 })];
    const music: MusicItem[] = [
      {
        id: "m1",
        path: "C:/a.mp4",
        name: "a",
        start: 0,
        srcStart: 0,
        length: 10,
        sourceDuration: 10,
        volume: 1,
        fadeIn: 0,
        fadeOut: 0,
        lane: 0,
        linkedClipId: "a",
      },
      {
        id: "m2",
        path: "C:/song.mp3",
        name: "s",
        start: 0,
        srcStart: 0,
        length: 10,
        sourceDuration: 10,
        volume: 1,
        fadeIn: 0,
        fadeOut: 0,
      },
    ];
    const r = timelineSilences(
      {
        ...base,
        clips,
        music,
        silences: { s1: [{ start: 4, end: 6 }] },
        sourceOfPath: { "C:/a.mp4": "s1" },
      },
      { ...DEFAULT_SILENCE, pad: 0 },
    );
    expect(r).toEqual([{ start: 4, end: 6 }]);
  });
});

describe("aralık taşıma (metinden kurgu)", () => {
  const words = (text: string, start: number) =>
    text
      .split(" ")
      .map((w, i) => ({ text: w, start: start + i * 0.5, end: start + i * 0.5 + 0.4 }));
  const line = (id: string, text: string, start: number) => ({
    ...newText(id, start, text),
    end: start + 1,
    words: words(text, start),
    auto: true,
  });

  it("cümle başka cümlenin önüne taşınır: klipler bölünür, yazılar birlikte gider, süre aynı kalır", () => {
    n = 0;
    const input = {
      clips: [clip("a", 0, 0, 10)],
      texts: [line("l1", "bir iki", 1), line("l2", "üç dört", 5)],
      images: [
        {
          id: "logo",
          path: "l.png",
          name: "l",
          start: 0,
          end: 10,
          x: 0.5,
          y: 0.5,
          size: 0.2,
          opacity: 1,
        },
      ],
      blurs: [],
      music: [],
    };
    const out = moveRange(input, { start: 5, end: 6 }, 1, newId);
    const sorted = [...out.clips].sort((x, y) => x.start - y.start);
    expect(sorted.map((c) => [c.start, c.srcStart, c.srcEnd])).toEqual([
      [0, 0, 1],
      [1, 5, 6],
      [2, 1, 5],
      [6, 6, 10],
    ]);
    const l2 = out.texts.find((t) => t.id === "l2")!;
    const l1 = out.texts.find((t) => t.id === "l1")!;
    expect([l2.start, l2.end, l2.words![0].start]).toEqual([1, 2, 1]);
    expect([l1.start, l1.end, l1.words![1].start]).toEqual([2, 3, 2.5]);
    // Videonun tamamını kaplayan logo yine baştan sona.
    expect([out.images[0].start, out.images[0].end]).toEqual([0, 10]);
  });

  it("geri taşıma da çalışır; hedef aralığın içindeyse değişmez", () => {
    n = 0;
    const input = { clips: [clip("a", 0, 0, 10)], texts: [], images: [], blurs: [], music: [] };
    const out = moveRange(input, { start: 1, end: 2 }, 6, newId);
    const sorted = [...out.clips].sort((x, y) => x.start - y.start);
    expect(sorted.map((c) => [c.start, c.srcStart, c.srcEnd])).toEqual([
      [0, 0, 1],
      [1, 2, 6],
      [5, 1, 2],
      [6, 6, 10],
    ]);
    expect(moveRange(input, { start: 1, end: 2 }, 1.5, newId).clips).toEqual(input.clips);
  });

  it("videodan ayrılmış ses klibiyle birlikte taşınır ve yeni parçaya bağlanır", () => {
    n = 0;
    const linked: MusicItem = {
      id: "m1",
      path: "a.mp4",
      name: "a",
      start: 0,
      srcStart: 0,
      length: 10,
      sourceDuration: 10,
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      lane: 0,
      linkedClipId: "a",
    };
    const out = moveRange(
      {
        clips: [clip("a", 0, 0, 10, { volume: 0 })],
        texts: [],
        images: [],
        blurs: [],
        music: [linked],
      },
      { start: 5, end: 6 },
      1,
      newId,
    );
    for (const m of out.music) {
      const c = out.clips.find((x) => x.id === m.linkedClipId)!;
      expect([m.start, m.srcStart, m.length]).toEqual([c.start, c.srcStart, c.srcEnd - c.srcStart]);
    }
    expect(out.music).toHaveLength(4);
  });
});
