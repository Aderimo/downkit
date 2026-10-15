import { describe, expect, test } from "vitest";
import { isNewerVersion, parseLatest } from "./updateCheck";

describe("isNewerVersion", () => {
  test("daha yüksek sürüm yeni sayılır, v öneki fark etmez", () => {
    expect(isNewerVersion("v0.2.0", "0.1.0")).toBe(true);
    expect(isNewerVersion("0.1.10", "0.1.9")).toBe(true);
    expect(isNewerVersion("1.0.0", "0.9.9")).toBe(true);
  });

  test("aynı ya da eski sürüm yeni sayılmaz", () => {
    expect(isNewerVersion("v0.1.0", "0.1.0")).toBe(false);
    expect(isNewerVersion("0.1.0", "0.2.0")).toBe(false);
    expect(isNewerVersion("0.9.9", "1.0.0")).toBe(false);
  });

  test("ön sürüm eki ana sürümü değiştirmez", () => {
    expect(isNewerVersion("0.2.0-beta.1", "0.1.0")).toBe(true);
  });
});

describe("GitHub son sürüm", () => {
  test("sürüm okunur, sayfa yalnızca kendi depomuzdan kabul edilir", () => {
    const base = "https://github.com/Aderimo/downkit/releases";
    expect(parseLatest({ tag_name: "v1.2.0", html_url: `${base}/tag/v1.2.0` })).toEqual({
      version: "1.2.0",
      url: `${base}/tag/v1.2.0`,
    });
    expect(parseLatest({ tag_name: "1.2.0", html_url: "https://kotu.example/indir" })?.url).toBe(
      `${base}/latest`,
    );
    expect(parseLatest({ tag_name: "yeni" })).toBeNull();
    expect(parseLatest({ tag_name: "v2.0.0", draft: true })).toBeNull();
    expect(parseLatest({ tag_name: "v2.0.0", prerelease: true })).toBeNull();
    expect(parseLatest(null)).toBeNull();
  });
});
