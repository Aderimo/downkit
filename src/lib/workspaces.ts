import { create } from "zustand";
import type { AddPanelPositionOptions, DockviewApi, SerializedDockview } from "dockview-react";
import i18n from "../i18n";

// Çalışma alanları (düzenler): düzenleyicinin panelleri (Araçlar, Video, Telefon,
// Özellikler, Zaman çizelgesi, Transkript) taşınabilir, boyutlandırılabilir, kapatılıp
// geri açılabilir. Hazır düzenler kodda kurulur; kullanıcı kendi düzenini adıyla
// kaydedebilir. Her düzenin son hâli de saklanır ("Kaydedilen hâline sıfırla" ile döner).

export const PANEL_IDS = [
  "tools",
  "viewer",
  "phone",
  "inspector",
  "timeline",
  "transcript",
] as const;
export type PanelId = (typeof PANEL_IDS)[number];

/** Kapatılamayan paneller (düzenleyici bunlarsız çalışmaz). */
export const FIXED_PANELS: readonly PanelId[] = ["viewer", "timeline"];

export const PRESET_IDS = ["cinema", "tabbed", "phone", "studio", "focus", "simple"] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export interface CustomWorkspace {
  id: string;
  name: string;
  layout: SerializedDockview;
}

interface Stored {
  active: string;
  custom: CustomWorkspace[];
  /** Düzen kimliği → son hâli (kullanıcı panelleri oynattıkça güncellenir). */
  modified: Record<string, SerializedDockview>;
}

const STORAGE_KEY = "downkit.workspaces";
/** Hazır düzenlerin sürümü: düzenler değişince eski sürümde kaydedilmiş hazır düzen
 * değişiklikleri bir kez atılır (kullanıcının kendi kaydettiği düzenler kalır). */
const PRESET_VERSION = 2;

const isPreset = (id: string): id is PresetId => (PRESET_IDS as readonly string[]).includes(id);

const looksLikeLayout = (v: unknown): v is SerializedDockview =>
  !!v && typeof v === "object" && "grid" in (v as object) && "panels" in (v as object);

/** Kayıttan okur; bozuk kısımlar atılır. */
export function parseStored(raw: unknown): Stored {
  const out: Stored = { active: "cinema", custom: [], modified: {} };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r.custom)) {
    out.custom = r.custom.filter(
      (c): c is CustomWorkspace =>
        !!c &&
        typeof c.id === "string" &&
        c.id.startsWith("user:") &&
        typeof c.name === "string" &&
        c.name.trim().length > 0 &&
        looksLikeLayout(c.layout),
    );
  }
  if (r.modified && typeof r.modified === "object" && r.version === PRESET_VERSION) {
    for (const [k, v] of Object.entries(r.modified as Record<string, unknown>)) {
      if (looksLikeLayout(v)) out.modified[k] = v;
    }
  }
  const active = typeof r.active === "string" ? r.active : "cinema";
  out.active = isPreset(active) || out.custom.some((c) => c.id === active) ? active : "cinema";
  return out;
}

function load(): Stored {
  try {
    return parseStored(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"));
  } catch {
    return parseStored(null);
  }
}

function persist(s: Stored) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: PRESET_VERSION,
        active: s.active,
        custom: s.custom,
        modified: s.modified,
      }),
    );
  } catch {
    // Saklanamazsa yalnızca bu oturumda geçerli.
  }
}

interface WorkspaceState extends Stored {
  /** Açık olan paneller (menüde işaretli görünür; kapalılar geri açılabilir). */
  open: PanelId[];
  setOpen: (open: PanelId[]) => void;
  update: (patch: Partial<Stored>) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  ...load(),
  open: [],
  setOpen: (open) => set({ open }),
  update: (patch) => {
    set(patch);
    persist(get());
  },
}));

// ——— Panellerin yerleşimi ———

const TITLE_KEY: Record<PanelId, string> = {
  tools: "workspace.panel.tools",
  viewer: "workspace.panel.viewer",
  phone: "workspace.panel.phone",
  inspector: "workspace.panel.inspector",
  timeline: "workspace.panel.timeline",
  transcript: "workspace.panel.transcript",
};

const CONSTRAINTS: Partial<Record<PanelId, { minimumWidth?: number; minimumHeight?: number }>> = {
  tools: { minimumWidth: 64 },
  viewer: { minimumWidth: 280, minimumHeight: 180 },
  phone: { minimumWidth: 150 },
  inspector: { minimumWidth: 280 },
  timeline: { minimumHeight: 150 },
};

