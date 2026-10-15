// Dışa aktarma profilleri: tek tıkla platforma uygun çerçeve, boyut sınırı ve ses
// seviyesi. Varsayılanlar programın içinde; GitHub deposundaki `platforms.json` daha
// yeniyse ondan güncellenir (platform kuralları değişince programı güncellemeden), son
// geçerli liste yerel olarak saklanır. Bilinmeyen alanlar ve bozuk kayıtlar atılır.

import { create } from "zustand";
import { PROFILES_URL } from "./links";
import type { ExportOptions } from "../store/editorStore";

export { PROFILES_URL };
const CACHE_KEY = "downkit.platformProfiles";

export interface PlatformProfile {
  /** Çeviri anahtarı: editor.presetName.<id> (yoksa `name`). */
  id: string;
  /** Uzak profilde görünen ad (çevirisi yoksa). */
  name?: string;
  patch: Partial<
    Pick<ExportOptions, "frame" | "frameFit" | "frameBlur" | "targetSizeMb" | "loudness">
  >;
}

export const DEFAULT_PROFILES: PlatformProfile[] = [
  {
    id: "tiktok",
    patch: { frame: "9:16", frameFit: true, frameBlur: true, targetSizeMb: null, loudness: true },
  },
  { id: "youtube", patch: { frame: "original", targetSizeMb: null, loudness: true } },
  { id: "discord", patch: { frame: "original", targetSizeMb: 10 } },
  {
    id: "instagram",
    patch: { frame: "4:5", frameFit: true, frameBlur: true, targetSizeMb: null, loudness: true },
  },
  { id: "whatsapp", patch: { frame: "original", targetSizeMb: 16 } },
];

const FRAMES = new Set(["original", "9:16", "1:1", "4:5", "16:9"]);

/** Uzak/kayıtlı listeyi doğrular; geçerli profil yoksa null. */
export function parseProfiles(raw: unknown): PlatformProfile[] | null {
  const list = (raw as { profiles?: unknown } | null)?.profiles;
  if (!Array.isArray(list)) return null;
  const out: PlatformProfile[] = [];
  for (const item of list.slice(0, 20)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== "string" || !/^[a-z0-9-]{1,32}$/.test(r.id)) continue;
    const p = (r.patch ?? {}) as Record<string, unknown>;
    const patch: PlatformProfile["patch"] = {};
    if (typeof p.frame === "string" && FRAMES.has(p.frame))
      patch.frame = p.frame as ExportOptions["frame"];
    if (typeof p.frameFit === "boolean") patch.frameFit = p.frameFit;
    if (typeof p.frameBlur === "boolean") patch.frameBlur = p.frameBlur;
    if (
      p.targetSizeMb === null ||
      (typeof p.targetSizeMb === "number" && p.targetSizeMb >= 1 && p.targetSizeMb <= 4000)
    ) {
      patch.targetSizeMb = p.targetSizeMb as number | null;
    }
    if (typeof p.loudness === "boolean") patch.loudness = p.loudness;
    if (Object.keys(patch).length === 0) continue;
    out.push({
      id: r.id,
      ...(typeof r.name === "string" ? { name: r.name.slice(0, 32) } : {}),
      patch,
    });
  }
  return out.length ? out : null;
}

function cached(): PlatformProfile[] {
  try {
    return parseProfiles(JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null")) ?? DEFAULT_PROFILES;
  } catch {
    return DEFAULT_PROFILES;
  }
}

export const usePlatformProfiles = create<{ profiles: PlatformProfile[] }>(() => ({
  profiles: cached(),
}));

let fetched = false;

/** Sürüm deposundaki güncel profilleri bir kez sorar; yoksa ya da bozuksa eldekiler kalır. */
export async function refreshProfiles(fetcher: typeof fetch = fetch): Promise<void> {
  if (fetched) return;
  fetched = true;
  try {
    const res = await fetcher(PROFILES_URL, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as unknown;
    const profiles = parseProfiles(data);
    if (!profiles) return;
    usePlatformProfiles.setState({ profiles });
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ profiles }));
    } catch {
      // Saklanamazsa bir sonraki açılışta yine sorulur.
    }
  } catch {
    // Çevrimdışı: programdaki ya da son kaydedilen liste kullanılır.
  }
}
