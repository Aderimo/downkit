// Ekran kaydı eylemleri: başlat/durdur, anlık tekrar, kaydet; sistem geneli
// kısayollar (oyun oynarken de çalışır) ve geri bildirim. Sayfadan bağımsızdır:
// kısayol hangi sayfadayken basılırsa basılsın çalışır. Pencere arkadayken
// sonuç ekranın köşesindeki bilgi penceresinde (HUD) gösterilir.

import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { TrayIcon } from "@tauri-apps/api/tray";
import i18n from "../i18n";
import { formatDuration } from "./format";
import { localizeError } from "./errors";
import { logEvent } from "./log";
import { showHud, type HudKind } from "./hud";
import { setLevels } from "./levels";
import { capture } from "./snipActions";
import { hotkeyLabel } from "./recorderLogic";
import {
  getRecorderSettings,
  useRecorderSettings,
  type RecorderHotkey,
  type RecorderSettings,
} from "./recorderSettings";
import { captureTarget, fileStamp, isMonitor, resolveSource, toAccelerator } from "./recorderLogic";
import {
  hotkeyUnwatch,
  hotkeyUnwatchAll,
  hotkeyWatch,
  isWindowFocused,
  onHotkeyHook,
  onRecorderError,
  onRecorderLevels,
  onRecorderSaved,
  onRecorderStatus,
  recorderDefaultDir,
  recorderPrepare,
  recorderSources,
  recorderScreenshot,
  recorderStart,
  recorderStatus,
  recorderStop,
  recordingThumbnail,
  recordingsList,
  replaySave,
  replayStart,
  replayStop,
} from "./tauri-api";
import { useRecorderStore, type RecorderPending } from "../store/recorderStore";
import type { CaptureOptions, SavedRecording } from "../types/recorder";

const store = () => useRecorderStore.getState();
const patch = (p: Parameters<ReturnType<typeof store>["patch"]>[0]) => store().patch(p);
const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

/** Kısayolun ekranda yazılışı (atanmamışsa boş). */
function keyOf(hotkey: RecorderHotkey): string {
  const combo = getRecorderSettings().hotkeys[hotkey];
  return combo ? hotkeyLabel(combo) : "";
}

/** Süre yazısı: "45 saniye", "2 dakika", "1 dk 35 sn". */
export function replayLengthText(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return t("recorder.seconds", { n: s });
  if (s === 0) return t("recorder.minutes", { n: m });
  return t("recorder.minutesSeconds", { m, s });
}

const lengthLabel = replayLengthText;

/** Pencere arkadaysa (oyun, başka program) köşede kısa bilgi gösterir. */
async function feedback(kind: HudKind, title: string, detail?: string | null) {
  if (!(await isWindowFocused())) await showHud(kind, title, detail);
}

/** Kayıt klasörü: ayarlardaki ya da Videolar\DownKit\Kayıtlar. */
export async function resolveOutputDir(): Promise<string> {
  const custom = getRecorderSettings().outputDir;
  const dir = custom ?? (await recorderDefaultDir(t("recorder.folderName")));
  if (store().outputDir !== dir) patch({ outputDir: dir });
  return dir;
}

export async function refreshSources(): Promise<void> {
  try {
    patch({ sources: await recorderSources() });
  } catch (err) {
    // Tarayıcı önizlemesinde (Tauri yok) hata gösterilmez.
    if ("__TAURI_INTERNALS__" in window) {
      patch({ error: localizeError(err, "recorder.sourcesFailed") });
    }
  }
}

/** Ayarlardaki kaynağı şu anki ekran/pencerelerle eşleyip kayıt seçeneklerini kurar.
 * `folderFallback`: uygulamaya göre klasörlemede ekran kaydının klasör adı
 * (tam ekran bir uygulama yoksa "Ana ekran" / "Ekran 2" gibi). */
async function buildOptions(
  settings: RecorderSettings,
): Promise<{ options: CaptureOptions; folderFallback: string | null }> {
  const sources = await recorderSources();
  patch({ sources });
  const item = resolveSource(settings.source, sources);
  if (!item) throw { code: "recorderSourceMissing", message: t("recorder.sourceMissing") };
  const target = captureTarget(item);
  if (!store().encoder) {
    patch({ encoder: await recorderPrepare(target) });
  }
  const folderFallback = isMonitor(item)
    ? item.primary
      ? t("recorder.primaryScreen")
      : t("recorder.screenN", { n: item.number })
    : null;
  return {
    folderFallback,
    options: {
      target,
      video: {
        fps: settings.fps,
        maxHeight: settings.maxHeight,
        quality: settings.quality,
        cursor: settings.cursor,
        bitrateKbps: settings.bitrateKbps,
      },
      systemAudio: settings.systemAudio,
      systemAudioId: settings.systemAudioId,
      systemVolume: settings.systemVolume,
      microphone: settings.microphone,
      microphoneId: settings.microphoneId,
      microphoneVolume: settings.microphoneVolume,
      noiseSuppression: settings.noiseSuppression,
    },
  };
}

