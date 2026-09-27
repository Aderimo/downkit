// Ekran görüntüsü eylemleri: bölge / tam ekran / hızlı çeviri yakalama, seçim
// penceresinden gelen sonucu işleme (düzenle, kopyala, kaydet, çevir) ve
// kayıt klasöründeki görüntüler. Sayfadan bağımsızdır: kısayol ya da tepsi
// menüsüyle hangi sayfadayken tetiklenirse tetiklensin çalışır.

import i18n from "../i18n";
import { localizeError } from "./errors";
import { logEvent } from "./log";
import { showHud, type HudKind } from "./hud";
import { encodeImage } from "./imageExport";
import { getSnipSettings } from "./snipSettings";
import {
  copyText,
  imageWrite,
  isWindowFocused,
  ocrImage,
  onSnipResult,
  snipCopy,
  snipDefaultDir,
  snipDelete,
  snipList,
  snipOpenFile,
  snipSave,
  snipStart,
  snipThumbnail,
  translateText,
} from "./tauri-api";
import { groupOcrBlocks, ocrLanguageFor, resolveDirection, snipFileName } from "./snip";
import { useSnipStore } from "../store/snipStore";
import type { SnipAction, SnipImage } from "../types/snip";

const store = () => useSnipStore.getState();
const patch = (p: Parameters<ReturnType<typeof store>["patch"]>[0]) => store().patch(p);
const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

/** Pencere arkadaysa (başka program önde) köşede kısa bilgi gösterir. */
async function feedback(kind: HudKind, title: string, detail?: string | null) {
  if (!(await isWindowFocused())) await showHud(kind, title, detail);
}

function fail(err: unknown, fallbackKey: string) {
  const error = localizeError(err, fallbackKey);
  logEvent("error", `Ekran görüntüsü: ${error.message}`, error.detail);
  patch({ error });
  void feedback("error", error.message);
}

function baseName(path: string): string {
  return (path.split(/[\\/]/).pop() ?? path).replace(/\.[^.]+$/, "");
}

/** Kayıt klasörü: ayarlardaki ya da Resimler\DownKit. */
export async function resolveShotDir(): Promise<string> {
  const dir = getSnipSettings().outputDir ?? (await snipDefaultDir());
  if (store().outputDir !== dir) patch({ outputDir: dir });
  return dir;
}

/** Yeni dosyanın adı: "Ekran görüntüsü 2026-09-27 14.05.33". */
export function shotName(date = new Date()): string {
  return snipFileName(t("snip.filePrefix"), date);
}

export type CaptureKind = "region" | "full" | "translate";

/** Yakalamayı başlatır. `fromPage`: DownKit'teki düğmeyle (pencere gizlenir,
 * ayardaki gecikme uygulanır). Kısayolda pencere yalnızca öndeyse gizlenir. */
export async function capture(kind: CaptureKind, fromPage = false): Promise<void> {
  const settings = getSnipSettings();
  const mode: SnipAction = kind === "translate" ? "translate" : settings.enterAction;
  const hideMain = fromPage || (await isWindowFocused());
  const delay = fromPage && kind !== "translate" ? settings.delaySeconds : 0;
  patch({ error: null });
  try {
    await snipStart(mode, hideMain, kind === "full", delay);
  } catch (err) {
    fail(err, "snip.captureFailed");
  }
}

/** Görüntüyü düzenleyicide açar ve Ekran Görüntüsü sayfasına geçirir. */
export function openInEditor(image: SnipImage, translate = false) {
  patch({ image, translateOnOpen: translate, openSeq: store().openSeq + 1, error: null });
}

export function closeEditor() {
  patch({ image: null, translateOnOpen: false });
}

/** Bilgisayardaki bir görüntüyü düzenleyicide açar. */
export async function openFile(path: string): Promise<void> {
  try {
    openInEditor(await snipOpenFile(path));
  } catch (err) {
    fail(err, "snip.openFailed");
  }
}

