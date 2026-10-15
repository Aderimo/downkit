import { useEffect, useRef } from "react";
import { Music } from "lucide-react";
import type { PlayerApi } from "../../store/playerStore";

export interface PlayableStream {
  kind: "file" | "split";
  url: string;
  audioUrl: string | null;
  hasVideo: boolean;
  /** Önizleme oturumu kimliği; aynı adres yeniden açıldığında bile kaynağın
   * baştan bağlanması için bağlama etkeninin bağımlılıklarına girer. */
  token?: string;
}

interface MediaPlayerProps {
  stream: PlayableStream;
  poster?: string | null;
  /** Tarayıcının kendi denetimleri (önizleme penceresi); düzenleyici kendi
   * denetimlerini çizer. */
  nativeControls?: boolean;
  autoPlay?: boolean;
  className?: string;
  onApi?: (api: PlayerApi | null) => void;
  onTime?: (seconds: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  onWaitingChange?: (waiting: boolean) => void;
  onError?: () => void;
}

// Ayrı ses öğesi görüntüden bu kadar saparsa yeniden hizalanır (saniye).
const SPLIT_DRIFT = 0.25;

/** Dosyadan gelen akışı oynatır:
 * - "file": tek dosya (`<video src>`)
 * - "split": sessiz görüntü + ayrı ses dosyası, eşzamanlı tutulur */
export function MediaPlayer({
  stream,
  poster,
  nativeControls = false,
  autoPlay = false,
  className = "",
  onApi,
  onTime,
  onPlayingChange,
  onWaitingChange,
  onError,
}: MediaPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  // Geri çağrılar her render'da değişebilir; efektler yeniden kurulmasın diye ref'te tutulur.
  const callbacks = useRef({ onApi, onTime, onPlayingChange, onWaitingChange, onError });
  useEffect(() => {
    callbacks.current = { onApi, onTime, onPlayingChange, onWaitingChange, onError };
  });

  const split = stream.kind === "split" && stream.audioUrl !== null;

  // Kaynağı bağla.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.src = stream.url;
    return () => {
      video.removeAttribute("src");
      video.load();
    };
  }, [stream.kind, stream.url, stream.token]);

  // Ayrı ses: görüntünün her hareketini izler.
  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!split || !video || !audio) return;
    const align = () => {
      if (Math.abs(audio.currentTime - video.currentTime) > SPLIT_DRIFT) {
        audio.currentTime = video.currentTime;
      }
    };
    const play = () => {
      align();
      void audio.play().catch(() => {});
    };
    const pause = () => audio.pause();
    const seeking = () => {
      audio.currentTime = video.currentTime;
    };
    const rate = () => {
      audio.playbackRate = video.playbackRate;
    };
    const handlers: [string, () => void][] = [
      ["play", play],
      ["playing", play],
      ["pause", pause],
      ["waiting", pause],
      ["seeking", seeking],
      ["ratechange", rate],
      ["timeupdate", align],
    ];
    handlers.forEach(([name, fn]) => video.addEventListener(name, fn));
    return () => handlers.forEach(([name, fn]) => video.removeEventListener(name, fn));
  }, [split, stream.audioUrl]);

  // Dışarıdan kullanılacak komutlar ve akıcı zaman bildirimi.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const soundTarget = (): HTMLMediaElement => (split && audioRef.current) || video;
    const api: PlayerApi = {
      seek: (seconds) => {
        video.currentTime = Math.max(0, seconds);
      },
      play: () => void video.play().catch(() => {}),
      pause: () => video.pause(),
      toggle: () => (video.paused ? void video.play().catch(() => {}) : video.pause()),
      setRate: (value) => {
        video.playbackRate = value;
      },
      setVolume: (value) => {
        soundTarget().volume = Math.min(1, Math.max(0, value));
      },
      setMuted: (value) => {
        soundTarget().muted = value;
      },
      getTime: () => video.currentTime,
    };
    callbacks.current.onApi?.(api);

    let frame = 0;
    const tick = () => {
      callbacks.current.onTime?.(video.currentTime);
      frame = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      callbacks.current.onPlayingChange?.(true);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    };
    const onPause = () => {
      callbacks.current.onPlayingChange?.(false);
      cancelAnimationFrame(frame);
      callbacks.current.onTime?.(video.currentTime);
    };
    const onSeeked = () => callbacks.current.onTime?.(video.currentTime);
    const onWaiting = () => callbacks.current.onWaitingChange?.(true);
    const onReady = () => callbacks.current.onWaitingChange?.(false);
    const onError = () => callbacks.current.onError?.();
    const handlers: [string, () => void][] = [
      ["play", onPlay],
      ["pause", onPause],
      ["ended", onPause],
      ["seeked", onSeeked],
      ["timeupdate", onSeeked],
      ["waiting", onWaiting],
      ["playing", onReady],
      ["canplay", onReady],
      ["error", onError],
    ];
    handlers.forEach(([name, fn]) => video.addEventListener(name, fn));
    return () => {
      cancelAnimationFrame(frame);
      handlers.forEach(([name, fn]) => video.removeEventListener(name, fn));
      // Kaldırılırken "pause" olayı düşmeyebilir; durum bayrakları doğru kalsın
      // (aksi hâlde oynatma düğmesi bir daha çalışmaz hâle gelebiliyor).
      callbacks.current.onPlayingChange?.(false);
      callbacks.current.onWaitingChange?.(false);
      callbacks.current.onApi?.(null);
    };
  }, [split]);

  return (
    <div className={`relative bg-black ${className}`}>
      <video
        ref={videoRef}
        poster={poster ?? undefined}
        controls={nativeControls}
        autoPlay={autoPlay}
        muted={split}
        playsInline
        // Önizleme sunucusu çapraz köken izni verir: kare tuvale çizilip okunabilsin
        // (renk kapsamları, damlalık).
        crossOrigin="anonymous"
        preload="metadata"
        className="h-full w-full object-contain"
      />
      {split ? <audio ref={audioRef} src={stream.audioUrl ?? undefined} preload="auto" /> : null}
      {!stream.hasVideo && !poster ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[var(--dk-text-muted)]">
          <Music size={56} />
        </div>
      ) : null}
    </div>
  );
}
