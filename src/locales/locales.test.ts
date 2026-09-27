import { describe, expect, it } from "vitest";
import en from "./en.json";
import tr from "./tr.json";

// Bakımı yapılan iki dil birebir aynı anahtarlara sahip olmalı; topluluk çevirileri
// eksik kalırsa İngilizceye düşer (bkz. CONTRIBUTING.md).
function keys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object") return [prefix];
  return Object.entries(value).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

// Çoğul ekleri (_one/_other) dile göre farklı olabilir; kök anahtar karşılaştırılır.
const normalize = (list: string[]) =>
  [...new Set(list.map((k) => k.replace(/_(zero|one|two|few|many|other)$/, "")))].sort();

describe("çeviriler", () => {
  it("Türkçe ve İngilizce aynı anahtarlara sahip", () => {
    const trKeys = normalize(keys(tr));
    const enKeys = normalize(keys(en));
    expect(trKeys.filter((k) => !enKeys.includes(k))).toEqual([]);
    expect(enKeys.filter((k) => !trKeys.includes(k))).toEqual([]);
  });

  it("yer tutucular iki dilde de aynı", () => {
    const placeholders = (text: unknown) =>
      typeof text === "string" ? [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort() : [];
    const get = (obj: unknown, path: string) =>
      path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
    const mismatched = keys(en).filter(
      (k) =>
        get(tr, k) !== undefined &&
        placeholders(get(en, k)).join() !== placeholders(get(tr, k)).join(),
    );
    expect(mismatched).toEqual([]);
  });
});
