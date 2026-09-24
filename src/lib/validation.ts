import type { SupportedPlatform } from "../types/media";

const PLATFORM_HOSTS: Record<SupportedPlatform, string[]> = {
  youtube: ["youtube.com", "youtu.be"],
  tiktok: ["tiktok.com"],
  instagram: ["instagram.com"],
  x: ["x.com", "twitter.com"],
  reddit: ["reddit.com"],
  facebook: ["facebook.com", "fb.watch"],
  twitch: ["twitch.tv"],
  kick: ["kick.com"],
  vimeo: ["vimeo.com"],
  dailymotion: ["dailymotion.com"],
  pinterest: ["pinterest.com", "pin.it"],
};

export type UrlCheckResult =
  | { status: "empty" }
  | { status: "invalid" }
  | { status: "unsupported" }
  | { status: "ok"; platform: SupportedPlatform };

function hostMatches(hostname: string, allowed: string): boolean {
  return hostname === allowed || hostname.endsWith(`.${allowed}`);
}

// UX amaçlı hızlı ön-kontrol; gerçek doğruluk kaynağı yt-dlp'nin kendisidir.
export function checkSupportedUrl(rawUrl: string): UrlCheckResult {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) {
    return { status: "empty" };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { status: "invalid" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { status: "invalid" };
  }

  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");

  for (const [platform, hosts] of Object.entries(PLATFORM_HOSTS) as [
    SupportedPlatform,
    string[],
  ][]) {
    if (hosts.some((host) => hostMatches(hostname, host))) {
      return { status: "ok", platform };
    }
  }

  return { status: "unsupported" };
}

export const MEDIA_EXTENSIONS = [
  "mp4",
  "webm",
  "mkv",
  "mov",
  "avi",
  "mp3",
  "m4a",
  "wav",
  "flac",
  "aac",
  "ogg",
];

export function isMediaPath(path: string): boolean {
  const ext = /\.([^.\\/]+)$/.exec(path)?.[1]?.toLowerCase();
  return ext !== undefined && MEDIA_EXTENSIONS.includes(ext);
}
