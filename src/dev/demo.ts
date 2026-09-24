// Yalnızca geliştirme sunucusunda README ekran görüntüleri için örnek durum yükler:
// http://localhost:1420/?demo=home&lang=en&route=home
// Üretim derlemesinde `import.meta.env.DEV` false olduğu için bu dosya pakete girmez.
// Örnek içerik Blender Foundation'ın açık filmleridir (CC BY) — kimsenin telifli
// videosu ekran görüntülerinde görünmesin diye.

import i18n from "../i18n";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useJobsStore } from "../store/jobsStore";
import { useTrimFile } from "../store/localFileStore";
import { useHistoryStore } from "../lib/downloadHistory";
import { useSearchStore } from "../lib/recentSearches";
import { useSettingsStore } from "../lib/appSettings";
import { defaultDownloadOptions } from "../lib/jobPlanning";
import { useUpdateStore } from "../lib/updateCheck";
import type { Job } from "../types/jobs";
import type { MediaMetadata, PlaylistInfo } from "../types/media";

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
  previewUrl: "https://example.invalid/preview.mp4",
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
      operation: i === 2 ? "compress" : i === 4 ? "trim" : "download",
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
  if (scene === "trim") {
    useTrimFile.setState({
      phase: "ready",
      info: {
        fileName: "Big Buck Bunny.mp4",
        filePath: "C:\\Users\\aderimo\\Videos\\Big Buck Bunny.mp4",
        fileSizeBytes: 540 * MB,
        durationSeconds: 634,
        width: 1920,
        height: 1080,
        fps: 30,
        videoCodec: "h264",
        audioCodec: "aac",
        container: "mp4",
      },
    });
  }
}
