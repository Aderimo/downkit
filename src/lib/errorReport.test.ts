import { describe, expect, it } from "vitest";
import { buildErrorReport, redactPaths } from "./errorReport";

describe("hata raporu", () => {
  it("kullanıcı adı içeren yollar gizlenir", () => {
    expect(redactPaths("C:\\Users\\Ahmet\\Videos\\a.mp4")).toBe("C:\\Users\\<user>\\Videos\\a.mp4");
    expect(redactPaths('"C:/Users/ayşe/AppData"')).toBe('"C:/Users/<user>/AppData"');
    expect(redactPaths("D:\\Filmler\\x.mkv")).toBe("D:\\Filmler\\x.mkv");
  });

  it("rapor sürüm, iş, hata ve kısaltılmış ayrıntı içerir", () => {
    const report = buildErrorReport(
      {
        message: "İndirme tamamlanamadı",
        detail: "x".repeat(5000) + " C:\\Users\\Ali\\a.mp4",
        context: "download · youtube · MP4",
      },
      "0.1.0",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    );
    expect(report).toContain("DownKit v0.1.0 · Windows 10.0");
    expect(report).toContain("İş: download · youtube · MP4");
    expect(report).toContain("<user>");
    expect(report).not.toContain("Ali");
    expect(report.length).toBeLessThan(3800);
  });

  it("son günlük satırları kullanıcı adı gizlenerek eklenir", () => {
    const report = buildErrorReport(
      { message: "Olmadı", detail: null },
      "0.1.0",
      "Windows NT 10.0",
      "2026-09-26T10:00:00Z [error] download: C:\\Users\\ahmet\\Videos\\a.mp4",
    );
    expect(report).toContain("Son günlük:");
    expect(report).toContain("<user>");
    expect(report).not.toContain("ahmet");
  });
});
