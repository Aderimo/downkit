import { describe, expect, test } from "vitest";
import { clampRange, formatClock, parseClock, rangeLabel } from "./timeRange";

describe("parseClock", () => {
  test("dakika:saniye, saat:dakika:saniye ve düz saniye okunur", () => {
    expect(parseClock("1:05")).toBe(65);
    expect(parseClock("01:02:03")).toBe(3723);
    expect(parseClock("90")).toBe(90);
    expect(parseClock(" 0:30 ")).toBe(30);
    expect(parseClock("1:05.5")).toBe(65.5);
  });

  test("geçersiz yazımlar reddedilir", () => {
    expect(parseClock("")).toBeNull();
    expect(parseClock("1:75")).toBeNull();
    expect(parseClock("abc")).toBeNull();
    expect(parseClock("1:2:3:4")).toBeNull();
    expect(parseClock("-5")).toBeNull();
  });
});

describe("formatClock", () => {
  test("bir saatin altı ve üstü doğru gösterilir", () => {
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(3723)).toBe("1:02:03");
    expect(formatClock(0)).toBe("0:00");
  });

  test("biçimlendirilen değer yeniden okunabilir", () => {
    for (const seconds of [0, 59, 60, 3599, 3600, 7322]) {
      expect(parseClock(formatClock(seconds))).toBe(seconds);
    }
  });
});

describe("rangeLabel", () => {
  test("dosya adına uygun etiket Rust tarafıyla aynıdır", () => {
    expect(rangeLabel({ start: 65, end: 150 })).toBe("01.05-02.30");
    expect(rangeLabel({ start: 3723, end: 3900 })).toBe("1.02.03-1.05.00");
    expect(rangeLabel({ start: 0, end: 59.6 })).not.toContain(":");
  });
});

describe("clampRange", () => {
  test("aralık videonun süresi içinde tutulur", () => {
    expect(clampRange({ start: -10, end: 900 }, 600, "end")).toEqual({ start: 0, end: 600 });
  });

  test("başlangıç bitişi geçemez, en az bir saniye kalır", () => {
    expect(clampRange({ start: 120, end: 100 }, 600, "start")).toEqual({ start: 99, end: 100 });
    expect(clampRange({ start: 120, end: 100 }, 600, "end")).toEqual({ start: 120, end: 121 });
  });
});
