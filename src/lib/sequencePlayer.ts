import { useEditorStore } from "../store/editorStore";
import { player, usePlayerStore } from "../store/playerStore";
import {
  flatten,
  nextSegment,
  segmentAt,
  segmentEffects,
  sequenceEnd,
  sourceTimeAt,
  timelineTimeAt,
  type Segment,
  type SeqClip,
  type TrackStates,
} from "./sequence";

// Önizleme oynatıcısı kaynak videoyu oynatır; bu katman onu zaman çizelgesine
// çevirir: parçalar sırayla, kendi hızlarıyla oynar. Klipler arasındaki boşlukta
// ekran kararır ve saat akmaya devam eder (dışa aktarımdaki siyah ekran gibi).
// Oynatma imleci her zaman zaman çizelgesi saniyesidir.

let cachedClips: SeqClip[] | null = null;
let cachedTracks: TrackStates | null = null;
let cachedSegments: Segment[] = [];
let active: Segment | null = null;
let gapFrame = 0;

// Oynatılan parça başka bir kaynağa geçince önizleme öğesi yeniden kurulur;
// yeni oynatıcı hazır olunca bu aramaya ve (oynatma sürüyorsa) oynatmaya geçilir.
let pendingSeek: { token: string; time: number; play: boolean } | null = null;

/** Parçanın kaynağı: açık kimliği, yoksa ilk kaynak. */
function segmentSourceId(segment: Segment): string | null {
  const st = useEditorStore.getState();
  return segment.sourceId ?? st.sources[0]?.id ?? null;
}

/** Parçanın kaynağının oynatılabilir önizleme akışı var mı. Kimi linkte önizleme
 * açılamaz (stream null); o parçalar siyah ekranda saat akışıyla geçilir. */
function isPlayable(segment: Segment): boolean {
  const st = useEditorStore.getState();
  const id = segmentSourceId(segment);
  return id !== null && st.sources.find((s) => s.id === id)?.stream != null;
}

/** Gerekirse önizleme kaynağını parçanın kaynağına çevirir. Geçiş yapıldıysa
 * true döner: arama/oynatma yeni oynatıcı hazır olunca `playerReady`'de yapılır.
 * `time`: yeni oynatıcıda açılacak kaynak anı (verilmezse parçanın başı).
 * Kaynağın akışı yoksa oynatıcı durdurulur (eski video oynamaya devam etmez) ve
 * "önizleme yok" görünür; parça `playDead` ile saat akışıyla geçilir. */
function switchSource(segment: Segment, play: boolean, time?: number): boolean {
  const st = useEditorStore.getState();
  const id = segmentSourceId(segment);
  if (!id) return false;
  const entry = st.sources.find((s) => s.id === id);
  if (!entry?.stream) {
    if (id !== st.activeSourceId) st.activateSource(id);
    player()?.pause();
    pendingSeek = null;
    return false;
  }
  if (id === st.activeSourceId) return false;
  // Eski oynatıcı hemen durdurulur: kaldırılana dek geçen sürede zaman olayı
  // üretip parça-bitişi mantığını ikinci kez tetiklemesin (oynatma donmasının
  // asıl nedeni buydu) ve proxy bağlantısı serbest kalsın.
  player()?.pause();
  pendingSeek = { token: entry.stream.token, time: time ?? segment.srcStart, play };
  st.activateSource(id);
  return true;
}

/** Yeni (yeniden kurulan) önizleme oynatıcısı kullanıma hazır: bekleyen
 * arama/oynatma varsa uygulanır. PlayerArea'daki onApi bunu çağırır. */
export function playerReady() {
  const st = useEditorStore.getState();
  if (!pendingSeek || st.stream?.token !== pendingSeek.token) return;
  const { time, play } = pendingSeek;
  pendingSeek = null;
  const time_line = usePlayerStore.getState().currentTime;
  active = segmentAt(currentSegments(), time_line);
  player()?.seek(time);
  if (active) {
    applyRate(active);
    applyEffects(active, time_line);
  }
  if (play) player()?.play();
}

/** Boşluk oynatmasını durdurur (kullanıcı durdurdu, aradı ya da boşluk bitti). */
function stopGap() {
  if (gapFrame) cancelAnimationFrame(gapFrame);
  gapFrame = 0;
  if (usePlayerStore.getState().gapPlaying) usePlayerStore.getState().patch({ gapPlaying: false });
}

/** Boşlukta oynatma: medya duraklar, ekran siyah kalır, saat önizleme hızıyla
 * akar; sonraki parçaya gelince o parça oynamaya başlar. */
