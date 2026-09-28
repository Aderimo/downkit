import { beforeEach, describe, expect, test, vi } from "vitest";

// Kare istekleri ve olay dinleyicisi burada toplanır; arka uç taklit edilir.
interface ThumbPayload {
  requestId: string;
  index: number;
  dataUrl: string | null;
}
const invokes: { token: string; times: number[]; requestId: string }[] = [];
let listener: ((p: ThumbPayload) => void) | null = null;
let failNext = false;

vi.mock("./tauri-api", () => ({
  requestEditorThumbnails: (token: string, times: number[], _height: number, requestId: string) => {
    if (failNext) {
      failNext = false;
      return Promise.reject(new Error("bağlantı yok"));
    }
    invokes.push({ token, times: [...times], requestId });
    return Promise.resolve();
  },
  getEditorWaveform: vi.fn(() => Promise.resolve([0.2, 0.7])),
  onEditorThumb: (cb: (p: ThumbPayload) => void) => {
    listener = cb;
    return Promise.resolve(() => {});
  },
}));

import {
  ensureWaveform,
  nearestFromEntries,
  requestThumbs,
  useThumbStore,
  useWaveStore,
} from "./thumbCache";
import { getEditorWaveform } from "./tauri-api";

async function flush() {
  await vi.advanceTimersByTimeAsync(250);
  await Promise.resolve();
}

function emit(requestId: string, times: number[], token: string) {
  times.forEach((t, index) => listener?.({ requestId, index, dataUrl: `data:${token}@${t}` }));
}

beforeEach(() => {
  vi.useFakeTimers();
  invokes.length = 0;
});

describe("requestThumbs", () => {
  test("iki kaynağın kareleri ayrı önbellekte saklanır", async () => {
    requestThumbs("tA", [1]);
    requestThumbs("tB", [2]);
    await flush();
    expect(invokes).toHaveLength(2);
    expect(invokes[0].token).toBe("tA");
    expect(invokes[1].token).toBe("tB");
    emit(invokes[0].requestId, invokes[0].times, "tA");
    const { byToken } = useThumbStore.getState();
    expect(byToken.tA["1.00"]).toBe("data:tA@1");
    // A'nın yükü B'nin önbelleğine karışmaz.
    expect(byToken.tB ?? {}).toEqual({});
  });

  test("önbellekteki kare tekrar istenmez", async () => {
    requestThumbs("tC", [3]);
    await flush();
    emit(invokes[0].requestId, invokes[0].times, "tC");
    requestThumbs("tC", [3]);
    await flush();
    expect(invokes).toHaveLength(1);
  });

  test("batch bitince bekleyen kayıtlar temizlenir, yeni anlar istenebilir", async () => {
    requestThumbs("tD", [1, 2]);
    await flush();
    emit(invokes[0].requestId, invokes[0].times, "tD");
    requestThumbs("tD", [5]);
    await flush();
    expect(invokes).toHaveLength(2);
    expect(invokes[1].times).toEqual([5]);
  });

  test("istek gönderilemezse kayıtlar temizlenip yeniden denenebilir", async () => {
    failNext = true;
    requestThumbs("tE", [9]);
    await flush();
    expect(invokes).toHaveLength(0);
    requestThumbs("tE", [9]);
    await flush();
    expect(invokes).toHaveLength(1);
    expect(invokes[0].times).toEqual([9]);
  });

  test("kaynak sayısı sınırında en eski boş kaynak atılır", async () => {
    for (let i = 0; i < 8; i += 1) {
      requestThumbs(`tV${i}`, [1]);
      await flush();
      emit(invokes[invokes.length - 1].requestId, [1], `tV${i}`);
    }
    expect(Object.keys(useThumbStore.getState().byToken).length).toBeLessThanOrEqual(8);
    // Dokuzuncu kaynağın karesi gelince en eskisi (tV0) atılır.
    requestThumbs("tV8", [1]);
    await flush();
    emit(invokes[invokes.length - 1].requestId, [1], "tV8");
    const { byToken } = useThumbStore.getState();
    expect(Object.keys(byToken)).toHaveLength(8);
    expect(byToken.tV0).toBeUndefined();
    expect(byToken.tV8).toBeDefined();
  });
});

describe("ensureWaveform", () => {
  test("aynı kaynak için tek üretim yapılır ve önbelleklenir", async () => {
    ensureWaveform("wA", 10);
    ensureWaveform("wA", 10);
    await vi.runAllTimersAsync();
    expect(useWaveStore.getState().byToken.wA).toEqual([0.2, 0.7]);
    ensureWaveform("wA", 10);
    expect(vi.mocked(getEditorWaveform)).toHaveBeenCalledTimes(1);
  });
});

describe("nearestFromEntries", () => {
  test("en yakın anahtarın karesi döner", () => {
    const entries = { "1.00": "a", "3.00": "b", "5.00": "c" };
    expect(nearestFromEntries(entries, [1, 3, 5], 3.4)).toBe("b");
    expect(nearestFromEntries(entries, [1, 3, 5], 4.5)).toBe("c");
    expect(nearestFromEntries(entries, [1, 3, 5], 0)).toBe("a");
    expect(nearestFromEntries(entries, [], 1)).toBeNull();
  });
});
