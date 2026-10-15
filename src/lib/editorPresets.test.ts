import { describe, expect, it } from "vitest";
import { parsePresets, toPresetFile } from "./editorPresets";

describe("hazır ayarlar", () => {
  it("dosyadan okunur, bozuk kayıtlar atlanır, değerler sınıra çekilir", () => {
    const file = {
      app: "DownKit",
      type: "editor-presets",
      version: 1,
      presets: [
        { id: "a", name: "Sinema", kind: "look", look: { filter: "cinema", contrast: 9 } },
        { id: "b", name: "Başlık", kind: "text", style: { size: 3, color: "#FFD43B", box: false } },
        { name: "", kind: "look", look: {} },
        { name: "Bilinmeyen", kind: "ses" },
      ],
    };
    const presets = parsePresets(file);
    expect(presets.map((p) => p.name)).toEqual(["Sinema", "Başlık"]);
    expect(presets[0].kind === "look" && presets[0].look.contrast).toBe(1);
    expect(presets[1].kind === "text" && presets[1].style.size).toBe(0.25);
  });

  it("dışa aktarılan dosya yeniden içe aktarılabilir", () => {
    const presets = parsePresets([
      { id: "x", name: "Soğuk", kind: "look", look: { filter: "cool" } },
    ]);
    expect(parsePresets(JSON.parse(JSON.stringify(toPresetFile(presets))))).toEqual(presets);
  });
});

describe("kanal şablonu", () => {
  it("dosyadan okunur; bozuk alanlar varsayılana döner", () => {
    const [p] = parsePresets([
      {
        id: "k",
        name: "Kanalım",
        kind: "channel",
        channel: {
          frame: { aspect: "9:16", fit: true, blur: true, position: 9 },
          text: { color: "#ffd43b", size: 0.09 },
          logo: { path: "C:/logo.png", x: 0.9, y: 0.1, size: 0.2, opacity: 0.8 },
        },
      },
      { id: "x", name: "Bozuk", kind: "channel", channel: null },
    ]);
    expect(p.kind).toBe("channel");
    if (p.kind !== "channel") return;
    expect(p.channel.frame).toEqual({ aspect: "9:16", fit: true, blur: true, position: 1 });
    expect(p.channel.text?.color).toBe("#ffd43b");
    expect(p.channel.logo?.opacity).toBe(0.8);
    expect(p.channel.look).toBeUndefined();
  });
});
