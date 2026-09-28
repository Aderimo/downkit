import { afterEach, describe, expect, it, vi } from "vitest";
import { BASELINE_DOWNLOADS, COUNTER_URL, fetchActiveUsers, fetchDownloadStats } from "./counter";

const releases = (data: unknown, ok = true, status = 200) =>
  ({ ok, status, json: () => Promise.resolve(data) }) as Response;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchDownloadStats", () => {
  it("tüm release dosyalarını toplar ve baseline'ı ekler", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        releases([
          { tag_name: "v0.3.0", assets: [{ download_count: 10 }, { download_count: 5 }] },
          { tag_name: "v0.2.1", assets: [{ download_count: 3 }] },
        ]),
      ),
    );
    const stats = await fetchDownloadStats();
    expect(stats.total).toBe(BASELINE_DOWNLOADS + 18);
    expect(stats.perRelease).toEqual([
      { tag: "v0.3.0", count: 15 },
      { tag: "v0.2.1", count: 3 },
    ]);
  });

  it("hiç release yoksa yalnızca baseline döner", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(releases([])));
    const stats = await fetchDownloadStats();
    expect(stats.total).toBe(BASELINE_DOWNLOADS);
    expect(stats.perRelease).toEqual([]);
  });

  it("GitHub hatasında fırlatır", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(releases({}, false, 403)));
    await expect(fetchDownloadStats()).rejects.toThrow("403");
  });
});

describe("fetchActiveUsers", () => {
  it("sayaç sunucusu kurulu değilse hiç istek atmadan null döner", async () => {
    expect(COUNTER_URL).toBe("");
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await expect(fetchActiveUsers()).resolves.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});
