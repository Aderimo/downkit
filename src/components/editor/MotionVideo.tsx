import { useEffect, useRef, type CSSProperties } from "react";
import { usePlayerStore } from "../../store/playerStore";
import type { ImageItem } from "../../lib/layers";

/** Önizlemede hareketli başlık: saydam videoyu oynatma çizgisine bağlı oynatır. */
export function MotionVideo({
  item,
  url,
  style,
}: {
  item: ImageItem;
  url: string;
  style: CSSProperties;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const time = usePlayerStore((s) => s.currentTime);
  const playing = usePlayerStore((s) => s.playing);
  const rate = usePlayerStore((s) => s.rate);
  const local = Math.max(0, time - item.start);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.playbackRate = rate;
    if (playing) {
      // Oynarken yalnız belirgin kaymada sarılır (her karede sarmak takılır).
      if (Math.abs(video.currentTime - local) > 0.25) video.currentTime = local;
      if (video.paused) void video.play().catch(() => {});
    } else {
      video.pause();
      if (Math.abs(video.currentTime - local) > 0.01) video.currentTime = local;
    }
  }, [local, playing, rate]);

  return (
    <video
      ref={ref}
      src={url}
      muted
      playsInline
      preload="auto"
      data-motion-title={item.motion?.template ?? ""}
      className="pointer-events-none absolute"
      style={style}
    />
  );
}
