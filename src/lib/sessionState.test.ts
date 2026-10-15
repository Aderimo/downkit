import { beforeAll, describe, expect, test } from "vitest";
import i18n from "../i18n";
import { DEFAULT_SETTINGS, normalizeSettings } from "./appSettings";
import { restoreJobs } from "./jobPersistence";
import { localizeError } from "./errors";
import type { Job } from "../types/jobs";

describe("normalizeSettings", () => {
  test("boş kayıt varsayılanlara döner", () => {
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  test("eski DownKit kaydındaki indirme ayarları geri okunur", () => {
    const s = normalizeSettings({
      concurrency: 3,
      filenameTemplate: "{uploader} - {title}",
      theme: "graphite",
      notifyOnComplete: false,
    });
    expect(s.concurrency).toBe(3);
    expect(s.filenameTemplate).toBe("{uploader} - {title}");
    expect(normalizeSettings({ concurrency: 99 }).concurrency).toBe(DEFAULT_SETTINGS.concurrency);
    expect(s.theme).toBe("graphite");
    expect(s.notifyOnComplete).toBe(false);
  });

  test("bozuk ya da tanınmayan değerler varsayılana düşer", () => {
    const s = normalizeSettings({ notifyOnComplete: "evet", theme: "yok-boyle-tema" });
    expect(s.notifyOnComplete).toBe(true);
    expect(s.theme).toBe(DEFAULT_SETTINGS.theme);
  });

  test("pencere kapatma davranışı yalnızca bilinen değerleri kabul eder", () => {
    expect(normalizeSettings({ closeBehavior: "always" }).closeBehavior).toBe("always");
    expect(normalizeSettings({ closeBehavior: "patla" }).closeBehavior).toBe("whileBusy");
    expect(normalizeSettings({}).checkUpdates).toBe(true);
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
      kind: "edit",
      status,
      title: "Video",
      backendJobId: "eski-kimlik",
      speedBps: 1000,
      etaSeconds: 5,
      stageKey: "jobs.stageVideo",
      outputs: [],
      request: {
        kind: "edit",
        inputPath: "C:/a.mp4",
        url: null,
        clips: [],
        destinationDir: "C:/x",
      },
      ...extra,
    }) as unknown as Job;

  test("yarıda kalan dışa aktarım duraklatılmış olarak geri gelir", () => {
    const [restored] = restoreJobs([job("running")], "yarıda kaldı");
    expect(restored.status).toBe("paused");
    expect(restored.backendJobId).toBeNull();
    expect(restored.speedBps).toBeNull();
    expect(restored.stageKey).toBeNull();
  });

  test("sıradaki iş kendiliğinden başlamaz, duraklatılır", () => {
    expect(restoreJobs([job("queued")], "")[0].status).toBe("paused");
  });

  test("biten işler olduğu gibi kalır, bozuk kayıtlar atılır", () => {
    const oldDownload = { ...job("done"), kind: "download" };
    const restored = restoreJobs([job("done"), oldDownload, { id: 1 }, null, "metin"], "");
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
