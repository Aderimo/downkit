import { describe, expect, test } from "vitest";
import {
  QUICK_PRESETS,
  buildChainSteps,
  defaultDownloadOptions,
  downloadProgress,
  estimateDownloadSize,
  findDuplicateDownload,
  qualityLabel,
} from "./jobPlanning";
import type { MediaMetadata } from "../types/media";
import type { Job } from "../types/jobs";

const MB = 1024 * 1024;

function metadata(overrides: Partial<MediaMetadata> = {}): MediaMetadata {
  return {
    platform: "youtube",
    title: "Deneme videosu",
    uploader: "Kanal",
    durationSeconds: 100,
    thumbnailUrl: null,
    sourceWidth: 1920,
    sourceHeight: 1080,
    fps: 30,
    description: null,
    viewCount: null,
    uploadDate: null,
    previewUrl: null,
    qualityOptions: [
      { height: 1080, container: "mp4", estimatedSizeBytes: 300 * MB },
      { height: 720, container: "mp4", estimatedSizeBytes: 150 * MB },
      { height: 360, container: "mp4", estimatedSizeBytes: 40 * MB },
    ],
    audioOption: { container: "m4a", bitrateKbps: 128, estimatedSizeBytes: 5 * MB },
    formats: [
      {
        formatId: "137",
        container: "mp4",
        height: 1080,
        isAudioOnly: false,
        codecLabel: "H.264",
        bitrateKbps: 4000,
        estimatedSizeBytes: 250 * MB,
      },
    ],
    flacEligible: false,
    ...overrides,
  };
}

describe("buildChainSteps", () => {
  test("aynı boyutu üreten platformlar tek adımda birleşir", () => {
    const steps = buildChainSteps({
      ...defaultDownloadOptions(),
      platformTargets: ["tiktok", "reels", "shorts", "youtube"],
    });
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ kind: "resize", targetWidth: 1080, targetHeight: 1920 });
    expect(steps[1]).toMatchObject({ kind: "resize", targetWidth: 1920, targetHeight: 1080 });
  });

  test("ses formatında görüntü adımı eklenmez", () => {
    const steps = buildChainSteps({
      ...defaultDownloadOptions(),
      outputFormat: "mp3",
      platformTargets: ["tiktok"],
      shrink: true,
    });
    expect(steps).toEqual([]);
  });

  test("küçük dosya seçiliyse sıkıştırma en sona eklenir", () => {
    const steps = buildChainSteps({
      ...defaultDownloadOptions(),
      platformTargets: ["instagram-post"],
      shrink: true,
      shrinkTargetMb: 9.5,
    });
    expect(steps.map((s) => s.kind)).toEqual(["resize", "compress"]);
    expect(steps[1]).toMatchObject({ mode: "targetSize", targetSizeMb: 9.5 });
  });

  test("hedef boyut yoksa sıkıştırma ön ayarla yapılır", () => {
    const steps = buildChainSteps({ ...defaultDownloadOptions(), shrink: true });
    expect(steps).toEqual([
      { kind: "compress", mode: "preset", preset: "balanced", targetSizeMb: null },
    ]);
  });

  test("bilinmeyen platform kimliği yok sayılır", () => {
    expect(buildChainSteps({ ...defaultDownloadOptions(), platformTargets: ["yok"] })).toEqual([]);
  });
});

