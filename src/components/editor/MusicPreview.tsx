import { useEffect, useRef } from "react";
import { useEditorStore } from "../../store/editorStore";
import { usePlayerStore } from "../../store/playerStore";
import { ensureMediaUrl, useLayerMedia } from "../../lib/layerActions";
import { envelopeAt, musicLane, type MusicItem } from "../../lib/layers";
import { audioLaneAudible } from "../../lib/sequence";

/** Önizlemede müzik izleri: zaman çizelgesiyle eşzamanlı çalan gizli ses öğeleri.
 * Ses düzeyi ve açılma/kararma dışa aktarımdakiyle aynı (tarayıcı %100'ü aşamaz). */
export function MusicPreview() {
  const music = useEditorStore((s) => s.music);
  const urls = useLayerMedia((s) => s.urls);
  useEffect(() => {
    for (const m of music) ensureMediaUrl(m.path, "music");
  }, [music]);
  return (
    <>
      {music.map((m) =>
        urls[m.path] ? <MusicAudio key={m.id} item={m} url={urls[m.path]} /> : null,
      )}
    </>
  );
}

function MusicAudio({ item, url }: { item: MusicItem; url: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const element = ref.current;
    const sync = () => {
      const audio = element;
      if (!audio) return;
      const s = usePlayerStore.getState();
      const t = s.currentTime;
      const local = t - item.start;
      const inside = local >= 0 && local < item.length;
      const want = item.srcStart + local;
      if (!inside || !(s.playing || s.gapPlaying)) {
        if (!audio.paused) audio.pause();
        if (inside && Math.abs(audio.currentTime - want) > 0.3) audio.currentTime = want;
        return;
      }
      if (Math.abs(audio.currentTime - want) > 0.3) audio.currentTime = want;
      const fade = Math.min(
        1,
        item.fadeIn > 0 ? local / item.fadeIn : 1,
        item.fadeOut > 0 ? (item.length - local) / item.fadeOut : 1,
      );
      const audible = audioLaneAudible(useEditorStore.getState().tracks, musicLane(item));
      const envelope = envelopeAt(item.envelope, local);
      audio.volume =
        s.muted || !audible
          ? 0
          : Math.max(0, Math.min(1, item.volume * envelope * fade * s.volume));
      audio.playbackRate = Math.min(4, Math.max(0.25, s.rate));
      if (audio.paused) void audio.play().catch(() => {});
    };
    sync();
    const unsubscribe = usePlayerStore.subscribe(sync);
    // İz sessize alınınca / yalnız dinlenince ses hemen değişsin.
    const unsubscribeTracks = useEditorStore.subscribe((state, previous) => {
      if (state.tracks !== previous.tracks) sync();
    });
    return () => {
      unsubscribe();
      unsubscribeTracks();
      element?.pause();
    };
  }, [item]);
  return <audio ref={ref} src={url} preload="auto" />;
}
