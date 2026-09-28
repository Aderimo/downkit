import { beforeEach, describe, expect, test } from "vitest";
import { useEditorStore, type EditorSourceEntry } from "../store/editorStore";
import { usePlayerStore, type PlayerApi } from "../store/playerStore";
import type { SeqClip } from "./sequence";
import { onSourceTime, playerReady, seekTimeline, togglePlayback } from "./sequencePlayer";

// Çoklu kaynak oynatma geçişi: 1. kaynağın parçası bitince 2. kaynağa geçişte
// oynatma devam etmeli (kaynak değişimi oynatıcıyı yeniden kurar).

const apis: FakeApi[] = [];

class FakeApi implements PlayerApi {
  played = false;
  paused = false;
  seeks: number[] = [];
  rate = 1;
  constructor(public token: string) {
    apis.push(this);
  }
  seek(s: number) {
    this.seeks.push(s);
  }
  play() {
    this.played = true;
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
  toggle() {}
  setRate(r: number) {
    this.rate = r;
  }
  setVolume() {}
  setMuted() {}
  getTime() {
    return this.seeks.at(-1) ?? 0;
  }
}

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
        durationSeconds: 10,
        width: 1920,
        height: 1080,
        fps: 30,
        videoCodec: "h264",
        audioCodec: "aac",
        container: "mp4",
        chapters: [],
      },
    },
    stream: {
      kind: "file",
      url: `http://x/${id}`,
      audioUrl: null,
      token: `tok-${id}`,
      hasVideo: true,
    },
    title: id,
    duration: 10,
    thumbnailUrl: null,
    platform: "local",
  };
}

const clip = (id: string, sourceId: string, start: number): SeqClip => ({
  id,
  sourceId,
  track: 0,
  start,
  srcStart: 0,
  srcEnd: 10,
  speed: 1,
  name: "",
});

beforeEach(() => {
  apis.length = 0;
  // Yeni dizi referansları: sequencePlayer'ın parça önbelleği geçersiz kılınır.
  const s1 = entry("s1");
  const s2 = entry("s2");
  useEditorStore.setState({
    sources: [s1, s2],
    clips: [clip("c1", "s1", 0), clip("c2", "s2", 10)],
    activeSourceId: "s1",
    source: s1.source,
    stream: s1.stream,
    duration: 10,
    texts: [],
    past: [],
    future: [],
    selectedIds: [],
  });
  usePlayerStore.setState({
    api: null,
    currentTime: 0,
    playing: false,
    waiting: false,
    rate: 1,
    stopAt: null,
    inGap: false,
    gapPlaying: false,
  });
  usePlayerStore.getState().setApi(new FakeApi("tok-s1"));
});

describe("kaynaklar arası oynatma geçişi", () => {
  test("1. kaynak bitince 2. kaynağa geçilir ve oynatma sürer", () => {
    togglePlayback();
    const api1 = apis[0];
    expect(api1.played).toBe(true);

    // Parça sonuna gelindi: 2. kaynağa geçiş istenir.
    onSourceTime(10);
    expect(useEditorStore.getState().activeSourceId).toBe("s2");

    // Yeni oynatıcı kurulur (MediaPlayer onApi): arama + oynatma uygulanır.
    const api2 = new FakeApi("tok-s2");
    usePlayerStore.getState().setApi(api2);
    playerReady();
    expect(api2.seeks).toEqual([0]);
    expect(api2.played).toBe(true);
  });

  test("duraklatılmışken 2. kaynağın ortasına arama yapılır, sonra oynatılır", () => {
    seekTimeline(15); // 2. kaynağın parçası, kaynak anı 5
    expect(useEditorStore.getState().activeSourceId).toBe("s2");
    const api2 = new FakeApi("tok-s2");
    usePlayerStore.getState().setApi(api2);
    playerReady();
    expect(api2.seeks).toEqual([5]); // parça başı değil, tıklanan an
    expect(api2.played).toBe(false); // duraklatılmışken arama oynatmaz

    togglePlayback(); // aynı kaynakta oynatmaya devam
    expect(api2.played).toBe(true);
  });
});