function playGap(from: number, next: Segment) {
  stopGap();
  const media = player();
  media?.pause();
  // Sonraki parçanın başı şimdiden hazırlanır (linkte ara belleğe alınsın);
  // parça başka kaynaktaysa önizleme boşluk sürerken o kaynağa geçer.
  if (!switchSource(next, false) && isPlayable(next)) media?.seek(next.srcStart);
  active = null;
  const state = usePlayerStore.getState();
  state.patch({ currentTime: from, inGap: true, gapPlaying: true });
  applyEffects(null, from);
  let last = performance.now();
  let time = from;
  const tick = (now: number) => {
    const s = usePlayerStore.getState();
    time += ((now - last) / 1000) * s.rate;
    last = now;
    if (s.stopAt !== null && time >= s.stopAt) {
      stopGap();
      s.patch({ currentTime: s.stopAt, stopAt: null });
      return;
    }
    if (time >= next.tStart) {
      gapFrame = 0;
      s.patch({ gapPlaying: false });
      // Önizlemesi olmayan kaynağın parçası: boşluk gibi saat akışıyla geçilir.
      if (!isPlayable(next)) {
        playDead(next, next.tStart);
        return;
      }
      active = next;
      applyEffects(next, next.tStart);
      s.patch({ currentTime: next.tStart, inGap: false });
      // Kaynak geçişi boşlukta başlatıldıysa oynatıcı daha hazır olmamış
      // olabilir; o zaman oynatma `playerReady`de başlar.
      if (pendingSeek) {
        pendingSeek = { ...pendingSeek, play: true };
        return;
      }
      if (switchSource(next, true)) return;
      applyRate(next);
      player()?.seek(next.srcStart);
      player()?.play();
      return;
    }
    s.patch({ currentTime: time });
    gapFrame = requestAnimationFrame(tick);
  };
  gapFrame = requestAnimationFrame(tick);
}

/** Önizlemesi açılamayan kaynağın parçası: "önizleme yok" görünür, saat parçanın
 * kendi hızıyla akar; bitince sonraki parçaya geçilir. */
function playDead(segment: Segment, from: number) {
  stopGap();
  player()?.pause();
  active = segment;
  const state = usePlayerStore.getState();
  state.patch({ currentTime: from, inGap: false, gapPlaying: true });
  applyEffects(segment, from);
  let last = performance.now();
  let time = from;
  const tick = (now: number) => {
    const s = usePlayerStore.getState();
    time += ((now - last) / 1000) * s.rate * segment.speed;
    last = now;
    if (s.stopAt !== null && time >= s.stopAt) {
      stopGap();
      s.patch({ currentTime: s.stopAt, stopAt: null });
      return;
    }
    if (time >= segment.tEnd) {
      gapFrame = 0;
      s.patch({ gapPlaying: false });
      advanceAfter(segment);
      return;
    }
    s.patch({ currentTime: time });
    gapFrame = requestAnimationFrame(tick);
  };
  gapFrame = requestAnimationFrame(tick);
}

/** Parça bitti: sonraki parçaya geç (boşluk, önizlemesiz parça, kaynak değişimi
 * ve bitişik devam durumlarını yönetir); parça yoksa dur. */
function advanceAfter(finished: Segment, sourceTime?: number) {
  const state = usePlayerStore.getState();
  const segments = currentSegments();
  const next = segments[segments.indexOf(finished) + 1];
  if (!next || (state.stopAt !== null && next.tStart >= state.stopAt)) {
    pendingSeek = null;
    player()?.pause();
    state.patch({ currentTime: state.stopAt ?? finished.tEnd, stopAt: null, gapPlaying: false });
    return;
  }
  // Arada boşluk varsa ekran kararır ve saat boşluk boyunca akar.
  if (next.tStart - finished.tEnd > 0.02) {
    playGap(finished.tEnd, next);
    return;
  }
  // Önizlemesi olmayan kaynağın parçası: saat akışıyla geçilir.
  if (!isPlayable(next)) {
    switchSource(next, false);
    playDead(next, next.tStart);
    return;
  }
  // Başka kaynağın parçasına geçiş: önizleme o kaynağa çevrilir.
  if (segmentSourceId(next) !== segmentSourceId(finished)) {
    active = next;
    applyEffects(next, next.tStart);
    state.patch({ currentTime: next.tStart, inGap: false });
    switchSource(next, true);
    return;
  }
  // Aynı klibin bitişik parçasıysa atlamaya gerek yok (takılma olmasın).
  const continuous =
    sourceTime !== undefined &&
    Math.abs(next.srcStart - sourceTime) < 0.08 &&
    next.speed === finished.speed;
  active = next;
  if (!continuous) player()?.seek(next.srcStart);
  applyRate(next);
  applyEffects(next, next.tStart);
  state.patch({ currentTime: next.tStart, inGap: false });
}

export function currentSegments(): Segment[] {
  const { clips, tracks } = useEditorStore.getState();
  if (clips !== cachedClips || tracks !== cachedTracks) {
    cachedClips = clips;
    cachedTracks = tracks;
    cachedSegments = flatten(clips, tracks);
    active = null;
  }
  return cachedSegments;
}

/** Önizleme sesi: kullanıcının düzeyi × klibin düzeyi ve geçişi (en fazla %100;
 * tarayıcı yükseltemez, dışa aktarımda %200'e kadar uygulanır). */
export function applyVolume() {
  const { volume, clipGain } = usePlayerStore.getState();
  player()?.setVolume(Math.min(1, volume * clipGain));
}