describe("estimateDownloadSize", () => {
  test("kalite sınırı yoksa en yüksek çözünürlüğün boyutu döner", () => {
    expect(estimateDownloadSize(metadata(), defaultDownloadOptions())).toBe(300 * MB);
  });

  test("kalite sınırının altındaki en iyi seçenek kullanılır", () => {
    const options = { ...defaultDownloadOptions(), maxHeight: 720 };
    expect(estimateDownloadSize(metadata(), options)).toBe(150 * MB);
  });

  test("gelişmiş seçimde görüntü ile sesin toplamı döner", () => {
    const options = { ...defaultDownloadOptions(), formatId: "137" };
    expect(estimateDownloadSize(metadata(), options)).toBe(255 * MB);
  });

  test("kayıplı ses formatında bit hızı × süre kullanılır", () => {
    const options = {
      ...defaultDownloadOptions(),
      outputFormat: "mp3" as const,
      audioBitrateKbps: 192,
    };
    // 192 kbps × 100 sn = 2.4 MB (ondalık)
    expect(estimateDownloadSize(metadata(), options)).toBe(2_400_000);
  });

  test("kayıpsız ses formatında kaynak sesin tahmini döner", () => {
    const options = { ...defaultDownloadOptions(), outputFormat: "flac" as const };
    expect(estimateDownloadSize(metadata(), options)).toBe(5 * MB);
  });

  test("boyut bilinmiyorsa null döner", () => {
    const meta = metadata({
      qualityOptions: [{ height: 720, container: "mp4", estimatedSizeBytes: null }],
    });
    expect(estimateDownloadSize(meta, defaultDownloadOptions())).toBeNull();
  });
});

describe("qualityLabel", () => {
  test("video ve ses için doğru etiket üretilir", () => {
    expect(qualityLabel(defaultDownloadOptions())).toBe("best");
    expect(qualityLabel({ ...defaultDownloadOptions(), maxHeight: 1080 })).toBe("1080p");
    expect(
      qualityLabel({ ...defaultDownloadOptions(), outputFormat: "mp3", audioBitrateKbps: 320 }),
    ).toBe("320 kbps");
    expect(qualityLabel({ ...defaultDownloadOptions(), outputFormat: "wav" })).toBe("lossless");
  });
});

describe("downloadProgress", () => {
  const estimates = { totalBytes: 100 * MB, audioBytes: 10 * MB };

  test("son işlemler aşamasında yüzde belirsizdir", () => {
    const result = downloadProgress(estimates, {
      stage: "post_processing",
      downloadedBytes: 100 * MB,
      percent: 100,
      stream: "video",
      streamTotalBytes: null,
    });
    expect(result.percent).toBeNull();
  });

  test("video akışında sonra inecek ses de toplama eklenir", () => {
    // 45 MB'lık videonun yarısı indi → toplam 45 + 10 = 55 MB
    const result = downloadProgress(estimates, {
      stage: "downloading",
      downloadedBytes: 22.5 * MB,
      percent: 50,
      stream: "video",
      streamTotalBytes: 45 * MB,
    });
    expect(result.totalBytes).toBe(55 * MB);
    expect(result.percent).toBeCloseTo(40.9, 1);
  });

  test("tahmin büyük çıksa da ses akışının sonunda çubuk dolar", () => {
    // Analiz 100 MB demişti ama gerçekte 45 MB video + 10 MB ses indi.
    const result = downloadProgress(estimates, {
      stage: "downloading",
      downloadedBytes: 54.9 * MB,
      percent: 99,
      stream: "audio",
      streamTotalBytes: 10 * MB,
    });
    expect(result.percent).toBeGreaterThan(98);
  });

  test("akış boyutu bilinmiyorsa tahmine düşer ve %99'u geçmez", () => {
    const result = downloadProgress(estimates, {
      stage: "downloading",
      downloadedBytes: 150 * MB,
      percent: null,
      stream: "video",
      streamTotalBytes: null,
    });
    expect(result.totalBytes).toBe(150 * MB);
    expect(result.percent).toBe(99);
  });

  test("hiçbir boyut bilinmiyorsa akış yüzdesi kullanılır", () => {
    const result = downloadProgress(
      { totalBytes: null, audioBytes: null },
      {
        stage: "downloading",
        downloadedBytes: 1000,
        percent: 37,
        stream: "video",
        streamTotalBytes: null,
      },
    );
    expect(result).toEqual({ percent: 37, totalBytes: null });
  });
});

