import { describe, expect, it } from "vitest";
import {
  findHighlights,
  markerFile,
  markerTimes,
  markRecording,
  markReplay,
  parseMarkers,
  replayMarkersFor,
  replayOffsets,
  resetRecordingMarkers,
  takeRecordingMarkers,
} from "./markers";

describe("an işaretleri", () => {
  it("dosya yazılır ve okunur; bozuk değerler atılır", () => {
    expect(parseMarkers(markerFile([12.345, 3, -1, Number.NaN]))).toEqual([3, 12.35]);
    expect(parseMarkers("bozuk")).toEqual([]);
    expect(parseMarkers('{"markers":[5,5,2]}')).toEqual([2, 5]);
  });

  it("kayıtta saniyesiyle tutulur, art arda basış tek sayılır", () => {
    resetRecordingMarkers();
    expect(markRecording(10, 1_000)).toBe(true);
    expect(markRecording(10.2, 1_200)).toBe(false);
    expect(markRecording(20, 5_000)).toBe(true);
    expect(takeRecordingMarkers()).toEqual([10, 20]);
    expect(takeRecordingMarkers()).toEqual([]);
  });

  it("anlık tekrarda kaydedilen pencereye göre hesaplanır", () => {
    // 60 sn'lik tekrar 100. saniyede kaydedildi: 40–100 arası; 70. sn'deki işaret videonun 30. sn'si.
    expect(replayOffsets([30_000, 70_000, 99_000], 100_000, 60)).toEqual([30, 59]);
    markReplay(70_000, 600);
    expect(replayMarkersFor(100_000, 60)).toEqual([30]);
  });

  it("zaman çizelgesinde işareti içeren kliplere düşer (hız dahil)", () => {
    const clips = [
      { start: 0, srcStart: 84, srcEnd: 196, speed: 1 },
      { start: 170, srcStart: 488, srcEnd: 560, speed: 1.5 },
      { sourceId: "s2", start: 300, srcStart: 0, srcEnd: 50, speed: 1 },
    ];
    expect(markerTimes(clips, "s1", "s1", [130, 520, 600])).toEqual([46, 191.33]);
    expect(markerTimes(clips, "s2", "s1", [10])).toEqual([310]);
  });
});

describe("heyecanlı anlar", () => {
  it("sesin birden yükseldiği yerler bulunur, birbirine yakın olanlar tekilleşir", () => {
    // 100 sn, saniyede 8 kova: çoğu sessiz (0.1), 30. ve 31. sn ile 70. sn yüksek.
    const peaks = Array.from({ length: 800 }, (_, i) => {
      const t = i / 8;
      return (t > 29.5 && t < 31.5) || (t > 69.5 && t < 70.5) ? 0.9 : 0.1;
    });
    const found = findHighlights(peaks, 100);
    expect(found).toHaveLength(2);
    expect(found[0]).toBeGreaterThan(29);
    expect(found[0]).toBeLessThan(32);
    expect(found[1]).toBeGreaterThan(69);
    expect(findHighlights(new Array(800).fill(0.1), 100)).toEqual([]);
  });
});
