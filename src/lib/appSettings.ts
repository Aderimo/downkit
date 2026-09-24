import { create } from "zustand";
import { AUDIO_FORMATS, VIDEO_FORMATS, type OutputFormat } from "../types/media";

const STORAGE_KEY = "downkit.settings";
const LEGACY_DIR_KEY = "downkit.defaultDownloadDir";

export const FILENAME_TEMPLATES = [
  "{title}",
  "{title} [{id}]",
  "{uploader} - {title}",
  "{date} - {title}",
] as const;

/** Ayarlar'da sunulan altyazı dilleri (yt-dlp dil kodu → kendi dilindeki adı). */
export const SUBTITLE_LANGUAGES: { code: string; label: string }[] = [
  { code: "tr", label: "Türkçe" },
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
  { code: "ar", label: "العربية" },
  { code: "ru", label: "Русский" },
  { code: "it", label: "Italiano" },
  { code: "pt", label: "Português" },
  { code: "ja", label: "日本語" },
];

export const RATE_LIMITS_KBPS = [null, 1024, 2048, 5120, 10240] as const;
/** Pencere kapatılınca: işlem sürerken tepsiye küçült / her zaman / programı kapat. */
export const CLOSE_BEHAVIORS = ["whileBusy", "always", "never"] as const;
export type CloseBehavior = (typeof CLOSE_BEHAVIORS)[number];
export const DEFAULT_HEIGHTS = [null, 2160, 1440, 1080, 720, 480] as const;

export interface AppSettings {
  defaultDownloadDir: string | null;
  /** Aynı anda çalışacak iş sayısı (indirme + dönüştürme vb.). */
  concurrency: number;
  filenameTemplate: string;
  /** Pencere öne gelince panodaki desteklenen linki önerir; asla kendiliğinden indirmez. */
  clipboardSuggest: boolean;
  /** Pencere arka plandayken biten işler için Windows bildirimi. */
  notifyOnComplete: boolean;
  /** Ana Sayfa'nın açılıştaki formatı ve kalitesi. */
  defaultOutputFormat: OutputFormat;
  defaultMaxHeight: number | null;
  subtitleLangs: string[];
  /** Otomatik (makine) altyazılar; YouTube'un otomatik çevirileri sık kısıtlanır. */
  autoSubtitles: boolean;
  /** İndirme hızı sınırı (KB/s); null = sınırsız. */
  rateLimitKbps: number | null;
  /** İş bitince dosyayı Gezgin'de göster. */
  revealOnComplete: boolean;
  /** Açılışta birkaç günde bir yt-dlp güncellemesini kontrol et. */
  autoUpdateYtdlp: boolean;
  lastYtdlpUpdateCheck: number | null;
  /** Kapalıysa indirilenler ve aramalar geçmişe yazılmaz. */
  keepHistory: boolean;
  /** İndirilenleri platforma göre alt klasörlere ayır ("YouTube/…", "Kick/…"). */
  groupByPlatform: boolean;
  closeBehavior: CloseBehavior;
  /** Açılışta GitHub'da yeni DownKit sürümü var mı bak. */
  checkUpdates: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultDownloadDir: null,
  concurrency: 2,
  filenameTemplate: "{title}",
  clipboardSuggest: true,
  notifyOnComplete: true,
  defaultOutputFormat: "mp4",
  defaultMaxHeight: null,
  subtitleLangs: ["tr", "en"],
  autoSubtitles: true,
  rateLimitKbps: null,
  revealOnComplete: false,
  autoUpdateYtdlp: true,
  lastYtdlpUpdateCheck: null,
  keepHistory: true,
  groupByPlatform: false,
  closeBehavior: "whileBusy",
  checkUpdates: true,
};

const FORMATS: readonly string[] = [...VIDEO_FORMATS, ...AUDIO_FORMATS];

/** Kayıtlı ayarları okur; eksik ya da bozuk alanlar varsayılana döner. Eski
 * sürümlerin kaydı (daha az alan) da böylece sorunsuz açılır. */
