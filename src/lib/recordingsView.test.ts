import { describe, expect, it } from "vitest";
import { dayLabelKind, folderCounts, groupRecordings } from "./recordingsView";
import type { RecordingFile } from "../types/recorder";

const at = (y: number, m: number, d: number, h: number) => new Date(y, m - 1, d, h).getTime();

function file(name: string, createdMs: number, folder: string | null): RecordingFile {
  return {
    path: `C:\\Kayıtlar\\${name}.mp4`,
    name,
    extension: "mp4",
    sizeBytes: 1,
    modifiedMs: createdMs,
    createdMs,
    folder,
    durationSeconds: 30,
    width: 1920,
    height: 1080,
    needsRepair: false,
  };
}

const files = [
  file("yeni", at(2026, 9, 26, 22), "League of Legends"),
  file("eski", at(2026, 9, 24, 10), null),
  file("orta", at(2026, 9, 26, 9), "VALORANT"),
  file("dün", at(2026, 9, 25, 18), "League of Legends"),
];

describe("Kayıtlarım görünümü", () => {
  it("eskiden yeniye sıralanır, en yeni kayıt en altta; güne göre gruplanır", () => {
    const groups = groupRecordings(files, undefined, true);
    expect(groups.map((g) => g.key)).toEqual(["2026-09-24", "2026-09-25", "2026-09-26"]);
    expect(groups.at(-1)?.files.map((f) => f.name)).toEqual(["orta", "yeni"]);
  });

  it("ters sırada en yeni en üstte", () => {
    const groups = groupRecordings(files, undefined, false);
    expect(groups[0].files[0].name).toBe("yeni");
  });

  it("klasöre göre süzülür; null ayrılmamış kayıtlar demektir", () => {
    expect(
      groupRecordings(files, "League of Legends", true).flatMap((g) => g.files.map((f) => f.name)),
    ).toEqual(["dün", "yeni"]);
    expect(groupRecordings(files, null, true).flatMap((g) => g.files.map((f) => f.name))).toEqual([
      "eski",
    ]);
  });

  it("klasör çipleri alfabetik, ayrılmamışlar sonda", () => {
    expect(folderCounts(files)).toEqual([
      { name: "League of Legends", count: 2 },
      { name: "VALORANT", count: 1 },
      { name: null, count: 1 },
    ]);
  });

  it("gün başlığı bugün, dün ya da tarih", () => {
    const now = at(2026, 9, 26, 23);
    expect(dayLabelKind(at(2026, 9, 26, 0), now)).toBe("today");
    expect(dayLabelKind(at(2026, 9, 25, 0), now)).toBe("yesterday");
    expect(dayLabelKind(at(2026, 9, 24, 0), now)).toBe("date");
  });
});
