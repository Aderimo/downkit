import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow, ProgressBarStatus } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { AnalyzeResult, DownloadRequest } from "../types/media";
import { MEDIA_EXTENSIONS } from "./validation";
import type { ConvertRequest, LocalMediaInfo } from "../types/convert";
import type { CompressRequest } from "../types/compress";
import type { ResizeRequest } from "../types/resize";
import type { TrimRequest } from "../types/trim";
import type {
  OcrOutput,
  PixelRect,
  SnipAction,
  SnipImage,
  ShotFile,
  SnipState,
  TranslateLang,
} from "../types/snip";
import type {
  CaptureOptions,
  CaptureTarget,
  EncoderInfo,
  RecorderErrorPayload,
  RecorderSources,
  RecorderStatus,
  RecordingFile,
  SavedRecording,
} from "../types/recorder";
import type {
  EditRequest,
  LocalPreview,
  PreviewCopy,
  PreviewCopyProgress,
  ThumbPayload,
} from "../types/edit";
import type {
  DownloadProgressPayload,
  EditProgressPayload,
  FfmpegProgressPayload,
  JobCanceledPayload,
  JobCompletePayload,
  JobErrorPayload,
  JobKind,
} from "../types/jobs";

// Frontend ↔ Rust arasındaki TEK sarmalayıcı nokta. Bileşenler invoke()/listen()'i
// doğrudan çağırmaz, sadece bu modülü kullanır.

/** Tek video ya da (link yalnızca bir listeye işaret ediyorsa) oynatma listesi. */
export function analyzeUrl(url: string): Promise<AnalyzeResult> {
  return invoke("analyze_url", { url });
}

/** "watch?v=…&list=…" gibi linklerde listenin tamamını açar. */
export function analyzePlaylist(url: string): Promise<AnalyzeResult> {
  return invoke("analyze_playlist", { url });
}

export function chooseDownloadDir(): Promise<string | null> {
  return open({ directory: true, multiple: false }) as Promise<string | null>;
}

export async function chooseLocalMediaFile(): Promise<string | null> {
  const selected = await open({
    directory: false,
    multiple: false,
    filters: [{ name: "Video / Ses", extensions: MEDIA_EXTENSIONS }],
  });
  return typeof selected === "string" ? selected : null;
}

/** Altyazı (.srt) ya da hazır ayar (.json) dosyası seçtirir. */
export async function chooseTextFile(kind: "srt" | "json"): Promise<string | null> {
  const selected = await open({
    directory: false,
    multiple: false,
    filters: [{ name: kind === "srt" ? "SRT" : "JSON", extensions: [kind] }],
  });
  return typeof selected === "string" ? selected : null;
}

