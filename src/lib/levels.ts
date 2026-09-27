// Ses seviyesi göstergesi: Rust saniyede 20 kez tepe değeri gönderir; gösterge
// bunu yayın ekipmanlarındaki gibi yumuşatır (hızlı yükselir, yavaş düşer, tepe
// bir süre asılı kalır). Değerler React durumuna konmaz: gösterge her karede
// doğrudan çizilir, sayfa yeniden çizilmez.

export const METER_FLOOR_DB = -60;
/** Düşüş hızı (dB/sn): çubuk sesin arkasından yumuşakça iner. */
const RELEASE_DB_PER_SECOND = 28;
/** Tepe işareti bu kadar asılı kalır, sonra iner. */
const PEAK_HOLD_MS = 1000;
const PEAK_FALL_DB_PER_SECOND = 20;
/** Bu kadar süre veri gelmezse seviye sıfır sayılır (oturum bitti ya da takıldı). */
const STALE_MS = 400;

export function toDb(level: number): number {
  return level > 0 ? Math.max(METER_FLOOR_DB, 20 * Math.log10(level)) : METER_FLOOR_DB;
}

/** −60…0 dB → 0…1 (algı logaritmik olduğu için dB üzerinden). */
export function meterFraction(db: number): number {
  return Math.min(1, Math.max(0, (db - METER_FLOOR_DB) / -METER_FLOOR_DB));
}

export interface MeterState {
  db: number;
  peakDb: number;
  peakAt: number;
}

export const SILENT_METER: MeterState = {
  db: METER_FLOOR_DB,
  peakDb: METER_FLOOR_DB,
  peakAt: 0,
};

/** Bir kare ilerletir: yükselişte hemen, düşüşte sabit hızla. */
export function stepMeter(
  state: MeterState,
  level: number,
  now: number,
  dtSeconds: number,
): MeterState {
  const target = toDb(level);
  const db =
    target >= state.db ? target : Math.max(target, state.db - RELEASE_DB_PER_SECOND * dtSeconds);
  if (db >= state.peakDb) return { db, peakDb: db, peakAt: now };
  const peakDb =
    now - state.peakAt > PEAK_HOLD_MS
      ? Math.max(db, state.peakDb - PEAK_FALL_DB_PER_SECOND * dtSeconds)
      : state.peakDb;
  return { db, peakDb, peakAt: state.peakAt };
}

let current: number[] = [];
let updatedAt = 0;

export function setLevels(levels: number[], now = performance.now()): void {
  current = levels;
  updatedAt = now;
}

/** `index`. kaynağın son seviyesi (0–1); veri eskidiyse 0. */
export function readLevel(index: number, now = performance.now()): number {
  return now - updatedAt > STALE_MS ? 0 : (current[index] ?? 0);
}
