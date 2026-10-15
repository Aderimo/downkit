import { describe, expect, it } from "vitest";
import {
  dropSources,
  parseClips,
  parseProject,
  PROJECT_SCHEMA,
  ProjectError,
  projectNameFromPath,
  relinkSources,
  serializeProject,
  siblingCandidates,
  type ProjectData,
} from "./projectFile";

const sample: ProjectData = {
  schemaVersion: PROJECT_SCHEMA,
  app: "DownKit",
  savedAt: "2026-10-09T10:00:00.000Z",
  name: "Deneme",
  sources: [
    { id: "s1", path: "C:\\Videolar\\oyun.mp4", title: "oyun.mp4" },
    { id: "s2", path: "C:\\Videolar\\kamera.mp4", title: "kamera.mp4" },
  ],
  clips: [
    { id: "a", sourceId: "s1", track: 0, start: 0, srcStart: 0, srcEnd: 5, speed: 1, name: "" },
    {
      id: "b",
      sourceId: "s2",
      track: 1,
      start: 2,
      srcStart: 1,
      srcEnd: 3,
      speed: 2,
      name: "Kamera",
      volume: 0.5,
    },
  ],
  texts: [
    {
      id: "t",
      text: "Merhaba",
      start: 0,
      end: 2,
      x: 0.5,
      y: 0.8,
      size: 0.06,
      color: "#fff",
      box: false,
      bold: true,
    },
  ],
  images: [],
  music: [],
  blurs: [],
  effects: [],
  tracks: { 1: { muted: true, hidden: false, locked: true } },
  exportOptions: { frame: "9:16", framePosition: 0.3 },
};

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof ProjectError ? err.code : "other";
  }
  return null;
};

describe("proje dosyası", () => {
  it("kaydedilen proje aynen geri okunur", () => {
    const back = parseProject(serializeProject(sample));
    expect(back.sources).toEqual(sample.sources);
    expect(back.clips).toEqual(sample.clips);
    expect(back.texts).toEqual(sample.texts);
    expect(back.tracks).toEqual(sample.tracks);
    expect(back.exportOptions).toEqual(sample.exportOptions);
    expect(back.name).toBe("Deneme");
  });

  it("eski oturum kaydı (sürümsüz, tek kaynak) açılır", () => {
    const old = JSON.stringify({
      source: { kind: "local", path: "D:\\a.mp4", title: "a.mp4" },
      clips: [{ id: "x", track: 0, start: 0, srcStart: 0, srcEnd: 4, speed: 1, name: "" }],
      savedAt: "2026-01-01T00:00:00Z",
    });
    const p = parseProject(old);
    expect(p.sources).toEqual([{ id: "s1", path: "D:\\a.mp4", title: "a.mp4" }]);
    expect(p.clips).toHaveLength(1);
    expect(p.name).toBe("a");
  });

  it("link kaynakları (eski sürüm) atlanır; kaynak kalmazsa boş hatası", () => {
    const old = JSON.stringify({ sources: [{ kind: "url", path: "https://x" }], clips: [] });
    expect(code(() => parseProject(old))).toBe("empty");
  });

  it("bozuk, yabancı ve daha yeni sürüm dosyaları reddedilir", () => {
    expect(code(() => parseProject("{bozuk"))).toBe("invalid");
    expect(code(() => parseProject("[]"))).toBe("invalid");
    expect(code(() => parseProject(JSON.stringify({ schemaVersion: 1, sources: [] })))).toBe(
      "invalid",
    );
    expect(
      code(() => parseProject(JSON.stringify({ ...sample, schemaVersion: PROJECT_SCHEMA + 1 }))),
    ).toBe("newer");
  });

  it("bozuk klipler atılır, eksik alanlar tamamlanır", () => {
    const clips = parseClips([
      { id: "ok", start: -3, srcStart: 0, srcEnd: 2 },
      { id: "ters", start: 0, srcStart: 5, srcEnd: 2 },
      { start: 0, srcStart: 0, srcEnd: 1 },
      { id: "nan", start: Number.NaN, srcStart: 0, srcEnd: 1 },
      null,
    ]);
    expect(clips.map((c) => c.id)).toEqual(["ok"]);
    expect(clips[0]).toMatchObject({ start: 0, speed: 1, track: 0, name: "" });
  });

  it("eksik medya yeniden bağlanır ya da atlanır", () => {
    const moved = relinkSources(sample, { s2: "E:\\Yedek\\kamera.mp4" });
    expect(moved.sources[1].path).toBe("E:\\Yedek\\kamera.mp4");
    expect(moved.sources[0].path).toBe(sample.sources[0].path);
    const dropped = dropSources(sample, ["s2"]);
    expect(dropped.sources.map((s) => s.id)).toEqual(["s1"]);
    expect(dropped.clips.map((c) => c.id)).toEqual(["a"]);
  });

  it("bulunan dosyanın klasöründe diğer eksikler aranır", () => {
    const c = siblingCandidates("E:\\Yedek\\oyun.mp4", sample.sources);
    expect(c).toEqual({ s1: "E:\\Yedek\\oyun.mp4", s2: "E:\\Yedek\\kamera.mp4" });
  });

  it("proje adı dosya adından", () => {
    expect(projectNameFromPath("C:\\Projeler\\Klibim.downkit")).toBe("Klibim");
    expect(projectNameFromPath("/home/a/b.DOWNKIT")).toBe("b");
  });
});
