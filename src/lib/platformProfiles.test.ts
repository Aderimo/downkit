import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROFILES,
  parseProfiles,
  refreshProfiles,
  usePlatformProfiles,
} from "./platformProfiles";

describe("platform profilleri", () => {
  it("geçersiz alanlar ve kayıtlar atılır", () => {
    expect(
      parseProfiles({
        profiles: [
          { id: "reels", name: "Kısa video", patch: { frame: "9:16", loudness: true, evil: 1 } },
          { id: "Bad Id", patch: { frame: "9:16" } },
          { id: "x", patch: { frame: "21:9" } },
          { id: "mail", patch: { targetSizeMb: 25 } },
        ],
      }),
    ).toEqual([
      { id: "reels", name: "Kısa video", patch: { frame: "9:16", loudness: true } },
      { id: "mail", patch: { targetSizeMb: 25 } },
    ]);
    expect(parseProfiles({ profiles: [] })).toBeNull();
    expect(parseProfiles("x")).toBeNull();
  });

  it("varsayılanlar geçerli; uzak liste bozuksa eldeki kalır, geçerliyse kullanılır", async () => {
    expect(parseProfiles({ profiles: DEFAULT_PROFILES })).toEqual(DEFAULT_PROFILES);
    const ok = (body: unknown) =>
      (async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch;
    await refreshProfiles(ok({ profiles: [{ id: "new", patch: { frame: "1:1" } }] }));
    expect(usePlatformProfiles.getState().profiles.map((p) => p.id)).toEqual(["new"]);
  });
});
