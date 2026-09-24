import { useId } from "react";

/** DownKit ikonu ("Gece mavisi" lastik ördek). Kaynak: `branding/icon.svg`;
 * uygulama/kurulum ikonları oradan `pnpm tauri icon` ile üretilir. */
export function BrandMark({ size = 44, className = "" }: { size?: number; className?: string }) {
  // Aynı sayfada birden çok logo olabilir; SVG kimlikleri çakışmasın.
  // useId "«r0»" / ":r0:" gibi değerler verir; url(#…) içinde sorun çıkmasın diye sadeleştirilir.
  const id = `dk-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const clip = `${id}-tile`;
  const water = `${id}-water`;
  return (
    <svg viewBox="0 0 1024 1024" width={size} height={size} className={className} aria-hidden>
      <defs>
        <clipPath id={clip}>
          <rect x="32" y="32" width="960" height="960" rx="232" />
        </clipPath>
        <linearGradient id={water} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#4f7bff" />
          <stop offset="1" stopColor="#7c5cff" />
        </linearGradient>
      </defs>
      <rect x="32" y="32" width="960" height="960" rx="232" fill="#0f1433" />
      <g clipPath={`url(#${clip})`}>
        <path
          d="M250 560 C240 500 250 450 300 430 C330 470 360 500 420 510 L600 510 C700 510 800 560 800 650 C800 740 700 790 540 790 L400 790 C300 790 240 720 250 560 Z"
          fill="#FFD43B"
        />
        <circle cx="620" cy="390" r="150" fill="#FFD43B" />
        <path d="M752 382 C820 370 884 396 874 432 C864 464 800 472 746 454 Z" fill="#FF7A1A" />
        <circle cx="662" cy="350" r="28" fill="#141a44" />
        <circle cx="672" cy="340" r="9" fill="#ffffff" />
        <path
          d="M455 548 H545 V598 H600 L500 664 L400 598 H455 Z"
          fill="#F4A61D"
          stroke="#F4A61D"
          strokeWidth="26"
          strokeLinejoin="round"
        />
        <path
          d="M32 712 C140 672 240 752 350 712 C460 672 560 752 670 712 C780 672 880 752 992 712 V992 H32 Z"
          fill={`url(#${water})`}
        />
      </g>
    </svg>
  );
}