/** Kırpılmış (düzenlenmemiş) seçimi ayardaki biçimde kaydeder; yolu döner. */
async function saveRaw(image: SnipImage): Promise<string> {
  const { format, quality } = getSnipSettings();
  const dir = await resolveShotDir();
  const name = shotName();
  if (format === "png") return snipSave(image.path, dir, name);
  return imageWrite(await encodeImage(image.url, format, quality), dir, name, format);
}

/** Düzenlenmiş ya da olduğu gibi kaydedilen görüntü kaydedildi: bilgi ve liste. */
export function onShotSaved(path: string) {
  patch({ lastSaved: path });
  void refreshShots();
}

/** Hızlı çeviri: DownKit'in penceresi öne gelmeden seçimdeki yazı okunur,
 * çevrilir ve panoya kopyalanır; görüntü Son görüntüler'e kaydedilir. */
async function quickTranslate(image: SnipImage): Promise<void> {
  const direction = getSnipSettings().translateDirection;
  const out = await ocrImage(image.path, ocrLanguageFor(direction));
  const blocks = groupOcrBlocks(out.lines);
  const text = blocks.map((b) => b.text).join("\n\n");
  if (!text.trim()) {
    patch({ notice: t("snip.noText") });
    void feedback("info", t("snip.noText"));
    return;
  }
  const { from, to } = resolveDirection(direction, text);
  const joined = blocks.map((b) => b.text.replace(/\s*\n\s*/g, " ")).join("\n");
  const translated = (await translateText(joined, from, to)).split("\n").join("\n\n");
  await copyText(translated);
  const path = await saveRaw(image);
  onShotSaved(path);
  patch({ notice: t("snip.translateCopied") });
  void feedback(
    "saved",
    t("snip.translateCopied"),
    translated.length > 160 ? `${translated.slice(0, 160)}…` : translated,
  );
}

async function handleResult(image: SnipImage, action: SnipAction) {
  try {
    if (action === "translate" && !getSnipSettings().translateOpensEditor) {
      await quickTranslate(image);
    } else if (action === "edit" || action === "translate") {
      openInEditor(image, action === "translate");
    } else if (action === "copy") {
      await snipCopy(image.path);
      patch({ notice: t("snip.copied") });
      void feedback("saved", t("snip.copied"));
    } else {
      const path = await saveRaw(image);
      if (getSnipSettings().copyOnSave) await snipCopy(image.path);
      onShotSaved(path);
      void feedback(
        "saved",
        getSnipSettings().copyOnSave ? t("snip.savedAndCopied") : t("snip.saved"),
        baseName(path),
      );
    }
  } catch (err) {
    fail(err, action === "copy" ? "snip.copyFailed" : "snip.saveFailed");
  }
}

export async function refreshShots(): Promise<void> {
  try {
    const dir = await resolveShotDir();
    patch({ shots: await snipList(dir), shotsLoaded: true });
  } catch {
    patch({ shotsLoaded: true });
  }
}

const thumbRequests = new Set<string>();

export async function loadShotThumb(path: string): Promise<void> {
  if (path in store().thumbs || thumbRequests.has(path)) return;
  thumbRequests.add(path);
  try {
    const url = await snipThumbnail(path);
    patch({ thumbs: { ...store().thumbs, [path]: url } });
  } catch {
    patch({ thumbs: { ...store().thumbs, [path]: null } });
  } finally {
    thumbRequests.delete(path);
  }
}

/** Görüntüyü Geri Dönüşüm Kutusu'na taşır. */
export async function deleteShot(path: string): Promise<void> {
  try {
    await snipDelete(path, await resolveShotDir());
    patch({
      shots: store().shots.filter((s) => s.path !== path),
      lastSaved: store().lastSaved === path ? null : store().lastSaved,
    });
  } catch (err) {
    fail(err, "snip.deleteFailed");
  }
}

let initialized = false;

/** Uygulama açılışında bir kez: seçim penceresinden gelen sonuçları dinler. */
export async function initSnip(): Promise<void> {
  if (initialized) return;
  initialized = true;
  await onSnipResult(({ image, action }) => void handleResult(image, action));
}