export function normalizeSettings(raw: unknown, legacyDir: string | null = null): AppSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<
    Record<keyof AppSettings, unknown>
  >;
  const d = DEFAULT_SETTINGS;
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  const numOrNull = (v: unknown, allowed: readonly (number | null)[], fallback: number | null) =>
    allowed.includes(v as number | null) ? (v as number | null) : fallback;
  const langs = Array.isArray(r.subtitleLangs)
    ? r.subtitleLangs.filter(
        (l): l is string =>
          typeof l === "string" && SUBTITLE_LANGUAGES.some((lang) => lang.code === l),
      )
    : d.subtitleLangs;

  return {
    defaultDownloadDir: typeof r.defaultDownloadDir === "string" ? r.defaultDownloadDir : legacyDir,
    concurrency:
      typeof r.concurrency === "number" && r.concurrency >= 1 && r.concurrency <= 4
        ? Math.round(r.concurrency)
        : d.concurrency,
    filenameTemplate: FILENAME_TEMPLATES.includes(
      r.filenameTemplate as (typeof FILENAME_TEMPLATES)[number],
    )
      ? (r.filenameTemplate as string)
      : d.filenameTemplate,
    clipboardSuggest: bool(r.clipboardSuggest, d.clipboardSuggest),
    notifyOnComplete: bool(r.notifyOnComplete, d.notifyOnComplete),
    defaultOutputFormat: FORMATS.includes(r.defaultOutputFormat as string)
      ? (r.defaultOutputFormat as OutputFormat)
      : d.defaultOutputFormat,
    defaultMaxHeight: numOrNull(r.defaultMaxHeight, DEFAULT_HEIGHTS, d.defaultMaxHeight),
    subtitleLangs: langs.length > 0 ? langs : d.subtitleLangs,
    autoSubtitles: bool(r.autoSubtitles, d.autoSubtitles),
    rateLimitKbps: numOrNull(r.rateLimitKbps, RATE_LIMITS_KBPS, d.rateLimitKbps),
    revealOnComplete: bool(r.revealOnComplete, d.revealOnComplete),
    autoUpdateYtdlp: bool(r.autoUpdateYtdlp, d.autoUpdateYtdlp),
    lastYtdlpUpdateCheck:
      typeof r.lastYtdlpUpdateCheck === "number" ? r.lastYtdlpUpdateCheck : null,
    keepHistory: bool(r.keepHistory, d.keepHistory),
    groupByPlatform: bool(r.groupByPlatform, d.groupByPlatform),
    closeBehavior: CLOSE_BEHAVIORS.includes(r.closeBehavior as CloseBehavior)
      ? (r.closeBehavior as CloseBehavior)
      : d.closeBehavior,
    checkUpdates: bool(r.checkUpdates, d.checkUpdates),
  };
}

// localStorage bu cihaza özel bir kolaylık; erişim her zaman try/catch ile korunur.
function load(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return normalizeSettings(raw ? JSON.parse(raw) : {}, localStorage.getItem(LEGACY_DIR_KEY));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function save(settings: AppSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Depolama kullanılamıyorsa ayarlar yalnızca bu oturumda geçerli olur.
  }
}

function pickSettings(state: AppSettings): AppSettings {
  const out = {} as Record<keyof AppSettings, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]) {
    out[key] = state[key];
  }
  return out as unknown as AppSettings;
}

interface SettingsState extends AppSettings {
  update: (patch: Partial<AppSettings>) => void;
  /** Kayıt klasörü korunarak her şeyi varsayılana döndürür. */
  reset: () => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...load(),
  update: (patch) => {
    set(patch);
    save(pickSettings(get()));
  },
  reset: () => {
    set({ ...DEFAULT_SETTINGS, defaultDownloadDir: get().defaultDownloadDir });
    save(pickSettings(get()));
  },
}));

export function getSettings(): AppSettings {
  return useSettingsStore.getState();
}