export function addPanel(
  api: DockviewApi,
  id: PanelId,
  position?: AddPanelPositionOptions,
  size?: { width?: number; height?: number },
) {
  const existing = api.getPanel(id);
  if (existing) {
    existing.api.setActive();
    return existing;
  }
  return api.addPanel({
    id,
    component: id,
    title: i18n.t(TITLE_KEY[id]),
    // Video ve telefon gizli sekmedeyken de çalışsın (oynatma sürsün, telefon çizebilsin).
    renderer: id === "viewer" || id === "phone" ? "always" : "onlyWhenVisible",
    ...(position ? { position } : {}),
    ...(size?.width ? { initialWidth: size.width } : {}),
    ...(size?.height ? { initialHeight: size.height } : {}),
    ...CONSTRAINTS[id],
  });
}

/** Hazır düzeni kurar (taslaklar 1–6). `width`: kapsayıcının genişliği (dar ekrana uyum). */
export function buildPreset(api: DockviewApi, id: PresetId, width = 1440) {
  api.clear();
  const narrow = width < 1200;
  addPanel(api, "viewer");
  // Zaman çizelgesi pencerenin boyuna oranla (küçük ekranda izler kesilmesin, büyükte video küçülmesin).
  const screenH = typeof window === "undefined" ? 900 : window.innerHeight;
  const below = (share: number) =>
    addPanel(
      api,
      "timeline",
      { direction: "below" },
      { height: Math.round(Math.min(440, Math.max(230, screenH * share))) },
    );
  const left = (w: number) =>
    addPanel(api, "tools", { referencePanel: "viewer", direction: "left" }, { width: w });
  const right = (w: number) =>
    addPanel(api, "inspector", { referencePanel: "viewer", direction: "right" }, { width: w });
  const phoneBeside = (w: number) =>
    addPanel(api, "phone", { referencePanel: "viewer", direction: "right" }, { width: w });
  const phoneTab = () => addPanel(api, "phone", { referencePanel: "viewer", direction: "within" });
  // Sonradan eklenen sütun (telefon) yanındakinden yer alır: genişlikler en sonda yeniden verilir,
  // Özellikler dar kalıp yazıları sıkışmasın.
  const widths: [PanelId, number][] = [];
  const keep = (panel: PanelId, w: number) => widths.push([panel, w]);
  switch (id) {
    case "cinema":
      below(0.36);
      left(280);
      right(320);
      keep("tools", narrow ? 240 : 280);
      keep("inspector", narrow ? 290 : 320);
      // Dar pencerede telefon video ile aynı sekme grubunda (sığmayan sütun açılmaz).
      if (narrow) phoneTab();
      else {
        phoneBeside(220);
        keep("phone", 220);
      }
      api.getPanel("viewer")?.api.setActive();
      break;
    case "tabbed":
      below(0.36);
      left(300);
      right(340);
      keep("tools", 300);
      keep("inspector", 340);
      phoneTab();
      api.getPanel("viewer")?.api.setActive();
      break;
    case "phone": {
      // Telefon ortada, yatay video arkasında sekme.
      below(0.34);
      left(300);
      right(340);
      keep("tools", 300);
      keep("inspector", 340);
      phoneTab();
      api.getPanel("phone")?.api.setActive();
      break;
    }
    case "studio":
      below(0.42);
      left(280);
      right(320);
      phoneBeside(narrow ? 220 : 380);
      keep("tools", 280);
      keep("inspector", 320);
      keep("phone", narrow ? 220 : 380);
      addPanel(api, "transcript", { referencePanel: "tools", direction: "within" });
      api.getPanel("tools")?.api.setActive();
      break;
    case "focus":
      below(0.34);
      break;
    case "simple":
      below(0.3);
      left(340);
      phoneBeside(narrow ? 200 : 260);
      keep("tools", 340);
      keep("phone", narrow ? 200 : 260);
      break;
  }
  // Bir sütunun boyu değişince komşusu da değişir: önce video kalan yere çekilir, sonra yan
  // sütunlar (iki tur: her biri verilen genişliğe oturur).
  if (widths.length > 0) {
    const fixed = widths.reduce((sum, [, w]) => sum + w, 0);
    const viewer = api.getPanel("viewer");
    if (viewer && api.width > fixed + 300) viewer.api.setSize({ width: api.width - fixed });
    for (let round = 0; round < 2; round += 1) {
      for (const [panel, w] of widths) api.getPanel(panel)?.api.setSize({ width: w });
    }
  }
}

/** Kapatılmış paneli varsayılan yerine geri açar. */
export function reopenPanel(api: DockviewApi, id: PanelId) {
  const has = (p: PanelId) => api.getPanel(p) !== undefined;
  switch (id) {
    case "tools":
      return addPanel(
        api,
        "tools",
        { referencePanel: "viewer", direction: "left" },
        { width: 320 },
      );
    case "inspector":
      return addPanel(
        api,
        "inspector",
        { referencePanel: "viewer", direction: "right" },
        { width: 320 },
      );
    case "phone":
      return addPanel(
        api,
        "phone",
        has("inspector")
          ? { referencePanel: "inspector", direction: "left" }
          : { referencePanel: "viewer", direction: "right" },
        { width: 240 },
      );
    case "transcript":
      return addPanel(
        api,
        "transcript",
        has("tools")
          ? { referencePanel: "tools", direction: "within" }
          : { referencePanel: "viewer", direction: "left" },
        { width: 320 },
      );
    case "timeline":
      return addPanel(api, "timeline", { direction: "below" }, { height: 280 });
    case "viewer":
      return addPanel(api, "viewer");
  }
}