/** Hazır ayarları kaydedecek .json dosyasının yerini sorar. */
export async function chooseJsonSavePath(defaultName: string): Promise<string | null> {
  const path = await save({
    defaultPath: defaultName,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  return path ?? null;
}

export function textFileRead(path: string): Promise<string> {
  return invoke("text_file_read", { path });
}

export function textFileWrite(path: string, contents: string): Promise<void> {
  return invoke("text_file_write", { path, contents });
}

export function probeLocalFile(path: string): Promise<LocalMediaInfo> {
  return invoke("probe_local_file", { path });
}

export function startDownload(request: DownloadRequest): Promise<string> {
  return invoke("start_download", { request });
}

export function startConvert(request: ConvertRequest): Promise<string> {
  return invoke("start_convert", { request });
}

export function startCompress(request: CompressRequest): Promise<string> {
  return invoke("start_compress", { request });
}

export function startResize(request: ResizeRequest): Promise<string> {
  return invoke("start_resize", { request });
}

export function startTrim(request: TrimRequest): Promise<string> {
  return invoke("start_trim", { request });
}

export function startEdit(request: EditRequest): Promise<string> {
  return invoke("start_edit", { request });
}

/** Bilgisayardaki dosyayı düzenleyicide izlenebilir hale getirir. */
export function openLocalPreview(path: string): Promise<LocalPreview> {
  return invoke("open_local_preview", { path });
}

/** Kareler `editor-thumb` olaylarıyla tek tek gelir; komut hemen döner. */
export function requestEditorThumbnails(
  token: string,
  times: number[],
  height: number,
  requestId: string,
): Promise<void> {
  return invoke("editor_thumbnails", { token, times, height, requestId });
}

export function onEditorThumb(handler: (payload: ThumbPayload) => void): Promise<UnlistenFn> {
  return safeListen<ThumbPayload>("editor-thumb", handler);
}

export function getEditorWaveform(
  token: string,
  durationSeconds: number,
  buckets: number,
): Promise<number[]> {
  return invoke("editor_waveform", { token, durationSeconds, buckets });
}

export function createPreviewCopy(token: string): Promise<PreviewCopy> {
  return invoke("create_preview_copy", { token });
}

/** İmleçteki kareyi tam çözünürlükte PNG olarak Resimler\DownKit'e kaydeder. */
export function editorSaveFrame(
  token: string,
  input: string | null,
  seconds: number,
  name: string,
): Promise<string> {
  return invoke("editor_save_frame", { token, input, seconds, name });
}

export function onPreviewCopyProgress(
  handler: (payload: PreviewCopyProgress) => void,
): Promise<UnlistenFn> {
  return safeListen<PreviewCopyProgress>("preview-copy-progress", handler);
}

const CANCEL_COMMAND: Record<JobKind, string> = {
  download: "cancel_download",
  convert: "cancel_convert",
  compress: "cancel_compress",
  resize: "cancel_resize",
  trim: "cancel_trim",
  edit: "cancel_edit",
};

/** `discard`: İptal'de true (yarım dosyalar silinir), Duraklat'ta false. */
export function cancelBackendJob(kind: JobKind, jobId: string, discard = true): Promise<void> {
  return kind === "download" || kind === "edit"
    ? invoke(CANCEL_COMMAND[kind], { jobId, discard })
    : invoke(CANCEL_COMMAND[kind], { jobId });
}

/** Duraklatılmış bir düzenleyici dışa aktarımı iptal edilince indirilen bölümleri siler. */
export function discardEditWork(workKey: string): Promise<void> {
  return invoke("discard_edit_work", { workKey });
}

/** Duraklatılmış bir indirme iptal edilince yarım kalan dosyalarını siler. */
export function discardPartialDownload(target: string): Promise<void> {
  return invoke("discard_partial_download", { target });
}

export interface JobEventHandlers {
  onDownloadProgress: (payload: DownloadProgressPayload) => void;
  onFfmpegProgress: (payload: FfmpegProgressPayload) => void;
  onEditProgress: (payload: EditProgressPayload) => void;
  onComplete: (payload: JobCompletePayload) => void;
  onError: (payload: JobErrorPayload) => void;
  onCanceled: (payload: JobCanceledPayload) => void;
}

/** Tüm iş türlerinin olaylarına tek seferde abone olur. */
export async function listenJobEvents(handlers: JobEventHandlers): Promise<UnlistenFn> {
  const prefixes: JobKind[] = ["download", "convert", "compress", "resize", "trim", "edit"];
  const pending: Promise<UnlistenFn>[] = [
    listen<DownloadProgressPayload>("download-progress", (e) =>
      handlers.onDownloadProgress(e.payload),
    ),
  ];
  for (const prefix of prefixes) {
    if (prefix === "edit") {
      pending.push(
        listen<EditProgressPayload>("edit-progress", (e) => handlers.onEditProgress(e.payload)),
      );
    } else if (prefix !== "download") {
      pending.push(
        listen<FfmpegProgressPayload>(`${prefix}-progress`, (e) =>
          handlers.onFfmpegProgress(e.payload),
        ),
      );
    }
    pending.push(
      listen<JobCompletePayload>(`${prefix}-complete`, (e) => handlers.onComplete(e.payload)),
      listen<JobErrorPayload>(`${prefix}-error`, (e) => handlers.onError(e.payload)),
      listen<JobCanceledPayload>(`${prefix}-canceled`, (e) => handlers.onCanceled(e.payload)),
    );
  }
  const unlisteners = await Promise.all(pending);
  return () => unlisteners.forEach((fn) => fn());
}

export function revealInFolder(path: string): Promise<void> {
  return revealItemInDir(path);
}

export function openMediaFile(path: string): Promise<void> {
  return invoke("open_media_file", { path });
}

export function openOriginalUrl(url: string): Promise<void> {
  return openUrl(url);
}

/** Yapımcı sayfası, Discord gibi dış bağlantıları varsayılan tarayıcıda açar. */
export function openExternalLink(url: string): Promise<void> {
  return openUrl(url);
}

export function getYtdlpVersion(): Promise<string> {
  return invoke("get_ytdlp_version");
}

export function updateYtdlp(): Promise<string> {
  return invoke("update_ytdlp");
}

export interface ToolVersions {
  ytdlp: string | null;
  ffmpeg: string | null;
  deno: string | null;
}

/** Kurulu araçların sürümleri; kurulu olmayanı indirmez (null döner). */
export function getToolVersions(): Promise<ToolVersions> {
  return invoke("get_tool_versions");
}

/** Kurulumla mı ("installed") yoksa kurulumsuz exe olarak mı ("portable") çalışıyor. */
export async function getInstallKind(): Promise<"installed" | "portable"> {
  try {
    return await invoke<"installed" | "portable">("install_kind");
  } catch {
    return "portable";
  }
}

export function openAppDataDir(): Promise<void> {
  return invoke("open_app_data_dir");
}

export function openFolder(path: string): Promise<void> {
  return invoke("open_folder", { path });
}

export function getAppVersion(): Promise<string> {
  return getVersion();
}

/** Exe'ye gömülü yapımcı imzası (sürüm, yapımcı, lisans, resmi kaynak). */
export function getAppSignature(): Promise<string> {
  return invoke("app_signature");
}

export async function readClipboardText(): Promise<string | null> {
  try {
    return await readText();
  } catch {
    return null;
  }
}

// Pencere/webview yardımcıları Tauri dışında (ör. tarayıcıda önizleme) senkron
// hata fırlatır; bir efektte fırlayınca tüm arayüz çöker. Bu yüzden sarılırlar.
const noop: UnlistenFn = () => {};

async function safeListen<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  try {
    return await listen<T>(event, (e) => handler(e.payload));
  } catch {
    return noop;
  }
}

export async function onWindowFocus(handler: () => void): Promise<UnlistenFn> {
  try {
    return await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) handler();
    });
  } catch {
    return noop;
  }
}

