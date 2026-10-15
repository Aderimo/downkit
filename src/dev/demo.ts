// Yalnızca geliştirme sunucusunda README ekran görüntüleri için örnek durum yükler:
// http://localhost:1420/?demo=home&lang=en&route=home
// Üretim derlemesinde `import.meta.env.DEV` false olduğu için bu dosya pakete girmez.
// Örnek içerik Blender Foundation'ın açık filmleridir (CC BY) — kimsenin telifli
// videosu ekran görüntülerinde görünmesin diye.

import i18n from "../i18n";
import { useJobsStore } from "../store/jobsStore";
import { useEditorStore } from "../store/editorStore";
import { usePlayerStore } from "../store/playerStore";
import { useRecorderStore } from "../store/recorderStore";
import { useSnipStore } from "../store/snipStore";
import { useTutorialStore } from "../lib/tutorial";
import { useSettingsStore } from "../lib/appSettings";
import { useUpdateStore } from "../lib/updateCheck";
import { setLevels } from "../lib/levels";
import { useMarkersStore } from "../lib/markers";
import { isXfadeKind, type XfadeKind } from "../lib/xfade";
import type { Job } from "../types/jobs";
import type { EditorSourceEntry } from "../store/editorStore";

const MB = 1024 * 1024;
const thumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

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

/** Düzenleyici sahnesi için yerel bir video kaynağı. */
function bunnySource(previewUrl: string, lang: string): EditorSourceEntry {
  const fileName = lang === "en" ? "Game recording.mp4" : "Oyun kaydı.mp4";
  return {
    id: "s1",
    source: {
      kind: "local",
      path: `C:\\Users\\aderimo\\Videos\\DownKit\\${fileName}`,
      info: {
        fileName,
        filePath: fileName,
        fileSizeBytes: 640 * MB,
        durationSeconds: 634,
        width: 3840,
        height: 2160,
        fps: 60,
        videoCodec: "h264",
        audioCodec: "aac",
        container: "mp4",
        // Bölüm listesi ve "Bölümlerden böl" denensin diye örnek bölümler.
        chapters: [
          { start: 0, end: 70, title: "Opening" },
          { start: 70, end: 262, title: "Meet Bunny" },
          { start: 262, end: 420, title: "The bullies" },
          { start: 420, end: 600, title: "The plan" },
          { start: 600, end: 634, title: "Ending" },
        ],
      },
    },
    stream: { kind: "file", url: previewUrl, audioUrl: null, token: "demo", hasVideo: true },
    title: fileName,
    duration: 634,
    thumbnailUrl: null,
  };
}

function job(partial: Partial<Job> & Pick<Job, "id" | "title" | "status">): Job {
  return {
    kind: "edit",
    backendJobId: null,
    stageKey: null,
    stageParam: null,
    thumbnailUrl: null,
    platform: "local",
    durationSeconds: null,
    qualityLabel: null,
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
    pendingSteps: [],
    request: {
      kind: "edit",
      inputPath: "C:/Videos/kayit.mp4",
      url: null,
      clips: [],
      destinationDir: "C:/Videos",
      outputName: "klip",
      audioOnly: false,
      outputFormat: null,
      maxHeight: null,
      audioBitrateKbps: null,
      precise: false,
    },
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
      durationSeconds: 48,
      stageKey: "jobs.stageExporting",
      percent: 58,
      etaSeconds: 35,
      createdAt: now,
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
  ];
}

export function applyDemo(scene: string, lang: string | null): void {
  if (lang === "en" || lang === "tr") void i18n.changeLanguage(lang);
  useSettingsStore.getState().update({ defaultDownloadDir: "C:\\Users\\aderimo\\Videos\\DownKit" });
  useJobsStore.setState({ jobs: demoJobs() });
  // Tarayıcıda uygulama sürümü okunamadığı için güncelleme denetimi "hata" der;
  // görüntüde yanıltmasın diye nötr bırakılır.
  setTimeout(() => useUpdateStore.setState({ status: "idle", latest: null }), 1500);

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
          {
            hmonitor: 65537,
            ddaIndex: 0,
            x: 0,
            y: 0,
            width: 2560,
            height: 1440,
            primary: true,
            number: 1,
          },
          {
            hmonitor: 65539,
            ddaIndex: 1,
            x: 2560,
            y: 0,
            width: 1920,
            height: 1080,
            primary: false,
            number: 2,
          },
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
          // Projede örnek ekran görüntüsü yok: düzenleyici logoyla açılır.
          url: "/logo.svg",
          width: 1440,
          height: 900,
        },
      });
    }
  }
  if (scene === "editor") {
    // Önizleme dosyası yalnızca yerelde (.demo/, git dışı); yoksa oynatıcı uyarı gösterir.
    // Elle deneme: &clip=/.demo/uzun.mp4

    const params0 = new URLSearchParams(window.location.search);
    const entry = bunnySource(params0.get("clip") ?? "/.demo/preview.mp4", lang ?? "tr");
    // Kayıt sırasında konmuş örnek an işaretleri (kaynak saniyesi).
    useMarkersStore.setState({ byPath: { [entry.source.path]: [130, 175, 290, 520] } });
    useEditorStore.setState({
      phase: "ready",
      sources: [entry],
      activeSourceId: entry.id,
      source: entry.source,
      stream: entry.stream,
      duration: entry.duration,
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
      {
        ...clip("c1", 0, 0, 84, 196),
        fadeIn: 3,
        // &xfade=slideleft: ilk kesimde klipler arası geçiş.
        ...(isXfadeKind(new URLSearchParams(window.location.search).get("xfade"))
          ? {
              xfade: {
                kind: new URLSearchParams(window.location.search).get("xfade") as XfadeKind,
                duration: 2,
              },
            }
          : {}),
      },
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
    const at = Number(params0.get("t"));
    usePlayerStore.getState().patch({ currentTime: Number.isFinite(at) && at > 0 ? at : 130.4 });
    // &tab=export&frame=9:16: dışa aktarma sekmesi ve dikey çerçeve.
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "export") store.setPanelTab("export");
    const frame = params.get("frame");
    if (frame === "9:16" || frame === "1:1" || frame === "4:5" || frame === "16:9") {
      store.setExportOptions({
        frame,
        framePosition: 0.35,
        frameSplit: params.get("split") === "1",
      });
    }
  }
}
