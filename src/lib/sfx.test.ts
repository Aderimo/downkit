import { describe, expect, it } from "vitest";
import { encodeWav, normalizePeak, toBase64 } from "./sfx";

describe("ses efektleri", () => {
  it("16 bit tek kanal WAV başlığı ve örnekleri", () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 0.5]), 44100);
    const view = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint32(40, true)).toBe(8);
    expect(view.getInt16(46, true)).toBe(32767);
    expect(view.getInt16(48, true)).toBe(-32768);
    expect(wav.length).toBe(52);
  });

  it("tepe değeri sabitlenir, sessizlik değişmez", () => {
    const out = normalizePeak(new Float32Array([0.2, -0.4, 0.1]));
    expect(Math.max(...out.map(Math.abs))).toBeCloseTo(0.9);
    expect(normalizePeak(new Float32Array([0, 0]))).toEqual(new Float32Array([0, 0]));
  });

  it("base64", () => {
    expect(toBase64(new Uint8Array([82, 73, 70, 70]))).toBe("UklGRg==");
  });
});
