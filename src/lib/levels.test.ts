import { describe, expect, it } from "vitest";
import {
  METER_FLOOR_DB,
  SILENT_METER,
  meterFraction,
  readLevel,
  setLevels,
  stepMeter,
  toDb,
} from "./levels";

describe("ses göstergesi", () => {
  it("seviye dB'ye, dB çubuk oranına çevrilir", () => {
    expect(toDb(1)).toBeCloseTo(0);
    expect(toDb(0)).toBe(METER_FLOOR_DB);
    expect(meterFraction(0)).toBe(1);
    expect(meterFraction(-30)).toBeCloseTo(0.5);
    expect(meterFraction(-90)).toBe(0);
  });

  it("hemen yükselir, sonra yavaşça düşer (zıplamaz)", () => {
    const loud = stepMeter(SILENT_METER, 1, 0, 1 / 60);
    expect(loud.db).toBeCloseTo(0);
    // Ses bir anda kesilince bir karede en fazla ~0,5 dB iner.
    const next = stepMeter(loud, 0, 16, 1 / 60);
    expect(next.db).toBeLessThan(0);
    expect(next.db).toBeGreaterThan(-1);
  });

  it("tepe işareti bir saniye asılı kalır, sonra iner", () => {
    let state = stepMeter(SILENT_METER, 1, 0, 1 / 60);
    for (let t = 16; t <= 900; t += 16) state = stepMeter(state, 0.01, t, 0.016);
    expect(state.peakDb).toBeCloseTo(0);
    for (let t = 916; t <= 2000; t += 16) state = stepMeter(state, 0.01, t, 0.016);
    expect(state.peakDb).toBeLessThan(-10);
  });

  it("veri gelmeyince seviye sıfır sayılır", () => {
    setLevels([0.5, 0.2], 1000);
    expect(readLevel(0, 1100)).toBe(0.5);
    expect(readLevel(1, 1100)).toBe(0.2);
    expect(readLevel(0, 2000)).toBe(0);
  });
});
