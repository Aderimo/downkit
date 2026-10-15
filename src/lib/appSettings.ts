import { create } from "zustand";
import { AUDIO_FORMATS, VIDEO_FORMATS, type OutputFormat } from "../types/media";
import { normalizeBackground, DEFAULT_BACKGROUND, type BackgroundSettings } from "./background";
import {
  DEFAULT_CUSTOM_COLORS,
  DEFAULT_THEME,
  isThemeChoice,
  normalizeCustomColors,
  type CustomColors,
  type ThemeChoice,
} from "./themes";

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
/** Arayüz boyutu: normal, büyük, çok büyük. */
export const UI_SCALES = [1, 1.1, 1.25] as const;
export const DEFAULT_HEIGHTS = [null, 2160, 1440, 1080, 720, 480] as const;

/** Pencere kapatılınca: işlem sürerken tepsiye küçült / her zaman / programı kapat. */
export const CLOSE_BEHAVIORS = ["whileBusy", "always", "never"] as const;
export type CloseBehavior = (typeof CLOSE_BEHAVIORS)[number];

export interface AppSettings {
  /** İndirilenlerin ve dışa aktarımların klasörü; boşsa ilk işte sorulur. */
  defaultDownloadDir: string | null;
  /** Aynı anda çalışacak iş sayısı (indirme + dönüştürme vb.; dışa aktarma tek tek). */
  concurrency: number;
  filenameTemplate: string;
  /** Pencere öne gelince panodaki desteklenen linki önerir; asla kendiliğinden indirmez. */
  clipboardSuggest: boolean;
  /** İndir sayfasının açılıştaki formatı ve kalitesi. */
  defaultOutputFormat: OutputFormat;
  defaultMaxHeight: number | null;
  subtitleLangs: string[];
  /** Otomatik (makine) altyazılar; YouTube'un otomatik çevirileri sık kısıtlanır. */
  autoSubtitles: boolean;
  /** İndirme hızı sınırı (KB/s); null = sınırsız. */
  rateLimitKbps: number | null;
  /** Açılışta birkaç günde bir yt-dlp güncellemesini kontrol et. */
  autoUpdateYtdlp: boolean;
  lastYtdlpUpdateCheck: number | null;
  /** Kapalıysa indirilenler ve aramalar geçmişe yazılmaz. */
  keepHistory: boolean;
  /** İndirilenleri platforma göre alt klasörlere ayır ("YouTube/…", "Kick/…"). */
  groupByPlatform: boolean;
  /** YouTube indirmelerinde sponsor bölümlerini çıkar (SponsorBlock). */
  sponsorBlock: boolean;
  /** Klip / kayıt kaydedilince kısa bir ses çal. */
  soundOnSave: boolean;
  /** Pencere arka plandayken biten dışa aktarımlar için Windows bildirimi. */
  notifyOnComplete: boolean;
  /** Dışa aktarım bitince dosyayı Gezgin'de göster. */
  revealOnComplete: boolean;
  closeBehavior: CloseBehavior;
  /** Açılışta yeni sürüm var mı bak. */
  checkUpdates: boolean;
  /** Açılışta tanıtım turunu göster; turdaki "Bir daha gösterme" ile kapanır. */
  showTutorial: boolean;
  /** Sol menü yalnızca simgeler (daha geniş çalışma alanı). */
  sidebarCollapsed: boolean;
  /** Bir sayfa ilk kez açılınca o sayfanın turunu göster. */
  pageTours: boolean;
  /** Renk teması (bkz. themes.ts); "custom" ise customColors kullanılır. */
  theme: ThemeChoice;
  /** Özel temanın renkleri. */
  customColors: CustomColors;
  /** Özel arka plan resmi ayarları (resmin kendisi uygulama klasöründe). */
  background: BackgroundSettings;
  /** Arayüz boyutu (yazılar, düğmeler); bkz. UI_SCALES. */
  uiScale: number;
  /** Gelişmiş ayarlar (çözünürlük, bit hızı, ekran kartı…) görünsün mü. Kapalıyken
   * yalnızca varsayılan değerindeki gelişmiş ayarlar gizlenir. */
  advanced: boolean;
  /** İlk açılış sihirbazı tamamlandı (ya da atlandı). */
  setupDone: boolean;
  /** "Yenilikler" penceresinin en son gösterildiği program sürümü. */
  lastSeenVersion: string | null;
  /** Kullanıcının kendi Discord kanalının webhook bağlantısı ("Discord'a gönder"). */
  discordWebhook: string | null;
}