function applyEffects(segment: Segment | null, t: number) {
  const { gain, opacity } = segment ? segmentEffects(segment, t) : { gain: 1, opacity: 1 };
  const state = usePlayerStore.getState();
  if (Math.abs(state.clipGain - gain) > 0.005 || Math.abs(state.clipOpacity - opacity) > 0.005) {
    state.patch({ clipGain: gain, clipOpacity: opacity });
    applyVolume();
  }
  const look = segment?.look ?? null;
  const fadeWhite = segment?.fadeWhite === true;
  if (state.clipLook !== look || state.clipFadeWhite !== fadeWhite) {
    state.patch({ clipLook: look, clipFadeWhite: fadeWhite });
  }
}

function applyRate(segment: Segment) {
  const preview = usePlayerStore.getState().rate;
  player()?.setRate(Math.min(16, Math.max(0.0625, segment.speed * preview)));
}

/** Oynatma imlecini zaman çizelgesinde `t` anına taşır. Parça başka bir
 * kaynaktaysa önizleme o kaynağa geçer (oynatıcı yeniden kurulur). */
export function seekTimeline(t: number): boolean {
  stopGap();
  const segments = currentSegments();
  const end = sequenceEnd(useEditorStore.getState().clips);
  const time = Math.min(Math.max(t, 0), Math.max(end, 0));
  const segment = segmentAt(segments, time);
  active = segment;
  usePlayerStore.getState().patch({ currentTime: time, inGap: segment === null });
  applyEffects(segment, time);
  if (segment) {
    // Önizlemesi olmayan kaynak: kaynak etkinleşir ("önizleme yok" görünür),
    // oynatıcı durur; eski video karesi gösterilmez.
    if (!isPlayable(segment)) {
      switchSource(segment, false);
      return false;
    }
    if (switchSource(segment, false, sourceTimeAt(segment, time))) return true;
    player()?.seek(sourceTimeAt(segment, time));
    applyRate(segment);
  } else {
    player()?.pause();
  }
  return false;
}

/** Düzenleme sonrası (klip silindi, hız değişti) görüntüyü imleçteki kareye eşitler. */
export function refreshPlayback() {
  if (!usePlayerStore.getState().playing) seekTimeline(usePlayerStore.getState().currentTime);
}

/** Oynatıcıdan gelen kaynak zamanı: zaman çizelgesine çevrilir, parça bitince
 * sonrakine geçilir. */
export function onSourceTime(sourceTime: number) {
  // Kaynak geçişi sürüyor: eski oynatıcının gecikmeli olayları yok sayılır.
  if (pendingSeek) return;
  const state = usePlayerStore.getState();
  const segments = currentSegments();
  if (!active) {
    active = segmentAt(segments, state.currentTime);
    if (!active) return;
  }
  if (sourceTime >= active.srcEnd - 0.03) {
    advanceAfter(active, sourceTime);
    return;
  }
  const t = Math.max(active.tStart, timelineTimeAt(active, sourceTime));
  if (state.stopAt !== null && t >= state.stopAt) {
    player()?.pause();
    state.patch({ currentTime: state.stopAt, stopAt: null });
    return;
  }
  applyEffects(active, t);
  state.patch({ currentTime: t, inGap: false });
}

export function togglePlayback() {
  const state = usePlayerStore.getState();
  if (state.gapPlaying) {
    stopGap();
    return;
  }
  // Kaynak geçişi bekleniyorsa: yeni oynatıcı hazır olunca oynat.
  if (pendingSeek) {
    pendingSeek = { ...pendingSeek, play: true };
    return;
  }
  if (state.playing) {
    player()?.pause();
    return;
  }
  state.patch({ stopAt: null });
  startFrom(state.currentTime);
}

function startFrom(t: number) {
  const segments = currentSegments();
  if (segments.length === 0) return;
  const end = segments[segments.length - 1].tEnd;
  let time = t >= end - 0.05 ? 0 : t;
  const segment = segmentAt(segments, time) ?? nextSegment(segments, time);
  if (!segment) return;
  // Boşluktan başlatılınca (baştaki boşluk dahil) önce boşluk oynar.
  if (segment.tStart > time + 0.02) {
    playGap(time, segment);
    return;
  }
  // Önizlemesi olmayan kaynağın parçasından başlatılınca saat akışıyla oynar.
  if (!isPlayable(segment)) {
    seekTimeline(time);
    playDead(segment, time);
    return;
  }
  // Kaynak değişiyorsa oynatma, yeni oynatıcı hazır olunca başlar.
  if (seekTimeline(time)) {
    if (pendingSeek) pendingSeek = { ...pendingSeek, play: true };
    return;
  }
  player()?.play();
}

/** [start, end) aralığını (zaman çizelgesi) oynatır ve sonunda durur. */
export function playTimelineRange(start: number, end: number) {
  usePlayerStore.getState().patch({ stopAt: end });
  startFrom(start);
}

/** Önizleme hızı (1×, 1,5×…) değişince o anki parçaya da uygulanır. */
export function setPreviewRate(rate: number) {
  usePlayerStore.getState().patch({ rate });
  const segment = active ?? segmentAt(currentSegments(), usePlayerStore.getState().currentTime);
  if (segment) applyRate(segment);
}
