// Yalnızca geliştirme sunucusunda README ekran görüntüleri için örnek durum yükler:
// http://localhost:1420/?demo=home&lang=en&route=home
// Üretim derlemesinde `import.meta.env.DEV` false olduğu için bu dosya pakete girmez.
// Örnek içerik Blender Foundation'ın açık filmleridir (CC BY) — kimsenin telifli
// videosu ekran görüntülerinde görünmesin diye.

import i18n from "../i18n";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useJobsStore } from "../store/jobsStore";
import { useEditorStore } from "../store/editorStore";
import { usePlayerStore } from "../store/playerStore";
import { useRecorderStore } from "../store/recorderStore";
import { useSnipStore } from "../store/snipStore";
import { useTutorialStore } from "../lib/tutorial";
import { useHistoryStore } from "../lib/downloadHistory";
import { useSearchStore } from "../lib/recentSearches";
import { useSettingsStore } from "../lib/appSettings";
import { defaultDownloadOptions } from "../lib/jobPlanning";
import { useUpdateStore } from "../lib/updateCheck";
import { setLevels } from "../lib/levels";
import type { Job } from "../types/jobs";
import type { MediaMetadata, PlaylistInfo, Storyboard } from "../types/media";

const MB = 1024 * 1024;
const thumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
const watch = (id: string) => `https://www.youtube.com/watch?v=${id}`;

const MOVIES = [
  {
    id: "aqz-KE-bpKQ",
    title: "Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film",
    duration: 634,
  },
  { id: "eRsGyueVLvQ", title: "Sintel - Third Open Movie by Blender Foundation", duration: 888 },
  { id: "R6MlUcmOul8", title: "Tears of Steel - Blender VFX Open Movie", duration: 734 },
  { id: "WhWc3b3KhnY", title: "Spring - Blender Open Movie", duration: 464 },
  {
    id: "Y-rmzh0PI3c",
    title: "Cosmos Laundromat - First Cycle. Official Blender Foundation release.",
    duration: 730,
  },
  { id: "mN0zPOpADL4", title: "Agent 327: Operation Barbershop", duration: 231 },
];

const bunny: MediaMetadata = {
  platform: "youtube",
  title: MOVIES[0].title,
  uploader: "Blender",
  durationSeconds: 634,
  thumbnailUrl: `https://i.ytimg.com/vi/${MOVIES[0].id}/maxresdefault.jpg`,
  sourceWidth: 3840,
  sourceHeight: 2160,
  fps: 60,
  description:
    "Big Buck Bunny tells the story of a giant rabbit with a heart bigger than himself. Licensed under Creative Commons Attribution 3.0.",
  viewCount: 16_400_000,
  uploadDate: "20140310",
  preview: null,
  storyboard: null,
  chapters: [
    { start: 0, end: 84, title: "Opening" },
    { start: 84, end: 262, title: "Meet Bunny" },
    { start: 262, end: 488, title: "The bullies" },
    { start: 488, end: 610, title: "The plan" },
    { start: 610, end: 634, title: "Credits" },
  ],
  qualityOptions: [
    { height: 2160, container: "mp4", estimatedSizeBytes: 1920 * MB },
    { height: 1440, container: "mp4", estimatedSizeBytes: 960 * MB },
    { height: 1080, container: "mp4", estimatedSizeBytes: 540 * MB },
    { height: 720, container: "mp4", estimatedSizeBytes: 285 * MB },
    { height: 480, container: "mp4", estimatedSizeBytes: 150 * MB },
    { height: 360, container: "mp4", estimatedSizeBytes: 95 * MB },
  ],
  audioOption: { container: "m4a", bitrateKbps: 129, estimatedSizeBytes: 10 * MB },
  formats: [
    {
      formatId: "401",
      container: "mp4",
      height: 2160,
      isAudioOnly: false,
      codecLabel: "AV1",
      bitrateKbps: null,
      estimatedSizeBytes: 1820 * MB,
    },
    {
      formatId: "299",
      container: "mp4",
      height: 1080,
      isAudioOnly: false,
      codecLabel: "H.264",
      bitrateKbps: null,
      estimatedSizeBytes: 520 * MB,
    },
    {
      formatId: "136",
      container: "mp4",
      height: 720,
      isAudioOnly: false,
      codecLabel: "H.264",
      bitrateKbps: null,
      estimatedSizeBytes: 270 * MB,
    },
  ],
  flacEligible: false,
};

