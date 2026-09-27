import { describe, expect, it } from "vitest";
import { parseSrt } from "./subtitles";

describe("altyazı", () => {
  it("SRT blokları zaman damgalı satırlara çevrilir, etiketler temizlenir", () => {
    const srt = [
      "﻿1",
      "00:00:01,500 --> 00:00:03,000",
      "<i>Merhaba</i> dünya",
      "",
      "2",
      "00:01:02,25 --> 00:01:04,000",
      "{\\an8}İki",
      "satır",
      "",
      "3",
      "bozuk --> blok",
      "yok",
    ].join("\r\n");
    expect(parseSrt(srt)).toEqual([
      { start: 1.5, end: 3, text: "Merhaba dünya" },
      { start: 62.25, end: 64, text: "İki\nsatır" },
    ]);
  });
});
