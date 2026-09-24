import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow, ProgressBarStatus } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
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
  DownloadProgressPayload,
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

const CANCEL_COMMAND: Record<JobKind, string> = {
  download: "cancel_download",
  convert: "cancel_convert",
  compress: "cancel_compress",
  resize: "cancel_resize",
  trim: "cancel_trim",
};

/** `discard`: İptal'de true (yarım dosyalar silinir), Duraklat'ta false. */
export function cancelBackendJob(kind: JobKind, jobId: string, discard = true): Promise<void> {
  return kind === "download"
    ? invoke(CANCEL_COMMAND[kind], { jobId, discard })
    : invoke(CANCEL_COMMAND[kind], { jobId });
}

/** Duraklatılmış bir indirme iptal edilince yarım kalan dosyalarını siler. */
export function discardPartialDownload(target: string): Promise<void> {
  return invoke("discard_partial_download", { target });
}

export interface JobEventHandlers {
  onDownloadProgress: (payload: DownloadProgressPayload) => void;
  onFfmpegProgress: (payload: FfmpegProgressPayload) => void;
  onComplete: (payload: JobCompletePayload) => void;
  onError: (payload: JobErrorPayload) => void;
  onCanceled: (payload: JobCanceledPayload) => void;
}

/** Tüm iş türlerinin olaylarına tek seferde abone olur. */
export async function listenJobEvents(handlers: JobEventHandlers): Promise<UnlistenFn> {
  const prefixes: JobKind[] = ["download", "convert", "compress", "resize", "trim"];
  const pending: Promise<UnlistenFn>[] = [
    listen<DownloadProgressPayload>("download-progress", (e) =>
      handlers.onDownloadProgress(e.payload),
    ),
  ];
  for (const prefix of prefixes) {
    if (prefix !== "download") {
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

export function openAppDataDir(): Promise<void> {
  return invoke("open_app_data_dir");
}

export function openFolder(path: string): Promise<void> {
  return invoke("open_folder", { path });
}

export function getAppVersion(): Promise<string> {
  return getVersion();
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