// YouTube'un bu video için verdiği gerçek kare sayfaları (zaman çizelgesi şeridi).
const BUNNY_STORYBOARD: Storyboard = {
  width: 160,
  height: 90,
  rows: 5,
  columns: 5,
  interval: 4.9609375,
  sheets: [
    {
      url: "https://i.ytimg.com/sb/aqz-KE-bpKQ/storyboard3_L2/M0.jpg?sqp=-oaymwENSDfyq4qpAwVwAcABBqLzl_8DBgjEj7SoBg==&sigh=rs$AOn4CLC9nRwSugHSXO3o99N1OLx6MOkrlA",
      start: 0,
      duration: 124.0234375,
    },
    {
      url: "https://i.ytimg.com/sb/aqz-KE-bpKQ/storyboard3_L2/M1.jpg?sqp=-oaymwENSDfyq4qpAwVwAcABBqLzl_8DBgjEj7SoBg==&sigh=rs$AOn4CLC9nRwSugHSXO3o99N1OLx6MOkrlA",
      start: 124.023,
      duration: 124.0234375,
    },
    {
      url: "https://i.ytimg.com/sb/aqz-KE-bpKQ/storyboard3_L2/M2.jpg?sqp=-oaymwENSDfyq4qpAwVwAcABBqLzl_8DBgjEj7SoBg==&sigh=rs$AOn4CLC9nRwSugHSXO3o99N1OLx6MOkrlA",
      start: 248.047,
      duration: 124.0234375,
    },
    {
      url: "https://i.ytimg.com/sb/aqz-KE-bpKQ/storyboard3_L2/M3.jpg?sqp=-oaymwENSDfyq4qpAwVwAcABBqLzl_8DBgjEj7SoBg==&sigh=rs$AOn4CLC9nRwSugHSXO3o99N1OLx6MOkrlA",
      start: 372.07,
      duration: 124.0234375,
    },
    {
      url: "https://i.ytimg.com/sb/aqz-KE-bpKQ/storyboard3_L2/M4.jpg?sqp=-oaymwENSDfyq4qpAwVwAcABBqLzl_8DBgjEj7SoBg==&sigh=rs$AOn4CLC9nRwSugHSXO3o99N1OLx6MOkrlA",
      start: 496.094,
      duration: 124.0234375,
    },
    {
      url: "https://i.ytimg.com/sb/aqz-KE-bpKQ/storyboard3_L2/M5.jpg?sqp=-oaymwENSDfyq4qpAwVwAcABBqLzl_8DBgjEj7SoBg==&sigh=rs$AOn4CLC9nRwSugHSXO3o99N1OLx6MOkrlA",
      start: 620.117,
      duration: 14.8828125,
    },
  ],
};

function job(partial: Partial<Job> & Pick<Job, "id" | "title" | "status">): Job {
  const options = defaultDownloadOptions();
  return {
    kind: "download",
    backendJobId: null,
    stageKey: null,
    stageParam: null,
    thumbnailUrl: null,
    platform: "youtube",
    durationSeconds: null,
    qualityLabel: "1080p",
    formatLabel: "MP4",
    percent: null,
    downloadedBytes: null,
    totalBytesEstimate: null,
    audioBytesEstimate: null,
    speedBps: null,
    etaSeconds: null,
    outputs: [],
    fileSizeBytes: null,
    errorMessage: null,
    errorDetail: null,
    notice: null,
    partialTarget: null,
    request: {
      kind: "download",
      url: watch("x"),
      destinationDir: "C:/Videos",
      options,
      needsAnalyze: false,
    },
    pendingSteps: [],
    pauseRequested: false,
    createdAt: Date.now(),
    ...partial,
  };
}

