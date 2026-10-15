// Ses efektleri: uygulama kendisi sentezler (telifsiz): whoosh, swoosh, pop, tık,
// ding, darbe, yükselen, zıplama. OfflineAudioContext ile çizilir, 16 bit WAV olarak
// önbelleğe yazılır ve imleçte müzik izine eklenir. Seslendirme: mikrofondan WebM.

import { audioFileWrite } from "./tauri-api";
import { usePlayerStore } from "../store/playerStore";
import { togglePlayback } from "./sequencePlayer";
import { addMusicFile, updateMusic } from "./layerActions";
import type { MusicItem } from "./layers";

export const SFX_KINDS = [
  "whoosh",
  "swoosh",
  "pop",
  "click",
  "ding",
  "impact",
  "riser",
  "boing",
] as const;
export type SfxKind = (typeof SFX_KINDS)[number];

const RATE = 44_100;

const DURATION: Record<SfxKind, number> = {
  whoosh: 0.7,
  swoosh: 0.5,
  pop: 0.25,
  click: 0.08,
  ding: 1.4,
  impact: 1.2,
  riser: 2,
  boing: 0.6,
};

function noise(ctx: BaseAudioContext, seconds: number): AudioBufferSourceNode {
  const buffer = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 22222;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    data[i] = (seed / 0xffffffff) * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  return src;
}

function env(
  ctx: BaseAudioContext,
  attack: number,
  hold: number,
  release: number,
  peak = 1,
): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, 0);
  g.gain.exponentialRampToValueAtTime(peak, attack);
  g.gain.setValueAtTime(peak, attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, attack + hold + release);
  return g;
}

/** Efekti verilen bağlamın hedefine çizer (çevrimdışı ya da canlı). */
export function drawSfx(ctx: BaseAudioContext, kind: SfxKind, out: AudioNode = ctx.destination) {
  const d = DURATION[kind];
  switch (kind) {
    case "whoosh":
    case "swoosh": {
      const n = noise(ctx, d);
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.Q.value = 1.2;
      const up = kind === "whoosh";
      band.frequency.setValueAtTime(up ? 300 : 3000, 0);
      band.frequency.exponentialRampToValueAtTime(up ? 3500 : 250, d);
      const g = env(ctx, d * 0.45, 0, d * 0.5, 0.9);
      n.connect(band).connect(g).connect(out);
      n.start(0);
      break;
    }
    case "pop": {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(900, 0);
      o.frequency.exponentialRampToValueAtTime(180, 0.12);
      o.connect(env(ctx, 0.005, 0.02, 0.18, 0.9)).connect(out);
      o.start(0);
      o.stop(d);
      break;
    }
    case "click": {
      const n = noise(ctx, d);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 2000;
      n.connect(hp)
        .connect(env(ctx, 0.001, 0.005, 0.05, 0.8))
        .connect(out);
      n.start(0);
      break;
    }
    case "ding": {
      for (const [f, a] of [
        [1320, 0.5],
        [2640, 0.2],
        [3960, 0.08],
      ] as const) {
        const o = ctx.createOscillator();
        o.frequency.value = f;
        o.connect(env(ctx, 0.005, 0.02, d - 0.05, a)).connect(out);
        o.start(0);
        o.stop(d);
      }
      break;
    }
    case "impact": {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(120, 0);
      o.frequency.exponentialRampToValueAtTime(40, 0.6);
      o.connect(env(ctx, 0.005, 0.05, 1, 1)).connect(out);
      o.start(0);
      o.stop(d);
      const n = noise(ctx, 0.3);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 1500;
      n.connect(lp)
        .connect(env(ctx, 0.002, 0.01, 0.25, 0.6))
        .connect(out);
      n.start(0);
      break;
    }
    case "riser": {
      const n = noise(ctx, d);
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.Q.value = 3;
      band.frequency.setValueAtTime(200, 0);
      band.frequency.exponentialRampToValueAtTime(6000, d);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, 0);
      g.gain.exponentialRampToValueAtTime(0.9, d * 0.95);
      g.gain.linearRampToValueAtTime(0, d);
      n.connect(band).connect(g).connect(out);
      n.start(0);
      break;
    }
    case "boing": {
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(140, 0);
      o.frequency.exponentialRampToValueAtTime(420, 0.12);
      o.frequency.exponentialRampToValueAtTime(180, d);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 18;
      const depth = ctx.createGain();
      depth.gain.value = 30;
      lfo.connect(depth).connect(o.frequency);
      o.connect(env(ctx, 0.005, 0.05, d - 0.08, 0.8)).connect(out);
      o.start(0);
      lfo.start(0);
      o.stop(d);
      lfo.stop(d);
      break;
    }
  }
}

/** Örnekleri tepe değeri `peak` olacak şekilde ölçekler (kırpılmasın, hepsi eşit yüksek). */
export function normalizePeak(samples: Float32Array, peak = 0.9): Float32Array {
  let max = 0;
  for (const v of samples) max = Math.max(max, Math.abs(v));
  if (max < 1e-6) return samples;
  const k = peak / max;
  return samples.map((v) => v * k);
}

/** Efektin örnekleri (tek kanal, tepe 0,9). */
export async function renderSfx(kind: SfxKind): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.ceil(DURATION[kind] * RATE), RATE);
  drawSfx(ctx, kind);
  const buffer = await ctx.startRendering();
  return normalizePeak(buffer.getChannelData(0));
}

/** 16 bit PCM WAV (tek kanal). */
export function encodeWav(samples: Float32Array, rate = RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) =>
    [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return bytes;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Kartın üzerinde dinleme (dosya yazmadan). */
export function playSfx(kind: SfxKind) {
  const ctx = new AudioContext();
  drawSfx(ctx, kind);
  window.setTimeout(() => void ctx.close(), (DURATION[kind] + 0.3) * 1000);
}

/** Efekti imleçte müzik izine ekler (tam ses düzeyinde). */
export async function addSfx(kind: SfxKind): Promise<MusicItem | null> {
  const wav = encodeWav(await renderSfx(kind));
  const path = await audioFileWrite("sfx", `sfx-${kind}`, toBase64(wav));
  const item = await addMusicFile(path);
  if (item) updateMusic(item.id, { volume: 1, name: kind });
  return item;
}

/** Mikrofon kaydı: başlat → durdur. Kayıt başlarken video oynar (üstüne konuşulur),
 * bitince kayıt başladığı ana WebM/Opus olarak eklenir. */
export async function startVoiceover(): Promise<{ stop: () => Promise<MusicItem | null> }> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  const type = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";
  const recorder = new MediaRecorder(stream, { mimeType: type });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const startAt = usePlayerStore.getState().currentTime;
  recorder.start(250);
  if (!usePlayerStore.getState().playing) togglePlayback();
  return {
    stop: () =>
      new Promise((resolve, reject) => {
        recorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          if (usePlayerStore.getState().playing || usePlayerStore.getState().gapPlaying) {
            togglePlayback();
          }
          try {
            const bytes = new Uint8Array(await new Blob(chunks, { type }).arrayBuffer());
            if (bytes.length < 100) return resolve(null);
            const stamp = new Date()
              .toISOString()
              .replace(/[^0-9]/g, "")
              .slice(0, 14);
            const path = await audioFileWrite("voice", `ses-${stamp}`, toBase64(bytes));
            const item = await addMusicFile(path);
            if (item) updateMusic(item.id, { volume: 1, start: startAt });
            resolve(item);
          } catch (e) {
            reject(e);
          }
        };
        recorder.stop();
      }),
  };
}