export async function isWindowFocused(): Promise<boolean> {
  try {
    return await getCurrentWindow().isFocused();
  } catch {
    return true;
  }
}

/** Görev çubuğu simgesinde ilerleme; `null` göstergeyi kaldırır. */
export async function setTaskbarProgress(percent: number | null): Promise<void> {
  try {
    await getCurrentWindow().setProgressBar(
      percent === null
        ? { status: ProgressBarStatus.None }
        : { status: ProgressBarStatus.Normal, progress: Math.round(percent) },
    );
  } catch {
    // Görev çubuğu ilerlemesi yalnızca bir süs; desteklenmiyorsa yok say.
  }
}

export async function notify(title: string, body: string): Promise<void> {
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
    if (granted) sendNotification({ title, body });
  } catch {
    // Bildirim gösterilemezse uygulama akışı etkilenmemeli.
  }
}

/** Pencereye sürüklenip bırakılan dosyaların yolları. */
export async function onFileDrop(
  handler: (paths: string[]) => void,
  onHover?: (hovering: boolean) => void,
): Promise<UnlistenFn> {
  try {
    return await getCurrentWebview().onDragDropEvent((event) => {
      const { type } = event.payload;
      if (type === "over" || type === "enter") onHover?.(true);
      if (type === "leave") onHover?.(false);
      if (type === "drop") {
        onHover?.(false);
        handler(event.payload.paths);
      }
    });
  } catch {
    return noop;
  }
}

export interface ToolDownloadPayload {
  tool: "yt-dlp" | "ffmpeg" | "deno";
  downloaded: number;
  total: number | null;
  state: "downloading" | "done" | "failed";
}

/** Araçları (yt-dlp, FFmpeg) arka planda hazırlar; zaten varsa hiçbir şey indirmez. */
export function prepareTools(): Promise<void> {
  return invoke("prepare_tools");
}

export function onToolDownload(
  handler: (payload: ToolDownloadPayload) => void,
): Promise<UnlistenFn> {
  return safeListen<ToolDownloadPayload>("tool-download", handler);
}

/** Metni panoya kopyalar; olmazsa (ör. tarayıcıda) tarayıcının panosunu dener. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await writeText(text);
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
}

// --- Ekran kaydı ---

export function recorderSources(): Promise<RecorderSources> {
  return invoke("recorder_sources");
}

/** Bu yakalama için çalışan kodlayıcıyı bulur (ilk seferde dener, sonra hatırlar). */
export function recorderPrepare(target: CaptureTarget): Promise<EncoderInfo> {
  return invoke("recorder_prepare", { target });
}

/** `byApp`: kayıt, kaydedilen oyunun / uygulamanın alt klasörüne yazılır.
 * `folderFallback`: tam ekran uygulama bulunamayan ekran kayıtlarında klasör adı
 * (ör. "Ana ekran" ya da "Ekran 2"). */
