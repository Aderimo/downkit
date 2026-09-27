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
