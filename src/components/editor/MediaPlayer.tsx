import { useEffect, useRef } from "react";
import type Hls from "hls.js";
import { Music } from "lucide-react";
import type { PlayerApi } from "../../store/playerStore";

export interface PlayableStream {
  kind: "file" | "hls" | "split";
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

// Geçici ağ hatasında hls.js birkaç kez yeniden denenir; sonra önizleme "açılamadı" olur.
const HLS_MAX_RETRIES = 3;
const PREVIEW_MAX_HEIGHT = 720;
// Ayrı ses öğesi görüntüden bu kadar saparsa yeniden hizalanır (saniye).
const SPLIT_DRIFT = 0.25;

/** Linkten ya da dosyadan gelen akışı oynatır:
 * - "file": tek dosya (`<video src>`)
 * - "hls": HLS listesi, hls.js ile (WebView2 HLS'i kendisi oynatamıyor)
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

  // Kaynağı bağla (HLS ise hls.js'i yalnızca gerektiğinde yükle).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let hls: Hls | null = null;
    let cancelled = false;

    // Chromium (WebView2 dahil) artık HLS için canPlayType "maybe" diyor ama
    // YouTube'un ayrı ses/görüntü akışlı listelerini oynatamıyor; MSE varsa her
    // zaman hls.js kullanılır, yerel HLS yalnızca son çaredir.
    if (stream.kind === "hls") {
      void import("hls.js").then(({ default: HlsClass }) => {
        if (cancelled) return;
        if (!HlsClass.isSupported()) {
          if (video.canPlayType("application/vnd.apple.mpegurl")) video.src = stream.url;
          else callbacks.current.onError?.();
          return;
        }
        let retries = 0;
        const instance = new HlsClass({
          // Oynatıcı boyutundan büyük çözünürlük indirilmez: önizleme hızlı açılır.
          capLevelToPlayerSize: true,
          maxBufferLength: 30,
        });
        instance.on(HlsClass.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          if (data.type === HlsClass.ErrorTypes.NETWORK_ERROR && retries < HLS_MAX_RETRIES) {
            retries += 1;
            instance.startLoad();
          } else if (data.type === HlsClass.ErrorTypes.MEDIA_ERROR && retries < HLS_MAX_RETRIES) {
            retries += 1;
            instance.recoverMediaError();
          } else {
            callbacks.current.onError?.();
          }
        });
        // Önizleme için 720p yeter; 4K listelerde gereksiz bant/işlemci harcanmasın.
        instance.on(HlsClass.Events.MANIFEST_PARSED, (_event, data) => {
          const capped = data.levels.reduce(
            (best, level, index) =>
              level.height > 0 && level.height <= PREVIEW_MAX_HEIGHT ? index : best,
            -1,
          );
          if (capped >= 0) instance.autoLevelCapping = capped;
        });
        instance.loadSource(stream.url);
        instance.attachMedia(video);
        hls = instance;
      });
    } else {
      video.src = stream.url;
    }

    return () => {
      cancelled = true;
      hls?.destroy();
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
