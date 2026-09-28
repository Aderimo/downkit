import { describe, expect, it } from "vitest";
import { RELEASE_NOTES, notesFor } from "./releaseNotes";

describe("RELEASE_NOTES", () => {
  it("en az bir kayıt var ve sürümler benzersiz", () => {
    expect(RELEASE_NOTES.length).toBeGreaterThan(0);
    const versions = RELEASE_NOTES.map((n) => n.version);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("her kayıtta iki dil de dolu ve tarih biçimi doğru", () => {
    for (const note of RELEASE_NOTES) {
      expect(note.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(note.version).toMatch(/^\d+\.\d+\.\d+$/);
      // En az bir başlık (yenilik ya da düzeltme) olmalı.
      expect(note.tr.added.length + note.tr.fixed.length).toBeGreaterThan(0);
      expect(note.en.added.length + note.en.fixed.length).toBeGreaterThan(0);
    }
  });

  it("en üstteki kayıt en yeni sürüm", () => {
    const [first, ...rest] = RELEASE_NOTES;
    for (const note of rest) {
      const a = first.version.split(".").map(Number);
      const b = note.version.split(".").map(Number);
      const newer =
        a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]) || (a[0] === b[0] && a[1] === b[1] && a[2] > b[2]);
      expect(newer).toBe(true);
    }
  });
});

describe("notesFor", () => {
  it("sürüm ve dile göre not döner", () => {
    const notes = notesFor(RELEASE_NOTES[0].version, "tr");
    expect(notes).not.toBeNull();
    expect(notes).toEqual(RELEASE_NOTES[0].tr);
  });

  it('"v" önekini ve dil kodunu normalize eder', () => {
    const v = RELEASE_NOTES[0].version;
    expect(notesFor(`v${v}`, "tr-TR")).toEqual(RELEASE_NOTES[0].tr);
    expect(notesFor(v, "en-US")).toEqual(RELEASE_NOTES[0].en);
  });

  it("bilinmeyen sürümde en yeni kayda düşer", () => {
    expect(notesFor("9.9.9", "tr")).toEqual(RELEASE_NOTES[0].tr);
  });
});
