import { describe, expect, it } from "vitest";
import { parseSrt, toSrt, toVtt } from "./subtitles";

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

describe("altyazı dışa aktarma", () => {
  const cues = [
    { start: 3.5, end: 5, text: "ikinci satır" },
    { start: 0, end: 1.25, text: "birinci" },
    { start: 6, end: 7, text: "  " },
  ];
  it("SRT: sıralı, numaralı, virgüllü zaman", () => {
    expect(toSrt(cues)).toBe(
      "1\n00:00:00,000 --> 00:00:01,250\nbirinci\n\n2\n00:00:03,500 --> 00:00:05,000\nikinci satır\n",
    );
  });
  it("VTT: başlık ve noktalı zaman; SRT'ye geri okunur", () => {
    const vtt = toVtt(cues);
    expect(vtt.startsWith("WEBVTT\n\n00:00:00.000 --> 00:00:01.250\nbirinci")).toBe(true);
    expect(parseSrt(toSrt(cues)).map((c) => c.text)).toEqual(["birinci", "ikinci satır"]);
  });
});
