import { describe, expect, test } from "vitest";
import { checkSupportedUrl } from "./validation";

describe("checkSupportedUrl", () => {
  test("boş girdi empty döner", () => {
    expect(checkSupportedUrl("")).toEqual({ status: "empty" });
    expect(checkSupportedUrl("   ")).toEqual({ status: "empty" });
  });

  test("geçersiz URL invalid döner", () => {
    expect(checkSupportedUrl("bu bir link değil")).toEqual({ status: "invalid" });
    expect(checkSupportedUrl("ftp://example.com/video")).toEqual({ status: "invalid" });
  });

  test("desteklenmeyen platform linki reddedilir", () => {
    expect(checkSupportedUrl("https://example.com/video")).toEqual({ status: "unsupported" });
  });

  test("YouTube linkleri (www ve kısa link dahil) tanınır", () => {
    expect(checkSupportedUrl("https://www.youtube.com/watch?v=abc123")).toEqual({
      status: "ok",
      platform: "youtube",
    });
    expect(checkSupportedUrl("https://youtu.be/abc123")).toEqual({
      status: "ok",
      platform: "youtube",
    });
  });

  test("TikTok, Instagram, X, Reddit linkleri tanınır", () => {
    expect(checkSupportedUrl("https://www.tiktok.com/@user/video/123")).toEqual({
      status: "ok",
      platform: "tiktok",
    });
    expect(checkSupportedUrl("https://www.instagram.com/reel/abc")).toEqual({
      status: "ok",
      platform: "instagram",
    });
    expect(checkSupportedUrl("https://x.com/user/status/123")).toEqual({
      status: "ok",
      platform: "x",
    });
    expect(checkSupportedUrl("https://old.reddit.com/r/videos/abc")).toEqual({
      status: "ok",
      platform: "reddit",
    });
  });

  test("Kick yayın, klip ve VOD linkleri tanınır", () => {
    for (const url of [
      "https://kick.com/xqc",
      "https://kick.com/xqc/clips/clip_01ABC",
      "https://kick.com/xqc/videos/9f1c-4b2a",
    ]) {
      expect(checkSupportedUrl(url)).toEqual({ status: "ok", platform: "kick" });
    }
    expect(checkSupportedUrl("https://notkick.com/x")).toEqual({ status: "unsupported" });
  });

  test("benzer ama farklı bir domain yanlışlıkla eşleşmez", () => {
    expect(checkSupportedUrl("https://notyoutube.com/watch?v=abc")).toEqual({
      status: "unsupported",
    });
  });
});