export function recorderStart(
  options: CaptureOptions,
  outputDir: string,
  name: string,
  byApp: boolean,
  folderFallback?: string | null,
): Promise<void> {
  return invoke("recorder_start", { options, outputDir, name, byApp, folderFallback });
}

export function recorderStop(): Promise<SavedRecording> {
  return invoke("recorder_stop");
}

export function replayStart(options: CaptureOptions, seconds: number): Promise<void> {
  return invoke("replay_start", { options, seconds });
}

export function replayStop(): Promise<void> {
  return invoke("replay_stop");
}

export function replaySave(
  outputDir: string,
  name: string,
  byApp: boolean,
  folderFallback?: string | null,
): Promise<SavedRecording> {
  return invoke("replay_save", { outputDir, name, byApp, folderFallback });
}

/** Seçili kaynağın tam çözünürlüklü anlık görüntüsünü PNG olarak kaydeder; yolu döner. */
export function recorderScreenshot(
  target: CaptureTarget,
  outputDir: string,
  name: string,
  byApp: boolean,
  folderFallback?: string | null,
): Promise<string> {
  return invoke("recorder_screenshot", { target, outputDir, name, byApp, folderFallback });
}

export function recorderStatus(): Promise<RecorderStatus> {
  return invoke("recorder_status");
}

export function recorderDefaultDir(folder: string): Promise<string> {
  return invoke("recorder_default_dir", { folder });
}

export function recordingsList(dir: string): Promise<RecordingFile[]> {
  return invoke("recordings_list", { dir });
}

export function recordingThumbnail(path: string): Promise<string | null> {
  return invoke("recording_thumbnail", { path });
}

/** Geri Dönüşüm Kutusu'na taşır. */
export function recordingDelete(path: string, dir: string): Promise<void> {
  return invoke("recording_delete", { path, dir });
}

export function recordingRename(path: string, dir: string, name: string): Promise<string> {
  return invoke("recording_rename", { path, dir, name });
}

export function recordingRepair(path: string, dir: string): Promise<string> {
  return invoke("recording_repair", { path, dir });
}

/** Kaydın [start, end] bölümünü alır; yeni dosyanın yolu döner. `overwrite`:
 * özgün kayıt Geri Dönüşüm Kutusu'na gider, kırpılmış hâl onun adını alır. */
export function recordingTrim(
  path: string,
  dir: string,
  start: number,
  end: number,
  overwrite: boolean,
): Promise<string> {
  return invoke("recording_trim", { path, dir, start, end, overwrite });
}

/** Kaynak seçici önizlemeleri: "m:<hmonitor>" / "w:<hwnd>" → JPEG veri adresi. */
export function recorderSourceThumbs(width: number): Promise<Record<string, string>> {
  return invoke("recorder_source_thumbs", { width });
}

export function onRecorderStatus(handler: (status: RecorderStatus) => void): Promise<UnlistenFn> {
  return safeListen<RecorderStatus>("recorder-status", handler);
}

export function onRecorderSaved(handler: (saved: SavedRecording) => void): Promise<UnlistenFn> {
  return safeListen<SavedRecording>("recorder-saved", handler);
}

export function onRecorderError(
  handler: (error: RecorderErrorPayload) => void,
): Promise<UnlistenFn> {
  return safeListen<RecorderErrorPayload>("recorder-error", handler);
}

/** Her birleşim için: true boş, false başka bir programda, null tanınmadı. */
export function hotkeyProbe(accelerators: string[]): Promise<(boolean | null)[]> {
  return invoke("hotkey_probe", { accelerators });
}

/** Birleşim başka bir programda tutuluyorsa yedek klavye kancasıyla izlenir;
 * basılınca "downkit-hotkey" olayı eylem adıyla gelir. Tuş öteki programa da ulaşır. */
export function hotkeyWatch(action: string, accelerator: string): Promise<void> {
  return invoke("hotkey_watch", { action, accelerator });
}

/** Tek eylemin kanca izlemesini bırakır. */
export function hotkeyUnwatch(action: string): Promise<void> {
  return invoke("hotkey_unwatch", { action });
}

/** Bütün kanca izlemelerini temizler. */
export function hotkeyUnwatchAll(): Promise<void> {
  return invoke("hotkey_unwatch_all");
}

