// Renk temaları. Her tema arayüzün CSS değişkenlerini (--dk-*) belirler; bileşenler
// renkleri yalnızca bu değişkenlerden okur. Açık temalarda `text-white` gibi
// yardımcılar da okunur kalsın diye `data-mode="light"` kurulur (bkz. globals.css).

export type ThemeMode = "dark" | "light";

export interface ThemePalette {
  bg: string;
  sidebar: string;
  surface: string;
  surface2: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  accent: string;
  accent2: string;
  accentHover: string;
  /** Eski temalardan kalan alan; C tasarımında geçiş (gradient) kullanılmaz. */
  gradient?: string;
  /** Kalın çerçeve rengi; verilmezse borderStrong. */
  line?: string;
  /** Düz gölge rengi; verilmezse koyu temada vurgu, açıkta mürekkep. */
  shadow?: string;
}

export interface Theme {
  id: string;
  mode: ThemeMode;
  palette: ThemePalette;
}

export const THEMES = [
  {
    // Sakin (varsayılan): düşük doygunluk, yumuşak kontrast, parlak vurgu ya da
    // sarı gölge yok; uzun süre bakınca göz yormaz.
    id: "calm",
    mode: "dark",
    palette: {
      bg: "#16181d",
      sidebar: "#1a1d23",
      surface: "#1f2229",
      surface2: "#262a32",
      border: "#323743",
      borderStrong: "#454b59",
      text: "#e6e8ec",
      textMuted: "#a7adb9",
      accent: "#4f7fd9",
      accent2: "#7fb3a6",
      accentHover: "#8fb0ec",
      line: "#454b59",
      shadow: "#0d0f12",
    },
  },
  {
    // C · Ördek (koyu): sitedeki tasarımın program karşılığı.
    id: "ordek",
    mode: "dark",
    palette: {
      bg: "#14130f",
      sidebar: "#191812",
      surface: "#1e1d18",
      surface2: "#27261f",
      border: "#3a382f",
      borderStrong: "#55524a",
      text: "#f6f2e6",
      textMuted: "#c9c4b4",
      accent: "#2b4bff",
      accent2: "#ffc400",
      accentHover: "#ffc400",
      line: "#f6f2e6",
      shadow: "#ffc400",
    },
  },
  {
    // C · Ördek (açık): krem zemin, siyah mürekkep, mavi + sarı.
    id: "ordekLight",
    mode: "light",
    palette: {
      bg: "#fffbf0",
      sidebar: "#fff6dc",
      surface: "#ffffff",
      surface2: "#fff6dc",
      border: "#e6dcc0",
      borderStrong: "#111111",
      text: "#111111",
      textMuted: "#4a4740",
      accent: "#2b4bff",
      accent2: "#ffc400",
      accentHover: "#1d36d9",
      line: "#111111",
      shadow: "#111111",
    },
  },
  {
    id: "midnight",
    mode: "dark",
    palette: {
      bg: "#0a0e1f",
      sidebar: "#0c1124",
      surface: "#10162f",
      surface2: "#151c3b",
      border: "#212a50",
      borderStrong: "#313d73",
      text: "#e9edff",
      textMuted: "#8a93bb",
      accent: "#5b7cff",
      accent2: "#8b5cf6",
      accentHover: "#7b95ff",
      gradient: "linear-gradient(135deg, #4f7bff 0%, #7c5cff 100%)",
    },
  },
  {
    id: "graphite",
    mode: "dark",
    palette: {
      bg: "#1b1c20",
      sidebar: "#202126",
      surface: "#26272d",
      surface2: "#2e3036",
      border: "#3a3c44",
      borderStrong: "#50535d",
      text: "#e8e9ec",
      textMuted: "#9da0a9",
      accent: "#4d8df6",
      accent2: "#3a6fd8",
      accentHover: "#6ea3fa",
    },
  },
  {
    id: "pitch",
    mode: "dark",
    palette: {
      bg: "#000000",
      sidebar: "#050505",
      surface: "#0c0c0d",
      surface2: "#141416",
      border: "#222226",
      borderStrong: "#34343a",
      text: "#f2f2f3",
      textMuted: "#8d8d96",
      accent: "#3b82f6",
      accent2: "#06b6d4",
      accentHover: "#60a5fa",
    },
  },
  {
    id: "twilight",
    mode: "dark",
    palette: {
      bg: "#191a21",
      sidebar: "#1d1e26",
      surface: "#22232d",
      surface2: "#2a2c38",
      border: "#3a3d4f",
      borderStrong: "#4f5369",
      text: "#f8f8f2",
      textMuted: "#a3a6bf",
      accent: "#a77bf3",
      accent2: "#ff79c6",
      accentHover: "#c4a2ff",
    },
  },
  {
    id: "polar",
    mode: "dark",
    palette: {
      bg: "#242933",
      sidebar: "#2a303b",
      surface: "#2e3440",
      surface2: "#3b4252",
      border: "#434c5e",
      borderStrong: "#4c566a",
      text: "#eceff4",
      textMuted: "#a3adbf",
      accent: "#5e81ac",
      accent2: "#88c0d0",
      accentHover: "#81a1c1",
    },
  },
  {
    id: "sakura",
    mode: "dark",
    palette: {
      bg: "#170c14",
      sidebar: "#1b0e18",
      surface: "#22111d",
      surface2: "#2b1525",
      border: "#45213b",
      borderStrong: "#5e2e51",
      text: "#fde9f3",
      textMuted: "#c093ad",
      accent: "#ec4899",
      accent2: "#c026d3",
      accentHover: "#f472b6",
    },
  },
  {
    id: "crimson",
    mode: "dark",
    palette: {
      bg: "#140809",
      sidebar: "#180a0c",
      surface: "#1f0e11",
      surface2: "#291216",
      border: "#441c23",
      borderStrong: "#5e2630",
      text: "#fdecec",
      textMuted: "#c29598",
      accent: "#e5383b",
      accent2: "#f97316",
      accentHover: "#f87171",
    },
  },
  {
    id: "amethyst",
    mode: "dark",
    palette: {
      bg: "#100b1c",
      sidebar: "#130d22",
      surface: "#19112d",
      surface2: "#211739",
      border: "#342558",
      borderStrong: "#483276",
      text: "#f1eaff",
      textMuted: "#a898c9",
      accent: "#9d4edd",
      accent2: "#6366f1",
      accentHover: "#c084fc",
    },
  },
  {
    id: "emerald",
    mode: "dark",
    palette: {
      bg: "#06120e",
      sidebar: "#081511",
      surface: "#0c1c17",
      surface2: "#10251e",
      border: "#1b3b30",
      borderStrong: "#275243",
      text: "#e6f7ef",
      textMuted: "#88b3a1",
      accent: "#0f9f6e",
      accent2: "#16a34a",
      accentHover: "#34d399",
    },
  },
  {
    id: "ocean",
    mode: "dark",
    palette: {
      bg: "#051317",
      sidebar: "#06171c",
      surface: "#091e25",
      surface2: "#0d2730",
      border: "#173f4b",
      borderStrong: "#215563",
      text: "#e3f6fb",
      textMuted: "#85aebb",
      accent: "#0891b2",
      accent2: "#2563eb",
      accentHover: "#22d3ee",
    },
  },
  {
    id: "sunset",
    mode: "dark",
    palette: {
      bg: "#150e07",
      sidebar: "#19110a",
      surface: "#20160d",
      surface2: "#2a1d11",
      border: "#47311c",
      borderStrong: "#624426",
      text: "#fff2e3",
      textMuted: "#c3a283",
      accent: "#d35f0b",
      accent2: "#dc2626",
      accentHover: "#fbbf24",
    },
  },
  {
    id: "coffee",
    mode: "dark",
    palette: {
      bg: "#15100c",
      sidebar: "#19130e",
      surface: "#201812",
      surface2: "#2a2018",
      border: "#433427",
      borderStrong: "#5c4735",
      text: "#f5ebe0",
      textMuted: "#b8a28c",
      accent: "#b87333",
      accent2: "#8b4513",
      accentHover: "#daa06d",
    },
  },
  {
    id: "snow",
    mode: "light",
    palette: {
      bg: "#f3f5fa",
      sidebar: "#ffffff",
      surface: "#ffffff",
      surface2: "#eef1f8",
      border: "#dfe4ef",
      borderStrong: "#c5cde0",
      text: "#151a2d",
      textMuted: "#5b6480",
      accent: "#4f6bff",
      accent2: "#7c5cff",
      accentHover: "#3d56e0",
    },
  },
  {
    id: "fog",
    mode: "light",
    palette: {
      bg: "#e9ebee",
      sidebar: "#f4f5f7",
      surface: "#f8f9fa",
      surface2: "#e2e5e9",
      border: "#d0d4da",
      borderStrong: "#b5bbc4",
      text: "#1d2127",
      textMuted: "#5e6570",
      accent: "#2563eb",
      accent2: "#0891b2",
      accentHover: "#1d4ed8",
    },
  },
  {
    id: "sand",
    mode: "light",
    palette: {
      bg: "#f5efe4",
      sidebar: "#fbf7ef",
      surface: "#fffbf4",
      surface2: "#f0e8d9",
      border: "#e3d7c1",
      borderStrong: "#cfbf9f",
      text: "#2d2216",
      textMuted: "#7a6a55",
      accent: "#c2410c",
      accent2: "#d97706",
      accentHover: "#9a3412",
    },
  },
  {
    id: "cotton",
    mode: "light",
    palette: {
      bg: "#fdf2f7",
      sidebar: "#fff8fb",
      surface: "#ffffff",
      surface2: "#fbe6f0",
      border: "#f3cfe0",
      borderStrong: "#e7a9c6",
      text: "#3a1230",
      textMuted: "#8b5a79",
      accent: "#db2777",
      accent2: "#a855f7",
      accentHover: "#be185d",
    },
  },
] as const satisfies readonly Theme[];

