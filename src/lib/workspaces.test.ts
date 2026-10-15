import { describe, expect, it } from "vitest";
import { parseStored } from "./workspaces";

const layout = { grid: { root: {}, height: 1, width: 1, orientation: "HORIZONTAL" }, panels: {} };

describe("çalışma alanı kaydı", () => {
  it("bozuk ya da boş kayıtta Sinema düzenine döner", () => {
    expect(parseStored(null)).toEqual({ active: "cinema", custom: [], modified: {} });
    expect(parseStored("x")).toEqual({ active: "cinema", custom: [], modified: {} });
    expect(parseStored({ active: "yok", custom: "x", modified: 5 }).active).toBe("cinema");
  });

  it("geçerli kullanıcı düzenleri ve değişiklikler korunur, bozukları atılır", () => {
    const s = parseStored({
      active: "user:1",
      custom: [
        { id: "user:1", name: "Altyazı işi", layout },
        { id: "user:2", name: "  ", layout },
        { id: "baska", name: "X", layout },
        { id: "user:3", name: "Eksik" },
      ],
      modified: { cinema: layout, focus: { bozuk: true } },
      version: 2,
    });
    expect(s.custom.map((c) => c.name)).toEqual(["Altyazı işi"]);
    expect(s.active).toBe("user:1");
    expect(Object.keys(s.modified)).toEqual(["cinema"]);
  });

  it("eski sürümde kaydedilmiş hazır düzen değişiklikleri atılır, kullanıcı düzenleri kalır", () => {
    const s = parseStored({
      active: "cinema",
      custom: [{ id: "user:1", name: "Benim", layout }],
      modified: { cinema: layout },
    });
    expect(s.modified).toEqual({});
    expect(s.custom).toHaveLength(1);
  });

  it("silinmiş kullanıcı düzeni etkin kalmaz", () => {
    expect(parseStored({ active: "user:9", custom: [] }).active).toBe("cinema");
    expect(parseStored({ active: "studio" }).active).toBe("studio");
  });
});
