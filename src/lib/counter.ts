// Sayaç: kaç kişi indirdi, kaç kişi kullanıyor.
//
// İndirme sayısı GitHub'ın herkese açık sürüm API'sinden gelir (her release
// dosyasının indirilme sayısı). Eski release'ler silindiğinde onların sayıları
// API'den düşer; o yüzden silme anındaki toplam BASELINE_DOWNLOADS'ta sabitlenir
// ve üstüne API'deki güncel sayılar eklenir.
//
// Aktif kullanıcı sayısı ancak küçük bir sunucuyla ölçülebilir: program günde
// bir kez rastgele bir kimlik + sürüm + gün bilgisini sayaç adresine gönderir
// (kişisel veri yok; Ayarlar'dan kapatılabilir). Sunucu henüz kurulmadıysa
// COUNTER_URL boştur: ping atılmaz ve arayüzde "—" gösterilir.
// Kurulum: counter-worker/README.md (ücretsiz Cloudflare Worker + D1).

import { GITHUB_REPO } from "./links";
import { getSettings, useSettingsStore } from "./appSettings";
import { getAppVersion } from "./tauri-api";

/** Silinen eski release'lerin indirme toplamı (v0.1.0, 2026-09-28 GitHub API: 2). */
export const BASELINE_DOWNLOADS = 2;

/** Aktif kullanıcı sayacının adresi; boşsa özellik kapalıdır. */
export const COUNTER_URL = "";

/** Ping'in en az bu kadar saat arayla atılması yeterli. */
const HEARTBEAT_INTERVAL_MS = 20 * 60 * 60 * 1000;

export interface DownloadStats {
  /** Baseline + GitHub'daki tüm release dosyalarının indirme toplamı. */
  total: number;
  /** Release başına kırılım (etiket → indirme). */
  perRelease: { tag: string; count: number }[];
}

interface GithubAsset {
  name?: string;
  download_count?: number;
}

interface GithubRelease {
  tag_name?: string;
  assets?: GithubAsset[];
}

export async function fetchDownloadStats(): Promise<DownloadStats> {
  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=100`,
    { headers: { Accept: "application/vnd.github+json" } },
  );
  if (!response.ok) throw new Error(`GitHub yanıtı: ${response.status}`);
  const releases = (await response.json()) as GithubRelease[];
  const perRelease = (Array.isArray(releases) ? releases : []).map((release) => ({
    tag: release.tag_name ?? "?",
    count: (release.assets ?? []).reduce((sum, a) => sum + (a.download_count ?? 0), 0),
  }));
  return {
    total: BASELINE_DOWNLOADS + perRelease.reduce((sum, r) => sum + r.count, 0),
    perRelease,
  };
}

/** Son 30 günde aktif kullanıcı sayısı; sayaç sunucusu yoksa null. */
export async function fetchActiveUsers(): Promise<number | null> {
  if (!COUNTER_URL) return null;
  const response = await fetch(`${COUNTER_URL}/stats`);
  if (!response.ok) throw new Error(`Sayaç yanıtı: ${response.status}`);
  const data = (await response.json()) as { active30?: number };
  return typeof data.active30 === "number" ? data.active30 : null;
}

/** Günde bir kez anonim ping. Ayarlardan kapatılabilir; hata sessizce yutulur. */
export async function initCounter(): Promise<void> {
  const settings = getSettings();
  if (!COUNTER_URL || !settings.counterOptIn) return;
  if (settings.lastHeartbeat && Date.now() - settings.lastHeartbeat < HEARTBEAT_INTERVAL_MS) return;
  let installId = settings.installId;
  if (!installId) {
    installId = crypto.randomUUID();
    useSettingsStore.getState().update({ installId });
  }
  try {
    const version = await getAppVersion();
    const day = new Date().toISOString().slice(0, 10);
    const response = await fetch(`${COUNTER_URL}/beat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: installId, version, day }),
    });
    if (response.ok) useSettingsStore.getState().update({ lastHeartbeat: Date.now() });
  } catch {
    // Sayaç hiçbir zaman programı etkilememeli.
  }
}
