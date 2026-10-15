import { describe, expect, it } from "vitest";
import { brandText, parseKits, type BrandKit } from "./brandKit";
import { newText } from "./textItems";

const kit: BrandKit = {
  id: "k",
  name: "Kanalım",
  font: "impact",
  primary: "#e11d48",
  accent: "#4ade80",
  progress: true,
};

describe("marka kiti", () => {
  it("yazı kitin yazı tipine, şeridi ana renge, vurgusu vurgu rengine geçer", () => {
    const band = { ...newText("a", 0, "Başlık"), bg: "#111111", font: "segoe" as const };
    expect(brandText(band, kit)).toMatchObject({ font: "impact", bg: "#e11d48" });
    const plain = brandText(newText("b", 0, "x"), kit);
    expect(plain.bg).toBeUndefined();
    const lit = brandText(
      { ...newText("c", 0, "x"), highlight: { mode: "color", color: "#ffffff" } },
      kit,
    );
    expect(lit.highlight).toEqual({ mode: "color", color: "#4ade80" });
  });

  it("kayıttan kitler doğrulanır, bozuk alanlar varsayılana döner", () => {
    const kits = parseKits([
      { ...kit, logo: { path: "C:/l.png", x: 5 } },
      { id: "x", name: " " },
      {
        id: "y",
        name: "Eski",
        font: "Comic",
        primary: "kırmızı",
        captionPreset: "yok",
        intro: "Merhaba",
      },
      "bozuk",
    ]);
    expect(kits.map((k) => k.name)).toEqual(["Kanalım", "Eski"]);
    expect(kits[0].logo).toMatchObject({ path: "C:/l.png", x: 1, y: 0.08, name: "logo" });
    expect(kits[1]).toMatchObject({ font: "segoeBlack", primary: "#4f7bff", intro: "Merhaba" });
    expect(kits[1].captionPreset).toBeUndefined();
    expect(parseKits("x")).toEqual([]);
  });
});