/** Tek seferde bir kayıt işlemi. Başka biri sürerken basılan kısayol sessizce
 * yutulmaz: kullanıcıya beklemesi söylenir. Başarılıysa true. */
async function run(
  kind: RecorderPending,
  action: () => Promise<void>,
  fallbackKey: string,
): Promise<boolean> {
  if (store().pending) {
    void feedback("info", t("recorder.hud.busy"));
    return false;
  }
  patch({ pending: kind, error: null, notice: null });
  try {
    await action();
    return true;
  } catch (err) {
    const error = localizeError(err, fallbackKey);
    logEvent("error", `Kayıt: ${error.message}`, error.detail);
    patch({ error });
    void feedback("error", error.message);
    return false;
  } finally {
    patch({ pending: null });
    await syncStatus();
  }
}

async function syncStatus() {
  try {
    patch({ status: await recorderStatus() });
  } catch {
    // Tauri dışında (tarayıcı önizlemesi) durum yok.
  }
}

export async function startRecording(): Promise<void> {
  const ok = await run(
    "record",
    async () => {
      const settings = getRecorderSettings();
      const { options, folderFallback } = await buildOptions(settings);
      const dir = await resolveOutputDir();
      await recorderStart(
        options,
        dir,
        `${t("recorder.recordingPrefix")} ${fileStamp(new Date())}`,
        settings.byApp,
        folderFallback,
      );
    },
    "recorder.startFailed",
  );
  const key = keyOf("record");
  if (ok) {
    void feedback(
      "record",
      t("recorder.hud.recordingStarted"),
      key ? t("recorder.hud.stopWith", { key }) : null,
    );
  }
}

export async function stopRecording(): Promise<void> {
  // Sonuç (kaydedildi) `recorder-saved` olayıyla gelir.
  await run("record", () => recorderStop().then(() => undefined), "recorder.stopFailed");
}

export function toggleRecording(): Promise<void> {
  return store().status.recording ? stopRecording() : startRecording();
}

export async function startReplay(): Promise<void> {
  const settings = getRecorderSettings();
  const ok = await run(
    "replay",
    async () => {
      const { options } = await buildOptions(settings);
      await replayStart(options, settings.replaySeconds);
    },
    "recorder.replayFailed",
  );
  const key = keyOf("saveReplay");
  if (ok) {
    void feedback(
      "replayOn",
      t("recorder.hud.replayOn"),
      t("recorder.hud.replayOnDetail", { length: lengthLabel(settings.replaySeconds) }) +
        (key ? ` · ${t("recorder.hud.saveWith", { key })}` : ""),
    );
  }
}

export async function stopReplay(): Promise<void> {
  const ok = await run("replay", () => replayStop(), "recorder.replayFailed");
  if (ok) void feedback("replayOff", t("recorder.hud.replayOff"));
}

export function toggleReplay(): Promise<void> {
  return store().status.replay ? stopReplay() : startReplay();
}

/** Süre değişince anlık tekrar yeni süreyle yeniden başlar. */
export async function restartReplay(): Promise<void> {
  if (!store().status.replay) return;
  await stopReplay();
  await startReplay();
}

/** Anlık tekrarın son N saniyesini kaydeder. Açık değilse kullanıcıya söyler. */
export async function saveReplay(): Promise<void> {
  if (!store().status.replay) {
    const key = keyOf("toggleReplay");
    // Hata değil, bilgi: "Hatayı bildir" düğmesiyle rapor gerektiren bir durum yok.
    patch({
      notice: key ? t("recorder.replayOffNotice", { key }) : t("recorder.replayOff"),
    });
    void feedback(
      "info",
      t("recorder.hud.replayIsOff"),
      key ? t("recorder.hud.turnOnWith", { key }) : null,
    );
    return;
  }
  await run(
    "save",
    async () => {
      const dir = await resolveOutputDir();
      const settings = getRecorderSettings();
      // Ekran kaydında klasör adı ("Ana ekran" gibi) kaydedilen hedefin etiketidir.
      let folderFallback: string | null = null;
      if (settings.byApp) {
        const sources = store().sources ?? (await recorderSources());
        const item = resolveSource(settings.source, sources);
        if (item && isMonitor(item)) {
          folderFallback = item.primary
            ? t("recorder.primaryScreen")
            : t("recorder.screenN", { n: item.number });
        }
      }
      await replaySave(
        dir,
        `${t("recorder.replayPrefix")} ${fileStamp(new Date())}`,
        settings.byApp,
        folderFallback,
      );
    },
    "recorder.saveFailed",
  );
}

