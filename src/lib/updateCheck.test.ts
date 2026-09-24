import { describe, expect, test } from "vitest";
import { isNewerVersion } from "./updateCheck";

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