/** Kancadan gelen kısayol tetiklemeleri; yük eylem adıdır ("record" gibi). */
export function onHotkeyHook(handler: (action: string) => void): Promise<UnlistenFn> {
  return safeListen<string>("downkit-hotkey", handler);
}

/** Açık ses kaynaklarının seviyeleri (0–1, saniyede 20): sistem sesi, mikrofon sırasıyla. */
export function onRecorderLevels(handler: (levels: number[]) => void): Promise<UnlistenFn> {
  return safeListen<number[]>("recorder-levels", handler);
}

// ——— Ekran görüntüsü aracı (snip): bölge seçme, OCR, çeviri ———

/** Bölge seçimini başlatır. `mode`: seçimde Enter'ın yapacağı iş. `hideMain`:
 * DownKit'teki düğmeyle başladıysa önce ana pencere gizlenir (yoksa görüntüde
 * DownKit'in kendisi olur). `full`: seçim yok, ekranın tamamı doğrudan `mode` işine.
 * `delay`: yakalamadan önce beklenecek saniye. */
export function snipStart(
  mode: SnipAction,
  hideMain: boolean,
  full = false,
  delay = 0,
): Promise<void> {
  return invoke("snip_start", { mode, hideMain, full, delay });
}

/** Ekran görüntüsü klasöründeki görüntüler, en yeni önce. */
export function snipList(dir: string): Promise<ShotFile[]> {
  return invoke("snip_list", { dir });
}

/** Görüntünün küçük resminin adresi. */
export function snipThumbnail(path: string): Promise<string> {
  return invoke("snip_thumbnail", { path });
}

/** Görüntüyü Geri Dönüşüm Kutusu'na taşır. */
export function snipDelete(path: string, dir: string): Promise<void> {
  return invoke("snip_delete", { path, dir });
}

export function snipState(): Promise<SnipState | null> {
  return invoke("snip_state");
}

export function snipShow(): Promise<void> {
  return invoke("snip_show");
}

/** Seçim bitti; `rect` null ise vazgeçildi. */
export function snipFinish(rect: PixelRect | null, action: SnipAction): Promise<void> {
  return invoke("snip_finish", { rect, action });
}

export function snipOpenFile(path: string): Promise<SnipImage> {
  return invoke("snip_open_file", { path });
}

export function snipDefaultDir(): Promise<string> {
  return invoke("snip_default_dir");
}

/** Kırpılmış (düzenlenmemiş) seçimi panoya kopyalar. */
export function snipCopy(path: string): Promise<void> {
  return invoke("snip_copy", { path });
}

/** Kırpılmış seçimi klasöre kaydeder; yeni dosyanın yolu döner. */
export function snipSave(path: string, dir: string, name: string): Promise<string> {
  return invoke("snip_save", { path, dir, name });
}

// Başlıklar ASCII olmalı: Türkçe klasör adları yüzde kodlanır.
const headerValue = (value: string) => encodeURIComponent(value);

/** Düzenlenmiş görüntüyü (dosya baytları) kaydeder; yolu döner. */
export async function imageWrite(
  bytes: Uint8Array,
  dir: string,
  name: string,
  ext: "png" | "jpg" | "webp",
): Promise<string> {
  return invoke("image_write", bytes, {
    headers: { "x-dir": headerValue(dir), "x-name": headerValue(name), "x-ext": ext },
  });
}

/** PNG baytlarını panoya görüntü olarak kopyalar. */
export function imageCopy(png: Uint8Array): Promise<void> {
  return invoke("image_copy", png);
}

export function ocrImage(path: string, language: string | null): Promise<OcrOutput> {
  return invoke("ocr_image", { path, language });
}

export function translateText(
  text: string,
  from: TranslateLang,
  to: TranslateLang,
): Promise<string> {
  return invoke("translate_text", { text, from, to });
}

/** Seçim penceresinden gelen kırpılmış görüntü ve istenen iş. */
export function onSnipResult(
  handler: (result: { image: SnipImage; action: SnipAction }) => void,
): Promise<UnlistenFn> {
  return safeListen("snip-result", handler);
}

/** Seçim penceresi yeniden kullanılınca (ikinci seçimde) gelir. */
export function onSnipOpen(handler: () => void): Promise<UnlistenFn> {
  return safeListen("snip-open", handler);
}

export async function chooseImageFile(): Promise<string | null> {
  const selected = await open({
    directory: false,
    multiple: false,
    filters: [{ name: "PNG / JPEG / WebP", extensions: ["png", "jpg", "jpeg", "webp"] }],
  });
  return typeof selected === "string" ? selected : null;
}