export async function refreshRecordings(): Promise<void> {
  try {
    const dir = await resolveOutputDir();
    patch({ recordings: await recordingsList(dir), recordingsLoaded: true });
  } catch {
    patch({ recordingsLoaded: true });
  }
}

const thumbRequests = new Set<string>();

export async function loadThumb(path: string): Promise<void> {
  if (path in store().thumbs || thumbRequests.has(path)) return;
  thumbRequests.add(path);
  try {
    const url = await recordingThumbnail(path);
    patch({ thumbs: { ...store().thumbs, [path]: url } });
  } catch {
    patch({ thumbs: { ...store().thumbs, [path]: null } });
  } finally {
    thumbRequests.delete(path);
  }
}

function fileName(path: string): string {
  return (path.split(/[\\/]/).pop() ?? path).replace(/\.[^.]+$/, "");
}

function onSaved(saved: SavedRecording) {
  patch({ lastSaved: saved });
  void refreshRecordings();
  void feedback(
    "saved",
    saved.kind === "replay"
      ? t("recorder.hud.replaySaved", { length: lengthLabel(saved.seconds) })
      : t("recorder.hud.recordingSaved", { time: formatDuration(saved.seconds) }),
    fileName(saved.path),
  );
}

/** Seçili kaynağın (ekran/pencere) tam çözünürlüklü ekran görüntüsünü PNG kaydeder. */
export async function takeScreenshot(): Promise<void> {
  await run(
    "save",
    async () => {
      const settings = getRecorderSettings();
      const sources = await recorderSources();
      patch({ sources });
      const item = resolveSource(settings.source, sources);
      if (!item) throw { code: "recorderSourceMissing", message: t("recorder.sourceMissing") };
      const dir = await resolveOutputDir();
      const folderFallback = isMonitor(item)
        ? item.primary
          ? t("recorder.primaryScreen")
          : t("recorder.screenN", { n: item.number })
        : null;
      const path = await recorderScreenshot(
        captureTarget(item),
        dir,
        `${t("recorder.screenshotPrefix")} ${fileStamp(new Date())}`,
        settings.byApp,
        folderFallback,
      );
      patch({ notice: t("recorder.screenshotSaved", { name: fileName(path) }) });
      void feedback("saved", t("recorder.hud.screenshotSaved"), fileName(path));
    },
    "recorder.screenshotFailed",
  );
}

// --- Sistem geneli kısayollar ---

const HOTKEY_ACTIONS: Record<RecorderHotkey, () => Promise<void>> = {
  record: toggleRecording,
  saveReplay,
  toggleReplay,
  screenshot: takeScreenshot,
  snip: () => capture("region"),
  snipFull: () => capture("full"),
  snipTranslate: () => capture("translate"),
};

// Kayıt/kaldırma çağrıları sırayla yapılır: üst üste gelen değişiklikler
// birbirinin yarısında çalışıp "zaten kayıtlı" hatası vermesin.
let queue: Promise<void> = Promise.resolve();
let paused = false;

function enqueue(task: () => Promise<void>): Promise<void> {
  queue = queue.then(task, task);
  return queue;
}

/** Tek kısayolu Windows'a kaydeder. Başka program tutuyorsa false. */
async function registerOne(key: RecorderHotkey, accelerator: string): Promise<boolean> {
  try {
    await register(accelerator, (event) => {
      if (event.state !== "Pressed") return;
      patch({ lastHotkey: { key, at: Date.now() } });
      void HOTKEY_ACTIONS[key]();
    });
    return true;
  } catch {
    return false;
  }
}

// Başka programın tuttuğu kısayollar atanmış kalır ve ara ara yeniden denenir:
// o program bırakınca (ör. NVIDIA'da kısayol kapatılınca) DownKit devralır.
const RETRY_MS = 5000;
let taken = new Map<RecorderHotkey, string>();
let retryTimer: ReturnType<typeof setInterval> | undefined;

function scheduleRetry() {
  if (taken.size === 0) {
    clearInterval(retryTimer);
    retryTimer = undefined;
    return;
  }
  retryTimer ??= setInterval(() => {
    if (!paused && taken.size > 0) void enqueue(retryTaken);
  }, RETRY_MS);
}

async function retryTaken(): Promise<void> {
  if (paused) return;
  let changed = false;
  for (const [key, accelerator] of taken) {
    if (await registerOne(key, accelerator)) {
      taken.delete(key);
      // Normal kayıt devraldı; yedek kancaya gerek kalmadı (çift tetikleme olmasın).
      void hotkeyUnwatch(key).catch(() => {});
      changed = true;
    }
  }
  if (!changed) return;
  const errors = { ...store().hotkeyErrors };
  const active = new Set(store().activeHotkeys);
  for (const key of Object.keys(HOTKEY_ACTIONS) as RecorderHotkey[]) {
    if (errors[key] && !taken.has(key) && getRecorderSettings().hotkeys[key]) {
      delete errors[key];
      active.add(key);
    }
  }
  patch({ hotkeyErrors: errors, activeHotkeys: [...active] });
  scheduleRetry();
}

