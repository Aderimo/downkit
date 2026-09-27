import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";

// Tarayıcıdan gönderme: "downkit://open?url=…" linki Ana Sayfa'da analiz eder,
// "downkit://edit?url=…" Klip Düzenleyici'de açar. Hiçbir şey kendiliğinden inmez.

export interface DeepLinkTarget {
  action: "open" | "edit";
  url: string;
}

export function parseDeepLink(raw: string): DeepLinkTarget | null {
  try {
    const link = new URL(raw);
    if (link.protocol !== "downkit:") return null;
    const action = (link.hostname || link.pathname.replace(/^\/+/, "")).toLowerCase();
    const target = link.searchParams.get("url");
    if (!target || !/^https?:\/\//i.test(target)) return null;
    return { action: action === "edit" ? "edit" : "open", url: target };
  } catch {
    return null;
  }
}

/** Tarayıcıdaki yer imi için kod: tıklandığı sayfanın adresini DownKit'e gönderir. */
export function bookmarklet(action: DeepLinkTarget["action"]): string {
  return `javascript:void(location.href='downkit://${action}?url='+encodeURIComponent(location.href))`;
}

export async function initDeepLinks(handle: (target: DeepLinkTarget) => void): Promise<void> {
  const dispatch = (urls: string[] | null) => {
    const target = urls?.map(parseDeepLink).find((t) => t !== null);
    if (target) handle(target);
  };
  try {
    // Program bir bağlantıyla açıldıysa ilk bağlantı; açıkken gelenler olayla.
    dispatch(await getCurrent());
    await onOpenUrl(dispatch);
  } catch {
    // Tauri dışında (tarayıcıda arayüz önizlemesi) bağlantı yok.
  }
}
