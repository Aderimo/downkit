import { describe, expect, it } from "vitest";
import { formatPercent } from "./format";

describe("yüzde", () => {
  it("Türkçede işaret önde, İngilizcede sonda", () => {
    expect(formatPercent(1, "tr")).toBe("%100");
    expect(formatPercent(0.555, "tr-TR")).toBe("%56");
    expect(formatPercent(1.5, "en")).toBe("150%");
  });
});
