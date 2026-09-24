import type { SupportedPlatform } from "../types/media";

export const PLATFORM_LABEL: Record<SupportedPlatform, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  x: "X",
  reddit: "Reddit",
  facebook: "Facebook",
  twitch: "Twitch",
  kick: "Kick",
  vimeo: "Vimeo",
  dailymotion: "Dailymotion",
  pinterest: "Pinterest",
};

export function isSupportedPlatform(value: string | null | undefined): value is SupportedPlatform {
  return !!value && value in PLATFORM_LABEL;
}
