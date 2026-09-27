import { create } from "zustand";
import { getSettings, useSettingsStore } from "./appSettings";

// Tanıtım turları:
// - "welcome": ilk açılışta (ve "Bir daha gösterme" işaretlenene kadar her
//   açılışta) programı genel olarak tanıtır; sonunda yapımcı/bağış kartı.
// - Sayfa turları: bir sayfa ilk kez açılınca o sayfanın içindeki öğeleri tek tek
//   gösterip nasıl kullanıldığını anlatır. Durum çubuğundaki "?" ile yeniden açılır.

export interface TutorialStep {
  id: string;
  /** Vurgulanacak öğelerin `data-tour` değerleri; boşsa kart ortada durur. */
  targets: string[];
  /** Hedef sayfada yoksa (ör. henüz link analiz edilmedi) adım atlanır. */
  optional?: boolean;
}

export type TourId =
  | "welcome"
  | "home"
  | "editorStart"
  | "editor"
  | "convert"
  | "compress"
  | "resize"
  | "downloads"
  | "batch"
  | "record"
  | "settings";

const localTool: TutorialStep[] = [
  { id: "intro", targets: [] },
  { id: "drop", targets: ["local-drop"], optional: true },
  { id: "file", targets: ["local-file"], optional: true },
  { id: "options", targets: ["local-options"], optional: true },
  { id: "start", targets: ["local-start"], optional: true },
  { id: "result", targets: [] },
];

export const TOURS: Record<TourId, TutorialStep[]> = {
  welcome: [
    { id: "welcome", targets: [] },
    { id: "link", targets: ["nav-home"] },
    { id: "editor", targets: ["nav-editor"] },
    { id: "record", targets: ["nav-record"] },
    { id: "local", targets: ["nav-convert", "nav-compress", "nav-resize"] },
    { id: "queue", targets: ["nav-downloads"] },
    { id: "settings", targets: ["nav-batch", "nav-settings"] },
    { id: "help", targets: ["status-help", "sidebar-toggle"] },
    { id: "support", targets: ["maker"] },
  ],
  home: [
    { id: "url", targets: ["home-url"] },
    { id: "platforms", targets: ["home-platforms"] },
    { id: "media", targets: ["home-media"], optional: true },
    { id: "section", targets: ["home-section"], optional: true },
    { id: "actions", targets: ["home-actions"] },
    { id: "options", targets: ["home-options"] },
    { id: "start", targets: ["home-start"] },
    { id: "presets", targets: ["home-presets"], optional: true },
    { id: "queue", targets: ["home-queue"] },
  ],
  editorStart: [
    { id: "intro", targets: [] },
    { id: "resume", targets: ["editor-resume"], optional: true },
    { id: "link", targets: ["editor-link"] },
    { id: "drop", targets: ["editor-drop"] },
  ],
  editor: [
    { id: "player", targets: ["editor-player"] },
    { id: "tools", targets: ["editor-tools"] },
    { id: "add", targets: ["editor-add"] },
    { id: "timeline", targets: ["editor-timeline"] },
    { id: "split", targets: ["editor-split"] },
    { id: "clip", targets: ["editor-clip"], optional: true },
    { id: "layers", targets: ["editor-timeline"] },
    { id: "undo", targets: ["editor-undo", "editor-magnet"] },
    { id: "zoom", targets: ["editor-zoom"] },
    { id: "panel", targets: ["editor-panel"] },
    { id: "export", targets: ["editor-export-open"] },
    { id: "shortcuts", targets: ["editor-shortcuts"] },
  ],
  convert: localTool,
  compress: localTool,
  resize: localTool,
  downloads: [
    { id: "view", targets: ["downloads-view"] },
    { id: "list", targets: ["downloads-list"] },
    { id: "filter", targets: ["downloads-filter"] },
    { id: "actions", targets: ["downloads-list"] },
    { id: "history", targets: ["downloads-view"] },
  ],
  batch: [
    { id: "input", targets: ["batch-input"] },
    { id: "options", targets: ["batch-options"] },
    { id: "start", targets: ["batch-start"] },
  ],
  record: [
    { id: "main", targets: ["record-main"] },
    { id: "replay", targets: ["record-replay"] },
    { id: "source", targets: ["record-source"] },
    { id: "audio", targets: ["record-audio"] },
    { id: "hotkeys", targets: ["record-hotkeys"] },
    { id: "library", targets: ["record-library"] },
  ],
  settings: [
    { id: "general", targets: ["settings-general"] },
    { id: "folders", targets: ["settings-folders"] },
    { id: "theme", targets: ["settings-theme"] },
    { id: "downloads", targets: ["settings-downloads"] },
    { id: "subtitles", targets: ["settings-subtitles"] },
    { id: "behavior", targets: ["settings-behavior"] },
    { id: "browser", targets: ["settings-browser"] },
    { id: "tools", targets: ["settings-tools"] },
    { id: "privacy", targets: ["settings-privacy"] },
    { id: "about", targets: ["settings-about"] },
  ],
};

/** Sayfa (ve düzenleyicinin durumu) için tur. */
export function tourForRoute(route: string, editorReady: boolean): TourId | null {
  if (route === "editor") return editorReady ? "editor" : "editorStart";
  return route in TOURS && route !== "welcome" ? (route as TourId) : null;
}