describe("QUICK_PRESETS", () => {
  const apply = (id: string) => {
    const preset = QUICK_PRESETS.find((p) => p.id === id);
    if (!preset) throw new Error(`ön ayar yok: ${id}`);
    return preset.apply({
      ...defaultDownloadOptions(),
      formatId: "137",
      platformTargets: ["youtube"],
    });
  };

  test("Discord ön ayarı 10 MB altı sıkıştırılmış kopya ister", () => {
    const options = apply("discord");
    expect(options).toMatchObject({
      outputFormat: "mp4",
      maxHeight: 720,
      shrink: true,
      shrinkTargetMb: 9.5,
    });
    expect(options.shrinkTargetMb).toBeLessThan(10);
  });

  test("MP3 ön ayarı gelişmiş seçimi ve platform hedeflerini temizler", () => {
    expect(apply("mp3")).toMatchObject({
      outputFormat: "mp3",
      formatId: null,
      platformTargets: [],
    });
  });

  test("TikTok ön ayarı dikey kopya zinciri üretir", () => {
    const steps = buildChainSteps(apply("tiktok"));
    expect(steps[0]).toMatchObject({ kind: "resize", targetWidth: 1080, targetHeight: 1920 });
  });

  test("her ön ayar gelişmiş format seçimini sıfırlar", () => {
    for (const preset of QUICK_PRESETS) {
      expect(apply(preset.id).formatId).toBeNull();
    }
  });
});

describe("findDuplicateDownload", () => {
  const url = "https://youtu.be/abc";
  const job = (status: Job["status"], options = defaultDownloadOptions()): Job =>
    ({
      id: status,
      kind: "download",
      status,
      request: { kind: "download", url, destinationDir: "C:/x", options, needsAnalyze: false },
    }) as Job;

  test("aynı link aynı ayarla sıradaysa tekrar eklenmez", () => {
    expect(findDuplicateDownload([job("running")], url, defaultDownloadOptions())).not.toBeNull();
    expect(findDuplicateDownload([job("queued")], url, defaultDownloadOptions())).not.toBeNull();
  });

  test("biten ya da başarısız iş tekrar indirmeyi engellemez", () => {
    const jobs = [job("done"), job("error"), job("canceled")];
    expect(findDuplicateDownload(jobs, url, defaultDownloadOptions())).toBeNull();
  });

  test("aynı videonun farklı formatı ayrı iş sayılır", () => {
    const mp3 = { ...defaultDownloadOptions(), outputFormat: "mp3" as const };
    expect(findDuplicateDownload([job("running")], url, mp3)).toBeNull();
  });

  test("platform hedeflerinin sırası önemli değildir", () => {
    const a = { ...defaultDownloadOptions(), platformTargets: ["tiktok", "youtube"] };
    const b = { ...defaultDownloadOptions(), platformTargets: ["youtube", "tiktok"] };
    expect(findDuplicateDownload([job("running", a)], url, b)).not.toBeNull();
  });
});

describe("bölüm indirme", () => {
  test("tahmini boyut seçilen bölümün oranıdır", () => {
    // 100 sn'lik videonun 25 sn'si → 300 MB'ın dörtte biri.
    const options = { ...defaultDownloadOptions(), section: { start: 50, end: 75 } };
    expect(estimateDownloadSize(metadata(), options)).toBe(75 * MB);
  });

  test("aynı videonun farklı bölümleri ayrı iş sayılır", () => {
    const url = "https://youtu.be/abc";
    const first = { ...defaultDownloadOptions(), section: { start: 0, end: 30 } };
    const running = {
      id: "j",
      kind: "download",
      status: "running",
      request: {
        kind: "download",
        url,
        destinationDir: "C:/x",
        options: first,
        needsAnalyze: false,
      },
    } as Job;
    const second = { ...defaultDownloadOptions(), section: { start: 30, end: 60 } };
    expect(findDuplicateDownload([running], url, second)).toBeNull();
    expect(findDuplicateDownload([running], url, first)).not.toBeNull();
  });
});