export type ThemeId = (typeof THEMES)[number]["id"];

export const DEFAULT_THEME: ThemeId = "calm";

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((t) => t.id === value);
}

export function getTheme(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

// --- Özel tema: kullanıcının seçtiği beş renkten tam palet türetilir. ---

export const CUSTOM_THEME_ID = "custom";
export type ThemeChoice = ThemeId | typeof CUSTOM_THEME_ID;

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === CUSTOM_THEME_ID || isThemeId(value);
}

export interface CustomColors {
  mode: ThemeMode;
  bg: string;
  surface: string;
  text: string;
  accent: string;
  /** İkinci vurgu: koyu kipte gölge ve üzerine gelme rengi. */
  accent2: string;
}

/** Başlangıçta Ördek (koyu) renkleri: özel temaya geçince görünüm değişmez. */
export const DEFAULT_CUSTOM_COLORS: CustomColors = {
  mode: "dark",
  bg: "#14130f",
  surface: "#1e1d18",
  text: "#f6f2e6",
  accent: "#2b4bff",
  accent2: "#ffc400",
};

const HEX = /^#[0-9a-f]{6}$/i;

export function normalizeCustomColors(raw: unknown): CustomColors {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_CUSTOM_COLORS;
  const color = (v: unknown, fallback: string) =>
    typeof v === "string" && HEX.test(v) ? v.toLowerCase() : fallback;
  return {
    mode: r.mode === "light" ? "light" : "dark",
    bg: color(r.bg, d.bg),
    surface: color(r.surface, d.surface),
    text: color(r.text, d.text),
    accent: color(r.accent, d.accent),
    accent2: color(r.accent2, d.accent2),
  };
}