/** Hedefi sayfada görünür olan öğe (ekranda iki kopyası olabilir; gizli olan atlanır). */
export function findTarget(id: string): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(`[data-tour="${id}"]`);
  for (const el of all) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return el;
  }
  return null;
}

function availableSteps(tour: TourId): TutorialStep[] {
  return TOURS[tour].filter((step) => !step.optional || step.targets.some((t) => findTarget(t)));
}

const SEEN_KEY = "downkit.toursSeen";

function loadSeen(): TourId[] {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed.filter((t) => typeof t === "string") as TourId[]) : [];
  } catch {
    return [];
  }
}

function saveSeen(seen: TourId[]) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    // Kaydedilemezse tur bir sonraki ziyarette yine gösterilir.
  }
}

interface TutorialState {
  open: boolean;
  tour: TourId;
  steps: TutorialStep[];
  step: number;
  /** "Bir daha gösterme" kutusu. */
  dontShowAgain: boolean;
  seen: TourId[];
  start: (tour?: TourId) => void;
  goTo: (step: number) => void;
  setDontShowAgain: (value: boolean) => void;
  /** Kapatır; kutu işaretliyse otomatik gösterim kapanır. */
  close: () => void;
  /** Tüm sayfa turlarını yeniden "görülmedi" yapar. */
  resetSeen: () => void;
}

function isDemo(): boolean {
  return import.meta.env.DEV && new URLSearchParams(window.location.search).has("demo");
}

export const useTutorialStore = create<TutorialState>((set, get) => {
  const markSeen = (tour: TourId) => {
    const { seen } = get();
    if (seen.includes(tour)) return;
    const next = [...seen, tour];
    saveSeen(next);
    set({ seen: next });
  };
  return {
    // README ekran görüntüleri alınırken tur araya girmesin.
    open: getSettings().showTutorial && !isDemo(),
    tour: "welcome",
    steps: TOURS.welcome,
    step: 0,
    dontShowAgain: false,
    seen: loadSeen(),
    start: (tour = "welcome") => {
      const settings = getSettings();
      set({
        open: true,
        tour,
        steps: tour === "welcome" ? TOURS.welcome : availableSteps(tour),
        step: 0,
        dontShowAgain: tour === "welcome" ? !settings.showTutorial : !settings.pageTours,
      });
      // Açıldığı an görüldü sayılır: tur yarıda bırakılıp program kapansa da
      // sonraki açılışta aynı tur yeniden gelmez.
      if (tour !== "welcome") markSeen(tour);
    },
    goTo: (step) => set({ step: Math.min(Math.max(step, 0), get().steps.length - 1) }),
    // Kutu işaretlenir işaretlenmez kaydedilir (turu kapatmayı beklemeden).
    setDontShowAgain: (dontShowAgain) => {
      set({ dontShowAgain });
      const settings = useSettingsStore.getState();
      if (get().tour === "welcome") {
        // "Bir daha gösterme": karşılama turu da, ardından gelen sayfa turları da kapanır.
        settings.update({ showTutorial: !dontShowAgain, pageTours: !dontShowAgain });
      } else {
        settings.update({ pageTours: !dontShowAgain });
      }
    },
    close: () => {
      const { tour, dontShowAgain } = get();
      const settings = useSettingsStore.getState();
      if (tour === "welcome") {
        // İşaretlenmediyse karşılama turu sonraki açılışta yine gösterilir.
        if (dontShowAgain) settings.update({ showTutorial: false, pageTours: false });
        else settings.update({ showTutorial: true });
      } else {
        if (dontShowAgain) settings.update({ pageTours: false });
        markSeen(tour);
      }
      set({ open: false });
    },
    resetSeen: () => {
      saveSeen([]);
      set({ seen: [] });
    },
  };
});

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Birden çok öğeyi kapsayan en küçük dikdörtgen. */
export function unionRect(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  const right = Math.max(...rects.map((r) => r.left + r.width));
  const bottom = Math.max(...rects.map((r) => r.top + r.height));
  return { left, top, width: right - left, height: bottom - top };
}

/** Anlatım kartının yeri: vurgulanan alanın sağında; yer yoksa solunda, altında
 * ya da üstünde; hiçbiri olmazsa ortada. Ekrandan taşmaz. */
export function placeCard(
  target: Rect | null,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 20,
  margin = 16,
): { left: number; top: number; side: "right" | "left" | "below" | "above" | "center" } {
  const centered = {
    left: (viewport.width - card.width) / 2,
    top: Math.max(margin, (viewport.height - card.height) / 2),
    side: "center" as const,
  };
  if (!target) return centered;
  const clampTop = (top: number) =>
    Math.min(Math.max(top, margin), Math.max(margin, viewport.height - card.height - margin));
  const clampLeft = (left: number) =>
    Math.min(Math.max(left, margin), Math.max(margin, viewport.width - card.width - margin));
  const middleTop = clampTop(target.top + target.height / 2 - card.height / 2);

  const right = target.left + target.width + gap;
  if (right + card.width + margin <= viewport.width) {
    return { left: right, top: middleTop, side: "right" };
  }
  const left = target.left - gap - card.width;
  if (left >= margin) return { left, top: middleTop, side: "left" };
  const below = target.top + target.height + gap;
  if (below + card.height + margin <= viewport.height) {
    return { left: clampLeft(target.left), top: below, side: "below" };
  }
  const above = target.top - gap - card.height;
  if (above >= margin) return { left: clampLeft(target.left), top: above, side: "above" };
  return centered;
}
