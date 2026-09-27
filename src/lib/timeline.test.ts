import { describe, expect, it } from "vitest";
import {
  clampView,
  followPlayhead,
  formatTick,
  formatTimecode,
  panView,
  peakInRange,
  storyboardFrame,
  thumbTimes,
  tickStep,
  timeToX,
  xToTime,
  zoomView,
} from "./timeline";
import type { Storyboard } from "../types/media";

describe("görünür aralık", () => {
  it("yakınlaştırmada imlecin altındaki an yerinde kalır", () => {
    const view = zoomView({ start: 0, end: 100 }, 0.5, 20, 100);
    expect(view).toEqual({ start: 10, end: 60 });
    expect(timeToX(20, view, 1000)).toBeCloseTo(timeToX(20, { start: 0, end: 100 }, 1000));
  });

  it("en fazla iki saniyeye kadar yakınlaşılır, süreden fazla uzaklaşılmaz", () => {
    expect(zoomView({ start: 10, end: 12 }, 0.1, 11, 100)).toEqual({ start: 10, end: 12 });
    expect(zoomView({ start: 10, end: 60 }, 10, 30, 100)).toEqual({ start: 0, end: 100 });
  });

  it("kaydırma kenarlarda durur", () => {
    expect(panView({ start: 80, end: 100 }, 30, 100)).toEqual({ start: 80, end: 100 });
    expect(panView({ start: 5, end: 25 }, -30, 100)).toEqual({ start: 0, end: 20 });
    expect(clampView({ start: -5, end: 5 }, 3)).toEqual({ start: 0, end: 3 });
  });

  it("imleç görünür aralıktan çıkınca sayfa çevrilir", () => {
    const view = { start: 0, end: 10 };
    expect(followPlayhead(view, 5, 100)).toBe(view);
    expect(followPlayhead(view, 11, 100)).toEqual({ start: 10, end: 20 });
  });

  it("piksel ve saniye birbirine çevrilir", () => {
    const view = { start: 60, end: 120 };
    expect(timeToX(90, view, 600)).toBe(300);
    expect(xToTime(300, view, 600)).toBe(90);
  });
});

describe("cetvel ve zaman kodu", () => {
  it("etiket aralığı piksel yoğunluğuna göre seçilir", () => {
    // 1 sn = 10 px → 90 px için en az 10 sn.
    expect(tickStep(0.1)).toBe(10);
    expect(tickStep(0.001)).toBe(0.1);
    expect(tickStep(1000)).toBe(7200);
  });

  it("zaman kodu salise ile yazılır ve yuvarlama taşmaz", () => {
    expect(formatTimecode(83.456)).toBe("1:23.46");
    expect(formatTimecode(59.999)).toBe("1:00.00");
    expect(formatTimecode(3723.1)).toBe("1:02:03.10");
    expect(formatTimecode(5, 0)).toBe("0:05");
    expect(formatTick(1.5, 0.5)).toBe("0:01.5");
    expect(formatTick(90, 30)).toBe("1:30");
  });
});

describe("kare şeridi", () => {
  const board: Storyboard = {
    width: 160,
    height: 90,
    rows: 5,
    columns: 5,
    interval: 5,
    sheets: [
      { url: "M0", start: 0, duration: 125 },
      { url: "M1", start: 125, duration: 125 },
      { url: "M2", start: 250, duration: 12 },
    ],
  };

  it("an doğru sayfa, satır ve sütuna düşer", () => {
    expect(storyboardFrame(board, 0)).toEqual({ url: "M0", column: 0, row: 0 });
    expect(storyboardFrame(board, 36)).toEqual({ url: "M0", column: 2, row: 1 });
    expect(storyboardFrame(board, 130)).toEqual({ url: "M1", column: 1, row: 0 });
  });

  it("yarım son sayfada olmayan kareye atlanmaz", () => {
    // 12 sn / 5 sn ≈ 2 kare → en fazla 2. kare (indeks 1).
    expect(storyboardFrame(board, 999)).toEqual({ url: "M2", column: 1, row: 0 });
  });

  it("eşit aralıklı anlar her dilimin ortasıdır", () => {
    expect(thumbTimes(100, 4)).toEqual([12.5, 37.5, 62.5, 87.5]);
  });
});

describe("dalga formu", () => {
  it("aralıktaki en yüksek tepe bulunur", () => {
    const peaks = [0.1, 0.9, 0.2, 0.4];
    expect(peakInRange(peaks, 4, 0, 1)).toBe(0.1);
    expect(peakInRange(peaks, 4, 0.5, 2.5)).toBe(0.9);
    expect(peakInRange(peaks, 4, 3.2, 3.3)).toBe(0.4);
    expect(peakInRange([], 4, 0, 1)).toBe(0);
  });
});
