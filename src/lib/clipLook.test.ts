import { describe, expect, it } from "vitest";
import { DEFAULT_LOOK, isDefaultLook, lookCss, normalizeLook } from "./clipLook";

describe("klip görünümü", () => {
  it("varsayılan görünüm efekt sayılmaz", () => {
    expect(isDefaultLook(DEFAULT_LOOK)).toBe(true);
    expect(isDefaultLook(undefined)).toBe(true);
    expect(isDefaultLook({ filter: "bw" })).toBe(false);
    expect(isDefaultLook({ mirror: true })).toBe(false);
  });

  it("bozuk değerler sınıra çekilir", () => {
    const look = normalizeLook({ brightness: 5, blur: -2, filter: "yok" as never });
    expect(look.brightness).toBe(1);
    expect(look.blur).toBe(0);
    expect(look.filter).toBe("none");
  });

  it("önizlemede CSS filtresine çevrilir", () => {
    const css = lookCss({ filter: "bw", brightness: 0.4, blur: 0.5, mirror: true, vignette: true });
    expect(css.filter).toBe("grayscale(1) brightness(1.2) blur(4.0px)");
    expect(css.transform).toBe("scaleX(-1)");
    expect(css.vignette).toBe(true);
    expect(lookCss(undefined)).toEqual({ filter: "", transform: "", vignette: false });
  });
});
