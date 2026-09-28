import { describe, expect, test } from "vitest";
import type { EditorSourceEntry } from "../store/editorStore";
import type { EditClip } from "../types/edit";
import { localizeGroupInputs } from "./exportPlan";

function localEntry(id: string, path: string): EditorSourceEntry {
  return {
    id,
    source: {
      kind: "local",
      path,
      info: {
        fileName: path,
        filePath: path,
        fileSizeBytes: 1000,
        durationSeconds: 100,
        width: 1920,
        height: 1080,
        fps: 30,
        videoCodec: "h264",
        audioCodec: "aac",
        container: "mp4",
        chapters: [],
      },
    },
    stream: null,
    title: id,
    duration: 100,
    thumbnailUrl: null,
    platform: "local",
  };
}

function remoteEntry(id: string, url: string): EditorSourceEntry {
  return {
    ...localEntry(id, ""),
    source: { kind: "remote", url, metadata: {} as never },
    platform: "youtube",
  };
}

const clip = (source?: number): EditClip => ({
  start: 0,
  end: 10,
  speed: 1,
  volume: 1,
  fadeIn: 0,
  fadeOut: 0,
  ...(source === undefined ? {} : { source }),
});

describe("localizeGroupInputs", () => {
  const inputs = [localEntry("s1", "C:/a.mp4"), remoteEntry("s2", "https://youtu.be/x")];

  test("tek kaynaklı grup tek girdili istek olur", () => {
    const { clips, inputs: out } = localizeGroupInputs([clip(1)], inputs);
    expect(out).toEqual([{ inputPath: null, url: "https://youtu.be/x" }]);
    expect(clips[0].source).toBe(0);
  });

  test("yerel kaynak dosya yoluyla gönderilir", () => {
    const { inputs: out } = localizeGroupInputs([clip(0)], inputs);
    expect(out).toEqual([{ inputPath: "C:/a.mp4", url: null }]);
  });

  test("birleştirilmiş grup kaynakları ilk geçtikleri sırayla korur", () => {
    const { clips, inputs: out } = localizeGroupInputs([clip(1), clip(0), clip(1)], inputs);
    expect(out).toHaveLength(2);
    expect(out[0].url).toBe("https://youtu.be/x");
    expect(out[1].inputPath).toBe("C:/a.mp4");
    expect(clips.map((c) => c.source)).toEqual([0, 1, 0]);
  });

  test("boşluk (siyah) kliplere dokunulmaz", () => {
    const black: EditClip = { ...clip(), black: true };
    const { clips } = localizeGroupInputs([clip(1), black], inputs);
    expect(clips[1]).toBe(black);
    expect(clips[1].source).toBeUndefined();
  });

  test("kaynak işareti olmayan klip ilk kaynağa düşer", () => {
    const { clips, inputs: out } = localizeGroupInputs([clip()], inputs);
    expect(out).toHaveLength(1);
    expect(clips[0].source).toBe(0);
  });
});
