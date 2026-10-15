import { describe, expect, it } from "vitest";
import {
  exportPieces,
  flatten,
  moveClip,
  overlaySegments,
  snapCandidates,
  type SeqClip,
} from "./sequence";
import { withEffects, type EffectItem } from "./effectLane";

// Büyük projelerde sürükleme sırasında her karede çalışan hesapların süresi. Tek başına
// çalışınca 1000 klipte ~6–8 ms (bir kare 16 ms). Bütün testler paralel koşarken makine
// yüklü olduğundan sınır 50 ms: amaç karesel büyüme gibi gerilemeleri yakalamak.

function project(n: number): { clips: SeqClip[]; effects: EffectItem[] } {
  const clips: SeqClip[] = [];
  for (let i = 0; i < n; i++) {
    clips.push({
      id: `c${i}`,
      track: i % 10 === 0 ? 1 : 0,
      start: i * 2,
      srcStart: i,
      srcEnd: i + 1.8,
      speed: 1,
      name: "",
      ...(i % 7 === 0 ? { look: { filter: "bw" } as SeqClip["look"] } : {}),
    });
  }
  const effects: EffectItem[] = Array.from({ length: n / 20 }, (_, i) => ({
    id: `e${i}`,
    start: i * 40,
    end: i * 40 + 3,
    look: { blur: 0.3 },
  }));
  return { clips, effects };
}

/** Ortanca süre: paralel yükte tek seferlik duraklamalar (çöp toplama, başka test)
 * sonucu bozmasın; karesel büyüme yine her ölçümde görünür. */
function timeMs(fn: () => void, runs = 7): number {
  fn();
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  return times.sort((a, b) => a - b)[Math.floor(runs / 2)];
}

describe("performans", () => {
  for (const n of [100, 500, 1000]) {
    it(`${n} klip: parçalar, efekt şeridi ve sürükleme adımı hızlı`, () => {
      const { clips, effects } = project(n);
      const segments = timeMs(() => withEffects(flatten(clips, {}), effects));
      const pieces = timeMs(() => exportPieces(flatten(clips, {})));
      const overlays = timeMs(() => overlaySegments(clips, {}));
      const drag = timeMs(() => {
        snapCandidates(clips, "c5", 0);
        const moved = moveClip(clips, "c5", 3.3, 0);
        flatten(moved, {});
      });
      // Ölçümler test çıktısında görünsün (CI makinesi yavaş olabilir: sınır cömert).
      console.info(
        `${n} klip — parçalar ${segments.toFixed(2)} ms, dışa aktarma ${pieces.toFixed(2)} ms, bindirme ${overlays.toFixed(2)} ms, sürükleme ${drag.toFixed(2)} ms`,
      );
      expect(segments).toBeLessThan(50);
      expect(drag).toBeLessThan(50);
    });
  }
});