function demoJobs(): Job[] {
  const now = Date.now();
  return [
    job({
      id: "j1",
      title: MOVIES[1].title,
      status: "running",
      thumbnailUrl: thumb(MOVIES[1].id),
      durationSeconds: MOVIES[1].duration,
      stageKey: "jobs.stageVideo",
      stageParam: "62",
      percent: 58,
      downloadedBytes: 412 * MB,
      totalBytesEstimate: 706 * MB,
      speedBps: 8.4 * MB,
      etaSeconds: 35,
      createdAt: now,
    }),
    job({
      id: "j2",
      title: MOVIES[2].title,
      status: "postprocessing",
      thumbnailUrl: thumb(MOVIES[2].id),
      durationSeconds: MOVIES[2].duration,
      stageKey: "jobs.stageResizingFor",
      stageParam: "resize.presetTiktok",
      percent: 44,
      createdAt: now - 1000,
    }),
    job({
      id: "j3",
      title: MOVIES[5].title,
      status: "done",
      thumbnailUrl: thumb(MOVIES[5].id),
      durationSeconds: 112,
      formatLabel: "MP4 · 1:24–3:16",
      percent: 100,
      outputs: ["C:/Videos/Agent 327 (01.24-03.16).mp4"],
      fileSizeBytes: 64 * MB,
      createdAt: now - 2000,
    }),
    job({
      id: "j4",
      title: MOVIES[3].title,
      status: "done",
      thumbnailUrl: thumb(MOVIES[3].id),
      durationSeconds: MOVIES[3].duration,
      percent: 100,
      outputs: ["C:/Videos/Spring.mp4", "C:/Videos/Spring (1080x1920).mp4"],
      fileSizeBytes: 312 * MB,
      createdAt: now - 3000,
    }),
    job({
      id: "j5",
      title: MOVIES[4].title,
      status: "queued",
      thumbnailUrl: thumb(MOVIES[4].id),
      durationSeconds: MOVIES[4].duration,
      qualityLabel: "192 kbps",
      formatLabel: "MP3",
      createdAt: now - 4000,
    }),
  ];
}

const playlist: PlaylistInfo = {
  platform: "youtube",
  title: "Blender Open Movies",
  uploader: "Blender",
  entries: MOVIES.map((m) => ({
    url: watch(m.id),
    title: m.title,
    durationSeconds: m.duration,
    thumbnailUrl: thumb(m.id),
  })),
  totalCount: MOVIES.length,
};

