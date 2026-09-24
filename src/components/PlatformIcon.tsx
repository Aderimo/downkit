import {
  siDailymotion,
  siFacebook,
  siInstagram,
  siKick,
  siPinterest,
  siReddit,
  siTiktok,
  siTwitch,
  siVimeo,
  siX,
  siYoutube,
  type SimpleIcon,
} from "simple-icons";
import type { SupportedPlatform } from "../types/media";

// Marka ikonları simple-icons'tan (CC0); platformu tanıtmak için kullanılır.
const ICONS: Record<
  SupportedPlatform,
  { icon: SimpleIcon; background: string; foreground?: string }
> = {
  youtube: { icon: siYoutube, background: "#FF0000" },
  tiktok: { icon: siTiktok, background: "#000000" },
  instagram: {
    icon: siInstagram,
    background: "linear-gradient(45deg,#f9ce34,#ee2a7b 55%,#6228d7)",
  },
  x: { icon: siX, background: "#000000" },
  reddit: { icon: siReddit, background: "#FF4500" },
  facebook: { icon: siFacebook, background: "#0866FF" },
  twitch: { icon: siTwitch, background: "#9146FF" },
  // Kick'in yeşili açık; üstünde beyaz okunmuyor, markadaki gibi siyah logo.
  kick: { icon: siKick, background: "#53FC19", foreground: "#000000" },
  vimeo: { icon: siVimeo, background: "#1AB7EA" },
  dailymotion: { icon: siDailymotion, background: "#0A0A0A" },
  pinterest: { icon: siPinterest, background: "#BD081C" },
};

interface PlatformIconProps {
  platform: SupportedPlatform;
  size?: number;
}

export function PlatformIcon({ platform, size = 32 }: PlatformIconProps) {
  const { icon, background, foreground = "white" } = ICONS[platform];
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-lg"
      style={{ background, width: size, height: size }}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" width={size * 0.58} height={size * 0.58} fill={foreground}>
        <path d={icon.path} />
      </svg>
    </span>
  );
}