/** Düzenin son hâlini (ya da kendisini) yükler; olmazsa hazır düzene döner. */
export function restoreWorkspace(api: DockviewApi, id: string, width: number) {
  const s = useWorkspaceStore.getState();
  const layout = s.modified[id] ?? s.custom.find((c) => c.id === id)?.layout;
  if (layout) {
    try {
      api.fromJSON(layout);
      // Eksik zorunlu paneller (eski kayıt) geri eklenir.
      for (const p of FIXED_PANELS) if (!api.getPanel(p)) reopenPanel(api, p);
      return;
    } catch {
      // Bozuk kayıt: hazır düzene dön.
    }
  }
  buildPreset(api, isPreset(id) ? id : "cinema", width);
}

/** Başka düzene geçer (şimdiki düzenin son hâli saklıdır). */
export function switchWorkspace(api: DockviewApi, id: string, width: number) {
  const s = useWorkspaceStore.getState();
  s.update({ active: id, modified: { ...s.modified, [s.active]: api.toJSON() } });
  restoreWorkspace(api, id, width);
}

/** Şu anki düzeni kaydedilen hâline döndürür (hazır düzende baştaki yerleşim). */
export function resetWorkspace(api: DockviewApi, width: number) {
  const s = useWorkspaceStore.getState();
  const modified = { ...s.modified };
  delete modified[s.active];
  s.update({ modified });
  restoreWorkspace(api, s.active, width);
}

/** Şu anki yerleşimi yeni bir düzen olarak adıyla kaydeder ve ona geçer; çıkılan düzen
 * kaydedilen hâline döner (değişiklikler yeni düzende). */
export function saveWorkspaceAs(api: DockviewApi, name: string): string {
  const s = useWorkspaceStore.getState();
  const id = `user:${crypto.randomUUID()}`;
  const layout = api.toJSON();
  // Değişiklikler yeni düzende; çıkılan düzen kaydedilen hâline döner.
  const modified = { ...s.modified };
  delete modified[s.active];
  s.update({
    custom: [...s.custom, { id, name: name.trim().slice(0, 40), layout }],
    active: id,
    modified,
  });
  return id;
}

export function renameWorkspace(id: string, name: string) {
  const s = useWorkspaceStore.getState();
  if (!name.trim()) return;
  s.update({
    custom: s.custom.map((c) => (c.id === id ? { ...c, name: name.trim().slice(0, 40) } : c)),
  });
}

/** Kullanıcı düzenini siler; açıksa Sinema düzenine geçilir. */
export function deleteWorkspace(api: DockviewApi | null, id: string, width: number) {
  const s = useWorkspaceStore.getState();
  const modified = { ...s.modified };
  delete modified[id];
  const wasActive = s.active === id;
  s.update({
    custom: s.custom.filter((c) => c.id !== id),
    modified,
    active: wasActive ? "cinema" : s.active,
  });
  if (wasActive && api) restoreWorkspace(api, "cinema", width);
}

/** Paneller oynatılınca son hâl saklanır (kullanıcı düzeninde düzenin kendisi de). */
export function rememberLayout(api: DockviewApi) {
  const s = useWorkspaceStore.getState();
  const layout = api.toJSON();
  s.update({ modified: { ...s.modified, [s.active]: layout } });
}

/** Düzenin görünen adı. */
export function workspaceName(id: string): string {
  if (isPreset(id)) return i18n.t(`workspace.preset.${id}`);
  return useWorkspaceStore.getState().custom.find((c) => c.id === id)?.name ?? id;
}

// ——— Açık düzenleyicinin yerleşimine erişim (menüler, telefon düğmesi) ———

let currentApi: DockviewApi | null = null;

export function setWorkspaceApi(api: DockviewApi | null) {
  currentApi = api;
}

export const workspaceApi = () => currentApi;

/** Paneli açar ya da (görünüyorsa) kapatır; gizli sekmedeyse öne getirir. */
export function togglePanel(id: PanelId) {
  const api = currentApi;
  if (!api) return;
  const panel = api.getPanel(id);
  if (!panel) {
    reopenPanel(api, id);
    return;
  }
  if (!panel.api.isVisible) panel.api.setActive();
  else if (!FIXED_PANELS.includes(id)) api.removePanel(panel);
}
