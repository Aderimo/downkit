import { beforeEach, describe, expect, test } from "vitest";
import { useEditorStore, type EditorSourceEntry } from "./editorStore";
import type { SeqClip } from "../lib/sequence";

// Zaman çizelgesi geçmişi (geri al/yinele) kaynakları da kapsar: silinen kaynak
// geri alınca önizleme oturumuyla birlikte geri gelir.

function entry(id: string): EditorSourceEntry {
  return {
    id,
    source: {
      kind: "local",
      path: `C:/${id}.mp4`,
      info: {
        fileName: `${id}.mp4`,
        filePath: `C:/${id}.mp4`,
        fileSizeBytes: 1000,
        durationSeconds: 60,
        width: 1920,
        height: 1080,
        fps: 30,
        videoCodec: "h264",
        audioCodec: "aac",
        container: "mp4",
        chapters: [],
      },
    },
    stream: { kind: "file", url: `blob:${id}`, audioUrl: null, token: `tok-${id}`, hasVideo: true },
    title: id,
    duration: 60,
    thumbnailUrl: null,
    platform: "local",
  };
}

const clip = (id: string, sourceId: string): SeqClip => ({
  id,
  sourceId,
  track: 0,
  start: 0,
  srcStart: 0,
  srcEnd: 10,
  speed: 1,
  name: "",
});

function reset() {
  useEditorStore.setState({
    sources: [],
    clips: [],
    texts: [],
    past: [],
    future: [],
    dragOrigin: null,
    source: null,
    stream: null,
    activeSourceId: null,
    duration: 0,
    selectedIds: [],
    selectedTextId: null,
  });
}

beforeEach(reset);

describe("geçmiş: kaynak silme", () => {
  test("kaynak silmek geri alınabilir; önizleme oturumu da geri gelir", () => {
    const s1 = entry("s1");
    const s2 = entry("s2");
    useEditorStore.setState({
      sources: [s1, s2],
      clips: [clip("c1", "s1"), clip("c2", "s2")],
      activeSourceId: "s1",
      source: s1.source,
      stream: s1.stream,
      duration: 60,
    });
    useEditorStore.getState().removeSource("s2");
    let st = useEditorStore.getState();
    expect(st.sources.map((s) => s.id)).toEqual(["s1"]);
    expect(st.clips.map((c) => c.id)).toEqual(["c1"]);
    expect(st.past).toHaveLength(1);

    st.undo();
    st = useEditorStore.getState();
    expect(st.sources.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(st.clips.map((c) => c.id)).toEqual(["c1", "c2"]);
    // Giriş referans olarak saklandığı için akış (token) korunur.
    expect(st.sources[1].stream?.token).toBe("tok-s2");
  });

  test("etkin kaynak silinirse geri alınca etkinlik ve akış geri gelir", () => {
    const s1 = entry("s1");
    const s2 = entry("s2");
    useEditorStore.setState({
      sources: [s1, s2],
      clips: [clip("c2", "s2")],
      activeSourceId: "s2",
      source: s2.source,
      stream: s2.stream,
      duration: 60,
    });
    useEditorStore.getState().removeSource("s2");
    let st = useEditorStore.getState();
    expect(st.activeSourceId).toBe("s1");
    expect(st.stream?.token).toBe("tok-s1");

    st.undo();
    st = useEditorStore.getState();
    expect(st.activeSourceId).toBe("s2");
    expect(st.stream?.token).toBe("tok-s2");

    st.redo();
    st = useEditorStore.getState();
    expect(st.sources.map((s) => s.id)).toEqual(["s1"]);
    expect(st.activeSourceId).toBe("s1");
  });
});

describe("geçmiş: klip adı", () => {
  test("yeniden adlandırma geri alınabilir", () => {
    const s1 = entry("s1");
    useEditorStore.setState({
      sources: [s1],
      clips: [clip("c1", "s1")],
      activeSourceId: "s1",
      source: s1.source,
      stream: s1.stream,
      duration: 60,
    });
    useEditorStore.getState().renameClip("c1", "Açılış");
    let st = useEditorStore.getState();
    expect(st.clips[0].name).toBe("Açılış");
    expect(st.past).toHaveLength(1);

    st.undo();
    st = useEditorStore.getState();
    expect(st.clips[0].name).toBe("");

    st.redo();
    expect(useEditorStore.getState().clips[0].name).toBe("Açılış");
  });

  test("ad değişmediyse geçmişe adım eklenmez", () => {
    const s1 = entry("s1");
    useEditorStore.setState({ sources: [s1], clips: [clip("c1", "s1")] });
    useEditorStore.getState().renameClip("c1", "");
    expect(useEditorStore.getState().past).toHaveLength(0);
  });
});

describe("geçmiş: apply anlık görüntüsü kaynakları kapsar", () => {
  test("klip değişikliği geri alınınca kaynak listesi de o adıma döner", () => {
    const s1 = entry("s1");
    const s2 = entry("s2");
    useEditorStore.setState({
      sources: [s1, s2],
      clips: [clip("c1", "s1")],
      activeSourceId: "s1",
      source: s1.source,
      stream: s1.stream,
      duration: 60,
    });
    // Kaynak silme + klip değişikliği arka arkaya: iki ayrı geri alma adımı.
    useEditorStore.getState().removeSource("s2");
    useEditorStore.getState().apply((clips) => clips.filter((c) => c.id !== "c1"));
    let st = useEditorStore.getState();
    expect(st.clips).toHaveLength(0);

    st.undo(); // klip silme geri alınır
    st = useEditorStore.getState();
    expect(st.clips).toHaveLength(1);
    expect(st.sources).toHaveLength(1);

    st.undo(); // kaynak silme geri alınır
    st = useEditorStore.getState();
    expect(st.sources.map((s) => s.id)).toEqual(["s1", "s2"]);
  });
});