/** Yalnızca discord.com webhook adresleri (Rust `share::is_discord_webhook` ile aynı). */
export function isDiscordWebhook(url: string): boolean {
  return /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(
    url.trim(),
  );
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultDownloadDir: null,
  concurrency: 2,
  filenameTemplate: "{title}",
  clipboardSuggest: true,
  defaultOutputFormat: "mp4",
  defaultMaxHeight: null,
  subtitleLangs: ["tr", "en"],
  autoSubtitles: true,
  rateLimitKbps: null,
  autoUpdateYtdlp: true,
  lastYtdlpUpdateCheck: null,
  keepHistory: true,
  groupByPlatform: true,
  sponsorBlock: false,
  soundOnSave: true,
  notifyOnComplete: true,
  revealOnComplete: false,
  closeBehavior: "whileBusy",
  checkUpdates: true,
  showTutorial: true,
  sidebarCollapsed: false,
  pageTours: true,
  theme: DEFAULT_THEME,
  customColors: DEFAULT_CUSTOM_COLORS,
  background: DEFAULT_BACKGROUND,
  uiScale: 1,
  advanced: false,
  setupDone: false,
  lastSeenVersion: null,
  discordWebhook: null,
};

const FORMATS: readonly string[] = [...VIDEO_FORMATS, ...AUDIO_FORMATS];

/** Kayıtlı ayarları okur; eksik ya da bozuk alanlar varsayılana döner (eski
 * sürümlerin daha az alanlı kaydı da böylece sorunsuz açılır). */
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
    defaultOutputFormat: FORMATS.includes(r.defaultOutputFormat as string)
      ? (r.defaultOutputFormat as OutputFormat)
      : d.defaultOutputFormat,
    defaultMaxHeight: numOrNull(r.defaultMaxHeight, DEFAULT_HEIGHTS, d.defaultMaxHeight),
    subtitleLangs: langs.length > 0 ? langs : d.subtitleLangs,
    autoSubtitles: bool(r.autoSubtitles, d.autoSubtitles),
    rateLimitKbps: numOrNull(r.rateLimitKbps, RATE_LIMITS_KBPS, d.rateLimitKbps),
    autoUpdateYtdlp: bool(r.autoUpdateYtdlp, d.autoUpdateYtdlp),
    lastYtdlpUpdateCheck:
      typeof r.lastYtdlpUpdateCheck === "number" ? r.lastYtdlpUpdateCheck : null,
    keepHistory: bool(r.keepHistory, d.keepHistory),
    groupByPlatform: bool(r.groupByPlatform, d.groupByPlatform),
    sponsorBlock: bool(r.sponsorBlock, d.sponsorBlock),
    soundOnSave: bool(r.soundOnSave, d.soundOnSave),
    notifyOnComplete: bool(r.notifyOnComplete, d.notifyOnComplete),
    revealOnComplete: bool(r.revealOnComplete, d.revealOnComplete),
    closeBehavior: CLOSE_BEHAVIORS.includes(r.closeBehavior as CloseBehavior)
      ? (r.closeBehavior as CloseBehavior)
      : d.closeBehavior,
    checkUpdates: bool(r.checkUpdates, d.checkUpdates),
    showTutorial: bool(r.showTutorial, d.showTutorial),
    sidebarCollapsed: bool(r.sidebarCollapsed, d.sidebarCollapsed),
    pageTours: bool(r.pageTours, d.pageTours),
    theme: isThemeChoice(r.theme) ? r.theme : d.theme,
    customColors: normalizeCustomColors(r.customColors),
    background: normalizeBackground(r.background),
    uiScale: UI_SCALES.includes(r.uiScale as 1) ? (r.uiScale as number) : d.uiScale,
    advanced: bool(r.advanced, d.advanced),
    setupDone: bool(r.setupDone, d.setupDone),
    lastSeenVersion: typeof r.lastSeenVersion === "string" ? r.lastSeenVersion : null,
    discordWebhook:
      typeof r.discordWebhook === "string" && isDiscordWebhook(r.discordWebhook)
        ? r.discordWebhook.trim()
        : null,
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
  /** Dışa aktarma klasörü (ve kurulum bilgisi) korunarak her şeyi varsayılana döndürür. */
  reset: () => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...load(),
  update: (patch) => {
    set(patch);
    save(pickSettings(get()));
  },
  reset: () => {
    // Sihirbaz yeniden açılmaz: kurulum bir kez yapılır.
    set({
      ...DEFAULT_SETTINGS,
      defaultDownloadDir: get().defaultDownloadDir,
      setupDone: get().setupDone,
    });
    save(pickSettings(get()));
  },
}));

export function getSettings(): AppSettings {
  return useSettingsStore.getState();
}