async function registerNow(hotkeys: RecorderSettings["hotkeys"]): Promise<void> {
  try {
    // Uygulama yalnızca bu kısayolları kullanıyor: hepsini kaldırıp baştan kurmak en güvenlisi.
    await unregisterAll();
    await hotkeyUnwatchAll().catch(() => {});
  } catch {
    // Tauri dışında kısayol yok.
    return;
  }
  const errors: Partial<Record<RecorderHotkey, string>> = {};
  const active: RecorderHotkey[] = [];
  taken = new Map();
  for (const key of Object.keys(HOTKEY_ACTIONS) as RecorderHotkey[]) {
    const combo = hotkeys[key];
    if (!combo) continue;
    const accelerator = toAccelerator(combo);
    if (!accelerator) {
      errors[key] = t("recorder.hotkeyInvalid");
      continue;
    }
    if (await registerOne(key, accelerator)) {
      active.push(key);
    } else {
      // Windows bir birleşimi tek programa verir. Kayıt reddedildiyse yedek
      // klavye kancası devreye girer: tuş DownKit'te yine çalışır (öteki
      // programın kısayolu da çalışmaya devam eder). Birleşim boşalınca
      // yeniden denenip normal kayda geçilir.
      try {
        await hotkeyWatch(key, accelerator);
        active.push(key);
        errors[key] = t("recorder.hotkeyShared");
      } catch {
        errors[key] = t("recorder.hotkeyTaken");
      }
      taken.set(key, accelerator);
    }
  }
  patch({ hotkeyErrors: errors, activeHotkeys: active });
  scheduleRetry();
}

/** Kısayol atanırken sistem geneli kısayollar geçici olarak kaldırılır; yoksa
 * atanan tuşa basınca Windows onu yakalar ve sayfa hiç görmez. */
export function pauseHotkeys(): Promise<void> {
  return enqueue(async () => {
    paused = true;
    await unregisterAll().catch(() => {});
    // Yedek kanca da susar: atanırken basılan birleşim eylemi tetiklemesin.
    await hotkeyUnwatchAll().catch(() => {});
    patch({ activeHotkeys: [] });
  });
}

export function resumeHotkeys(): Promise<void> {
  return enqueue(async () => {
    paused = false;
    await registerNow(getRecorderSettings().hotkeys);
  });
}

// --- Tepsi simgesinin ipucu: kayıt ve anlık tekrar durumu ---

let lastTooltip = "";

function updateTooltip() {
  const { recording, replay } = store().status;
  const parts = ["DownKit"];
  if (recording)
    parts.push(`● ${t("recorder.statusRecording", { time: formatDuration(recording.seconds) })}`);
  if (replay) parts.push(t("recorder.statusReplay", { time: formatDuration(replay.seconds) }));
  const text = parts.join(" · ");
  if (text === lastTooltip) return;
  lastTooltip = text;
  void TrayIcon.getById("downkit")
    .then((tray) => tray?.setTooltip(text))
    .catch(() => {});
}

let initialized = false;

/** Uygulama açılışında bir kez: olaylar, kısayollar, istenirse anlık tekrar. */
export async function initRecorder(): Promise<void> {
  if (initialized) return;
  initialized = true;
  await onRecorderStatus((status) => patch({ status }));
  await onRecorderLevels((levels) => setLevels(levels));
  await onRecorderSaved((saved) => onSaved(saved));
  await onRecorderError((e) => {
    logEvent("error", `Kayıt (${e.kind}): ${e.message}`, e.detail);
    patch({ error: { message: e.message, detail: e.detail } });
    void syncStatus();
    void feedback("error", e.message);
  });
  await syncStatus();
  useRecorderStore.subscribe((next, prev) => {
    if (next.status !== prev.status) updateTooltip();
  });
  await enqueue(() => registerNow(getRecorderSettings().hotkeys));
  // Yedek kancadan gelen tetiklemeler: birleşim başka bir programda tutulsa bile çalışır.
  await onHotkeyHook((action) => {
    const key = action as RecorderHotkey;
    if (!(key in HOTKEY_ACTIONS)) return;
    patch({ lastHotkey: { key, at: Date.now() } });
    void HOTKEY_ACTIONS[key]();
  });
  useRecorderSettings.subscribe((next, prev) => {
    if (!paused && JSON.stringify(next.hotkeys) !== JSON.stringify(prev.hotkeys)) {
      void enqueue(() => registerNow(next.hotkeys));
    }
  });
  if (getRecorderSettings().replayOnStartup && !store().status.replay) {
    void startReplay();
  }
}
