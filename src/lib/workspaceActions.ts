import i18n from "../i18n";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useSearchStore } from "./recentSearches";
import { checkSupportedUrl } from "./validation";
import { analyzePlaylist, analyzeUrl } from "./tauri-api";
import { localizeError } from "./errors";
import { getSettings } from "./appSettings";
import type { AnalyzeResult } from "../types/media";

function rememberSearch(entry: {
  url: string;
  title: string | null;
  thumbnailUrl: string | null;
  platform: string | null;
}) {
  if (getSettings().keepHistory) useSearchStore.getState().add(entry);
}

function applyResult(url: string, result: AnalyzeResult) {
  const ws = useWorkspaceStore.getState();
  if (result.kind === "playlist") {
    ws.playlistLoaded(url, result);
    rememberSearch({
      url,
      title: result.title,
      thumbnailUrl: result.entries[0]?.thumbnailUrl ?? null,
      platform: result.platform,
    });
    return;
  }
  ws.analyzeSucceeded(url, result);
  rememberSearch({
    url,
    title: result.title,
    thumbnailUrl: result.thumbnailUrl,
    platform: result.platform,
  });
}

async function run(url: string, analyze: (url: string) => Promise<AnalyzeResult>) {
  const ws = useWorkspaceStore.getState();
  ws.startAnalyze();
  try {
    const result = await analyze(url);
    // Bu arada kullanıcı başka bir link yapıştırdıysa eski sonucu yazma.
    if (useWorkspaceStore.getState().url.trim() !== url) return;
    applyResult(url, result);
  } catch (err) {
    if (useWorkspaceStore.getState().url.trim() !== url) return;
    const error = localizeError(err, "error.analyzeFailed");
    useWorkspaceStore.getState().analyzeFailed(error.message, error.detail);
  }
}

/** Linki analiz edip çalışma alanına yükler ve arama geçmişine ekler.
 * Ana sayfa ile Geçmiş sayfası ("Tekrar analiz et") aynı yolu kullanır. */
export async function analyzeLink(rawUrl: string): Promise<void> {
  const ws = useWorkspaceStore.getState();
  const url = rawUrl.trim();
  ws.setUrl(url);

  const result = checkSupportedUrl(url);
  if (result.status !== "ok") {
    ws.analyzeFailed(
      i18n.t(result.status === "unsupported" ? "validation.unsupported" : "validation.invalid"),
      null,
    );
    return;
  }

  // Arama hemen kaydedilir (analiz başarısız olsa da geçmişte görünsün);
  // başarılı olunca başlık ve küçük resimle güncellenir.
  const previous = useSearchStore.getState().entries.find((e) => e.url === url);
  rememberSearch({
    url,
    title: previous?.title ?? null,
    thumbnailUrl: previous?.thumbnailUrl ?? null,
    platform: previous?.platform ?? result.platform,
  });
  await run(url, analyzeUrl);
}

/** "watch?v=…&list=…" linkinde listenin tamamını açar. */
export async function openPlaylist(url: string): Promise<void> {
  useWorkspaceStore.getState().setUrl(url);
  await run(url, analyzePlaylist);
}

/** Link hem bir videoya hem bir oynatma listesine işaret ediyorsa (YouTube
 * "watch?v=…&list=…") true. Yalnızca listeye işaret eden linkler zaten liste
 * olarak açılır. */
export function hasPlaylistParam(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\.|^m\.|^music\./, "");
    if (host !== "youtube.com") return false;
    const list = parsed.searchParams.get("list");
    // "RD…" listeleri YouTube'un otomatik karışımlarıdır; sonsuz ve kişiye özel.
    return !!list && !list.startsWith("RD") && parsed.searchParams.has("v");
  } catch {
    return false;
  }
}
