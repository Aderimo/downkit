import { beforeAll, describe, expect, test } from "vitest";
import i18n from "../i18n";
import { DEFAULT_SETTINGS, normalizeSettings } from "./appSettings";
import { restoreJobs } from "./jobPersistence";
import { localizeError } from "./errors";
import { hasPlaylistParam } from "./workspaceActions";
import type { Job } from "../types/jobs";

describe("normalizeSettings", () => {
  test("boş kayıt varsayılanlara döner", () => {
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  test("eski sürümün kaydı yeni alanlarla tamamlanır", () => {
    const old = {
      concurrency: 3,
      filenameTemplate: "{uploader} - {title}",
      clipboardSuggest: false,
    };
    const s = normalizeSettings(old);
    expect(s).toMatchObject(old);
    expect(s.subtitleLangs).toEqual(["tr", "en"]);
    expect(s.autoUpdateYtdlp).toBe(true);
  });

  test("bozuk ya da tanınmayan değerler varsayılana düşer", () => {
    const s = normalizeSettings({
      concurrency: 99,
      filenameTemplate: "{rm -rf}",
      defaultOutputFormat: "exe",
      defaultMaxHeight: 1234,
      rateLimitKbps: -5,
      subtitleLangs: ["xx", 5, "de"],
      keepHistory: "evet",
    });
    expect(s.concurrency).toBe(DEFAULT_SETTINGS.concurrency);
    expect(s.filenameTemplate).toBe("{title}");
    expect(s.defaultOutputFormat).toBe("mp4");
    expect(s.defaultMaxHeight).toBeNull();
    expect(s.rateLimitKbps).toBeNull();
    expect(s.subtitleLangs).toEqual(["de"]);
    expect(s.keepHistory).toBe(true);
  });

  test("pencere kapatma davranışı yalnızca bilinen değerleri kabul eder", () => {
    expect(normalizeSettings({ closeBehavior: "always" }).closeBehavior).toBe("always");
    expect(normalizeSettings({ closeBehavior: "patla" }).closeBehavior).toBe("whileBusy");
    expect(normalizeSettings({}).groupByPlatform).toBe(true);
    expect(normalizeSettings({}).checkUpdates).toBe(true);
  });

  test("hiç geçerli altyazı dili kalmazsa varsayılanlar kullanılır", () => {
    expect(normalizeSettings({ subtitleLangs: [] }).subtitleLangs).toEqual(["tr", "en"]);
  });

  test("ilk sürümün ayrı kaydettiği klasör okunur", () => {
    expect(normalizeSettings({}, "C:\\Videolar").defaultDownloadDir).toBe("C:\\Videolar");
    expect(
      normalizeSettings({ defaultDownloadDir: "D:\\Yeni" }, "C:\\Eski").defaultDownloadDir,
    ).toBe("D:\\Yeni");
  });
});

describe("restoreJobs", () => {
  const job = (status: Job["status"], extra: Partial<Job> = {}): Job =>
    ({
      id: status,
      kind: "download",
      status,
      title: "Video",
      backendJobId: "eski-kimlik",
      speedBps: 1000,
      etaSeconds: 5,
      stageKey: "jobs.stageVideo",
      outputs: [],
      pendingSteps: [],
      request: { kind: "download", url: "https://youtu.be/a", destinationDir: "C:/x", options: {} },
      ...extra,
    }) as unknown as Job;

  test("yarıda kalan indirme duraklatılmış olarak geri gelir", () => {
    const [restored] = restoreJobs([job("running")], "yarıda kaldı");
    expect(restored.status).toBe("paused");
    expect(restored.backendJobId).toBeNull();
    expect(restored.speedBps).toBeNull();
    expect(restored.stageKey).toBeNull();
  });

  test("sıradaki iş kendiliğinden başlamaz, duraklatılır", () => {
    expect(restoreJobs([job("queued")], "")[0].status).toBe("paused");
  });

  test("zincir adımı yarıda kalan iş başarısız sayılır", () => {
    const [restored] = restoreJobs([job("postprocessing")], "yarıda kaldı");
    expect(restored.status).toBe("error");
    expect(restored.errorMessage).toBe("yarıda kaldı");
  });

  test("biten işler olduğu gibi kalır, bozuk kayıtlar atılır", () => {
    const restored = restoreJobs([job("done"), { id: 1 }, null, "metin"], "");
    expect(restored).toHaveLength(1);
    expect(restored[0].status).toBe("done");
  });

  test("dizi olmayan kayıt boş liste döner", () => {
    expect(restoreJobs({ jobs: [] }, "")).toEqual([]);
  });
});

describe("localizeError", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  test("tanınan kod seçili dilde gösterilir", () => {
    const e = localizeError(
      { message: "Diskte yeterli boş alan yok.", code: "diskFull", detail: "Errno 28" },
      "error.downloadFailed",
    );
    expect(e.message).toBe(i18n.t("backendError.diskFull"));
    expect(e.message).not.toContain("Diskte");
    expect(e.detail).toBe("Errno 28");
  });

  test("çevirisi olmayan kodda arka ucun mesajı kullanılır", () => {
    const e = localizeError(
      { message: "Özel mesaj", code: "bilinmeyenKod" },
      "error.downloadFailed",
    );
    expect(e.message).toBe("Özel mesaj");
  });

  test("mesaj da yoksa yedek anahtar kullanılır", () => {
    expect(localizeError({}, "error.downloadFailed").message).toBe(i18n.t("error.downloadFailed"));
  });

  test("düz metin hata olduğu gibi gösterilir ve olay yükündeki ham ayrıntı alınır", () => {
    expect(localizeError("çöktü", "error.downloadFailed")).toEqual({
      message: "çöktü",
      detail: null,
    });
    expect(localizeError({ message: "x", rawDetail: "iz" }, "error.downloadFailed").detail).toBe(
      "iz",
    );
  });
});

describe("hasPlaylistParam", () => {
  test("hem videoya hem listeye işaret eden YouTube linki tanınır", () => {
    expect(hasPlaylistParam("https://www.youtube.com/watch?v=abc&list=PL123")).toBe(true);
    expect(hasPlaylistParam("https://music.youtube.com/watch?v=abc&list=OLAK5")).toBe(true);
  });

  test("otomatik karışım listeleri (RD…) önerilmez", () => {
    expect(hasPlaylistParam("https://www.youtube.com/watch?v=abc&list=RDabc")).toBe(false);
  });

  test("yalnızca video ya da yalnızca liste linki için false", () => {
    expect(hasPlaylistParam("https://www.youtube.com/watch?v=abc")).toBe(false);
    expect(hasPlaylistParam("https://www.youtube.com/playlist?list=PL123")).toBe(false);
    expect(hasPlaylistParam("https://vimeo.com/123?list=PL1")).toBe(false);
    expect(hasPlaylistParam("link değil")).toBe(false);
  });
});