/** İki rengi karıştırır: `amount` 0 ise a, 1 ise b. */
export function mixHex(a: string, b: string, amount: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return (
    "#" +
    [0, 1, 2]
      .map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * amount))
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
  );
}

export function customTheme(c: CustomColors): Theme {
  const dark = c.mode === "dark";
  return {
    id: CUSTOM_THEME_ID,
    mode: c.mode,
    palette: {
      bg: c.bg,
      sidebar: mixHex(c.bg, c.surface, 0.4),
      surface: c.surface,
      surface2: mixHex(c.surface, c.text, 0.06),
      border: mixHex(c.surface, c.text, 0.16),
      borderStrong: mixHex(c.surface, c.text, 0.3),
      text: c.text,
      textMuted: mixHex(c.text, c.bg, 0.3),
      accent: c.accent,
      accent2: c.accent2,
      accentHover: dark ? c.accent2 : mixHex(c.accent, "#000000", 0.15),
      line: c.text,
      shadow: dark ? c.accent2 : c.text,
    },
  };
}

/** Ayardaki seçim: hazır tema ya da özel renkler. */
export function resolveTheme(id: string, custom?: CustomColors): Theme {
  return id === CUSTOM_THEME_ID ? customTheme(custom ?? DEFAULT_CUSTOM_COLORS) : getTheme(id);
}