export function applyDemo(scene: string, lang: string | null): void {
  if (lang === "en" || lang === "tr") void i18n.changeLanguage(lang);
  useSettingsStore.getState().update({ defaultDownloadDir: "C:\\Users\\aderimo\\Videos\\DownKit" });
  useJobsStore.setState({ jobs: demoJobs() });
  useSearchStore.setState({
    entries: MOVIES.slice(1, 4).map((m) => ({
      url: watch(m.id),
      title: m.title,
      thumbnailUrl: thumb(m.id),
      platform: "youtube",
      searchedAt: new Date().toISOString(),
    })),
  });
  useHistoryStore.setState({
    entries: MOVIES.map((m, i) => ({
      id: m.id,
      filePath: `C:\\Users\\aderimo\\Videos\\DownKit\\${m.title}.mp4`,
      fileName: `${m.title}.mp4`,
      fileSizeBytes: (120 + i * 70) * MB,
      title: m.title,
      thumbnailUrl: thumb(m.id),
      platform: "youtube",
      operation: i === 2 ? "compress" : i === 4 ? "edit" : "download",
      formatLabel: i === 1 ? "MP3" : "MP4",
      sourceUrl: watch(m.id),
      completedAt: new Date(Date.now() - i * 3_600_000).toISOString(),
    })),
  });

  // Tarayıcıda uygulama sürümü okunamadığı için güncelleme denetimi "hata" der;
  // görüntüde yanıltmasın diye nötr bırakılır.
  setTimeout(() => useUpdateStore.setState({ status: "idle", latest: null }), 1500);

  const ws = useWorkspaceStore.getState();
  if (scene === "home") {
    ws.setUrl(watch(MOVIES[0].id));
    ws.analyzeSucceeded(watch(MOVIES[0].id), bunny);
    ws.setOptions({ maxHeight: 1080, section: { start: 84, end: 196 } });
  }
  if (scene === "playlist") {
    ws.setUrl("https://www.youtube.com/playlist?list=PL-blender-open-movies");
    ws.playlistLoaded("https://www.youtube.com/playlist?list=PL-blender-open-movies", playlist);
    ws.togglePlaylistEntry(watch(MOVIES[4].id));
  }
  if (scene === "tutorial") {
    // &step=0…6: turun hangi adımı gösterilsin.
    const step = Number(new URLSearchParams(window.location.search).get("step") ?? 0);
    useTutorialStore.setState({ open: true, step, dontShowAgain: false });
  }
  if (scene === "record") {
    // Kayıt sürüyor, anlık tekrar açık; Kayıtlarım'da Blender filmlerinden örnekler.
    const dir = `C:\\Users\\aderimo\\Videos\\DownKit\\${lang === "en" ? "Recordings" : "Kayıtlar"}`;
    const names =
      lang === "en"
        ? ["Instant replay", "Recording", "Recording", "Instant replay", "Recording"]
        : ["Anlık tekrar", "Kayıt", "Kayıt", "Anlık tekrar", "Kayıt"];
    const recordings = MOVIES.slice(0, 5).map((_m, i) => ({
      path: `${dir}\\${names[i]} 2026-09-2${5 - i} 2${i}.1${i}.0${i}.mp4`,
      name: `${names[i]} 2026-09-2${5 - i} 2${i}.1${i}.0${i}`,
      extension: "mp4",
      sizeBytes: [18, 412, 96, 24, 250][i] * MB,
      modifiedMs: Date.now() - i * 86_400_000 - i * 3_600_000,
      createdMs: Date.now() - i * 86_400_000 - i * 3_600_000,
      folder: ["League of Legends", null, "VALORANT", "League of Legends", null][i],
      durationSeconds: [30, 754, 188, 30, 402][i],
      width: 1920,
      height: 1080,
      needsRepair: false,
    }));
    useRecorderStore.setState({
      sources: {
        monitors: [
          { hmonitor: 65537, ddaIndex: 0, x: 0, y: 0, width: 2560, height: 1440, primary: true, number: 1 },
          { hmonitor: 65539, ddaIndex: 1, x: 2560, y: 0, width: 1920, height: 1080, primary: false, number: 2 },
        ],
        windows: [
          {
            hwnd: 1,
            title: "League of Legends (TM) Client",
            exe: "League of Legends.exe",
            width: 1920,
            height: 1080,
            minimized: false,
            own: false,
          },
          {
            hwnd: 2,
            title: "Discord",
            exe: "Discord.exe",
            width: 1280,
            height: 800,
            minimized: false,
            own: false,
          },
          {
            hwnd: 3,
            title: "YouTube - Google Chrome",
            exe: "chrome.exe",
            width: 1600,
            height: 900,
            minimized: false,
            own: false,
          },
          {
            hwnd: 4,
            title: "Spotify Premium",
            exe: "Spotify.exe",
            width: 1200,
            height: 700,
            minimized: true,
            own: false,
          },
        ],
        microphones: [{ id: "mic", name: "Mikrofon (USB Audio)", isDefault: true }],
        speakers: [
          { id: "spk", name: "Hoparlör (Realtek Audio)", isDefault: true },
          { id: "hs", name: "Kulaklık (HyperX Cloud II)", isDefault: false },
        ],
      },
      encoder: { encoder: "nvenc", label: "NVIDIA NVENC", hardware: true },
      outputDir: dir,
      status: {
        recording: { seconds: 754, bytes: 412 * MB, path: dir, hasAudio: true },
        replay: { bufferedSeconds: 30, seconds: 30, encoder: "NVIDIA NVENC" },
      },
      recordings,
      recordingsLoaded: true,
      thumbs: Object.fromEntries(recordings.map((r, i) => [r.path, thumb(MOVIES[i].id)])),
    });
    // Göstergeler canlı görünsün: gerçek uygulamadaki gibi saniyede 20 seviye.
    window.setInterval(
      () => setLevels([0.3 + Math.random() * 0.25, 0.1 + Math.random() * 0.12]),
      50,
    );
  }
  if (scene === "screenshot" || scene === "snipEditor") {
    // Ekran görüntülerim'de Blender filmlerinden kareler; düzenleyicide DownKit'in
    // kendi ana sayfası üzerinde örnek çizimler.
    const dir = "C:\\Users\\aderimo\\Pictures\\DownKit";
    const prefix = lang === "en" ? "Screenshot" : "Ekran görüntüsü";
    const shots = MOVIES.map((_m, i) => ({
      path: `${dir}\\${prefix} 2026-09-2${7 - i} 1${i}.2${i}.0${i}.png`,
      name: `${prefix} 2026-09-2${7 - i} 1${i}.2${i}.0${i}`,
      bytes: [412, 380, 1260, 96, 744][i % 5] * 1024,
      modified: Date.now() - i * 26 * 3_600_000,
    }));
    useSnipStore.setState({
      outputDir: dir,
      shots,
      shotsLoaded: true,
      thumbs: Object.fromEntries(shots.map((s, i) => [s.path, thumb(MOVIES[i].id)])),
    });
    if (scene === "snipEditor") {
      const red = "#ef4444";
      const green = "#22c55e";
      const amber = "#f59e0b";
      useSnipStore.setState({
        demoShapes: [
          { kind: "rect", x1: 268, y1: 30, x2: 1060, y2: 84, color: red, width: 5 },
          { kind: "step", x: 236, y: 57, n: 1, color: red, size: 19 },
          { kind: "rect", x1: 1086, y1: 88, x2: 1424, y2: 318, color: green, width: 5 },
          { kind: "step", x: 1060, y: 118, n: 2, color: green, size: 19 },
          { kind: "pixelate", x1: 282, y1: 166, x2: 536, y2: 392, color: red, width: 5 },
          { kind: "arrow", x1: 1210, y1: 610, x2: 1040, y2: 500, color: amber, width: 7 },
          {
            kind: "text",
            x: 1020,
            y: 620,
            text: lang === "en" ? "Download only this part" : "Yalnızca bu kısmı indir",
            color: amber,
            size: 30,
          },
        ],
      });
      useSnipStore.getState().patch({
        image: {
          path: `${dir}\\demo.png`,
          // Geliştirme sunucusu proje kökündeki dosyaları olduğu gibi sunar.
          url: `/docs/screenshots/${lang === "en" ? "en" : "tr"}/home.png`,
          width: 1440,
          height: 900,
        },
      });
    }
  }
  if (scene === "editor") {
    // Önizleme dosyası yalnızca yerelde (.demo/, git dışı); yoksa oynatıcı uyarı gösterir.
    // Elle deneme: &clip=/.demo/uzun.mp4 ya da &hls=<aktarıcı adresi>.
    const editor = useEditorStore.getState();
    editor.openMetadata(watch(MOVIES[0].id), {
      ...bunny,
      preview: {
        kind: new URLSearchParams(window.location.search).get("hls") ? "hls" : "file",
        url:
          new URLSearchParams(window.location.search).get("hls") ??
          new URLSearchParams(window.location.search).get("clip") ??
          "/.demo/preview.mp4",
        audioUrl: null,
        token: "demo",
        hasVideo: true,
      },
      storyboard: BUNNY_STORYBOARD,
    });
    // Bölünmüş, bir kısmı silinmiş, biri hızlandırılmış ve üst katmanda bir ara
    // görüntü olan örnek bir zaman çizelgesi.
    const clip = (
      id: string,
      track: number,
      start: number,
      srcStart: number,
      srcEnd: number,
      speed = 1,
      name = "",
    ) => ({ id, track, start, srcStart, srcEnd, speed, name });
    const store = useEditorStore.getState();
    store.apply(() => [
      { ...clip("c1", 0, 0, 84, 196), fadeIn: 3 },
      clip("c2", 0, 112, 262, 301.5),
      { ...clip("c3", 0, 170, 488, 560, 1.5, "Final"), fadeOut: 4 },
      { ...clip("c4", 1, 60, 610, 622), volume: 0 },
    ]);
    // &select=none: klip seçilmez (sağ panelde özet ve bölümler görünür).
    if (new URLSearchParams(window.location.search).get("select") !== "none") store.select(["c2"]);
    // Örnek yazı: imlecin olduğu yerde görünür (&text=0 ile kapatılır).
    if (new URLSearchParams(window.location.search).get("text") !== "0") {
      store.applyTexts(() => [
        {
          id: "t1",
          text: lang === "en" ? "The giant rabbit wakes up" : "Dev tavşan uyanıyor",
          start: 118,
          end: 150,
          x: 0.5,
          y: 0.85,
          size: 0.07,
          color: "#ffffff",
          box: true,
          bold: true,
        },
      ]);
    }
    store.setView({ start: 0, end: 240 });
    usePlayerStore.getState().patch({ currentTime: 130.4 });
    // &tab=export&frame=9:16: dışa aktarma sekmesi ve dikey çerçeve.
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "export") store.setPanelTab("export");
    const frame = params.get("frame");
    if (frame === "9:16" || frame === "1:1" || frame === "4:5" || frame === "16:9") {
      store.setExportOptions({ frame, framePosition: 0.35 });
    }
  }
}