/** Moda göre ortak renkler: açık zeminde koyu, koyu zeminde açık tonlar okunur. */
const MODE_COLORS: Record<ThemeMode, Record<string, string>> = {
  dark: {
    "--dk-success": "#34d399",
    "--dk-error": "#f87171",
    "--dk-warning": "#fbbf24",
    "--dk-brand": "#FFD43B",
    "--dk-pink": "#f9a8d4",
    "--dk-dim": "rgb(4 7 20 / 76%)",
    // Kayıt oynatıcısındaki eylem düğmeleri: düzenleyicide aç mavi, kopya olarak
    // kaydet koyu yeşil, üzerine yaz açık yeşil (kullanıcının 2026-09-27 isteği).
    "--dk-edit": "#2563eb",
    "--dk-save": "#047857",
    "--dk-save-soft": "#6ee7b7",
    "--dk-save-soft-text": "#022c22",
  },
  light: {
    "--dk-success": "#059669",
    "--dk-error": "#dc2626",
    "--dk-warning": "#b45309",
    "--dk-brand": "#a16207",
    "--dk-pink": "#be185d",
    "--dk-dim": "rgb(15 20 35 / 45%)",
    "--dk-edit": "#1d4ed8",
    "--dk-save": "#047857",
    "--dk-save-soft": "#a7f3d0",
    "--dk-save-soft-text": "#064e3b",
  },
};

/** Temanın CSS değişkenleri (saf: test edilebilir). */
export function themeVariables(theme: Theme, panelAlpha = 1): Record<string, string> {
  const p = theme.palette;
  // Arka plan resmi varken paneller yarı saydam olur ki resim arkadan görünsün.
  const see = (color: string) =>
    panelAlpha >= 1
      ? color
      : `color-mix(in srgb, ${color} ${Math.round(panelAlpha * 100)}%, transparent)`;
  return {
    "--dk-bg": p.bg,
    "--dk-sidebar": see(p.sidebar),
    "--dk-surface": see(p.surface),
    "--dk-surface-2": see(p.surface2),
    "--dk-border": p.border,
    "--dk-border-strong": p.borderStrong,
    "--dk-text": p.text,
    "--dk-text-muted": p.textMuted,
    "--dk-accent": p.accent,
    "--dk-accent-2": p.accent2,
    "--dk-accent-hover": p.accentHover,
    // C tasarımında renk geçişi yok: eski "gradient" yüzeyleri düz vurgu rengi olur.
    "--dk-gradient": p.accent,
    "--dk-line": p.line ?? p.borderStrong,
    "--dk-shadow": p.shadow ?? (theme.mode === "dark" ? p.accentHover : "#111111"),
    ...MODE_COLORS[theme.mode],
  };
}

/** Temayı sayfaya uygular (kök öğenin değişkenleri + açık/koyu kip). */
export function applyTheme(
  id: string,
  root: HTMLElement = document.documentElement,
  options: { custom?: CustomColors; panelAlpha?: number } = {},
): Theme {
  const theme = resolveTheme(id, options.custom);
  for (const [name, value] of Object.entries(themeVariables(theme, options.panelAlpha))) {
    root.style.setProperty(name, value);
  }
  root.dataset.theme = theme.id;
  root.dataset.mode = theme.mode;
  root.style.colorScheme = theme.mode;
  return theme;
}
