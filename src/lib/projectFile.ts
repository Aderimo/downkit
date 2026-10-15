import type { SeqClip, TrackStates } from "./sequence";
import { isEmoji } from "./captionEmoji";
import type { TextItem } from "./textItems";
import {
  parseBlurs,
  parseImages,
  parseMusic,
  type BlurItem,
  type ImageItem,
  type MusicItem,
} from "./layers";
import { parseXfade } from "./xfade";
import { parseTransform } from "./clipTransform";
import { parseZooms } from "./clipZoom";
import { parseEffects, type EffectItem } from "./effectLane";
import { parseRichStyle } from "./captionStyle";
import { parsePlacement } from "./multiFormat";

// DownKit proje dosyası (.downkit): düz JSON, sürümlü şema. Medya dosyaları
// gömülmez, yollarıyla anılır. Aynı biçim otomatik kayıt (kurtarma) dosyasında
// da kullanılır; orada ayrıca bağlı proje yolu ve "kaydedilmemiş değişiklik" bilgisi
// bulunur. Bu modül saf: dosya okuma/yazma ve düzenleyici durumu project.ts'te.

export const PROJECT_SCHEMA = 1;

export interface ProjectSource {
  /** Kaynağın proje içindeki kimliği (kliplerin sourceId'si buna bakar). */
  id: string;
  path: string;
  title: string;
}

export interface ProjectData {
  schemaVersion: number;
  app: "DownKit";
  savedAt: string;
  name: string;
  sources: ProjectSource[];
  clips: SeqClip[];
  texts: TextItem[];
  images: ImageItem[];
  music: MusicItem[];
  blurs: BlurItem[];
  /** Efekt şeridi (eski projelerde yok). */
  effects: EffectItem[];
  tracks: TrackStates;
  /** Dışa aktarma ayarları (çerçeve, kırpma konumu, kamera+oyun…); bilinmeyen alanlar atılır. */
  exportOptions?: Record<string, unknown>;
  /** Yalnızca kurtarma dosyasında. */
  projectPath?: string | null;
  dirty?: boolean;
}

export type ProjectErrorCode = "invalid" | "newer" | "empty";

export class ProjectError extends Error {
  constructor(public code: ProjectErrorCode) {
    super(code);
  }
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Bozuk klipleri atar; sayısal alanları geçerli olanlar korunur. */
export function parseClips(raw: unknown): SeqClip[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r: Record<string, unknown>) => {
    if (!r || typeof r !== "object" || typeof r.id !== "string") return [];
    if (!isNum(r.start) || !isNum(r.srcStart) || !isNum(r.srcEnd) || r.srcEnd <= r.srcStart)
      return [];
    const speed = isNum(r.speed) && r.speed > 0 ? r.speed : 1;
    const track = isNum(r.track) && r.track >= 0 ? Math.floor(r.track) : 0;
    const clip = {
      ...(r as unknown as SeqClip),
      start: Math.max(0, r.start),
      speed,
      track,
      name: typeof r.name === "string" ? r.name : "",
      xfade: parseXfade(r.xfade),
      transform: parseTransform(r.transform),
      zooms: parseZooms(r.zooms),
    };
    if (clip.xfade === undefined) delete clip.xfade;
    if (clip.transform === undefined) delete clip.transform;
    if (clip.zooms === undefined) delete clip.zooms;
    return [clip];
  });
}

/** Zengin stil alanları ayrıca doğrulanır (bozuk değer projeyi bozmasın). */
const RICH_KEYS = [
  "font",
  "stroke",
  "strokeColor",
  "shadow",
  "glow",
  "bg",
  "bgOpacity",
  "upper",
  "italic",
  "spacing",
  "highlight",
  "words",
];

function parseTexts(raw: unknown): TextItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (t): t is TextItem =>
        !!t &&
        typeof t === "object" &&
        typeof t.id === "string" &&
        typeof t.text === "string" &&
        isNum(t.start) &&
        isNum(t.end),
    )
    .map((t) => {
      const base = { ...t } as Record<string, unknown>;
      for (const key of RICH_KEYS) delete base[key];
      if (!isEmoji(base.emoji)) delete base.emoji;
      if (base.tpl !== "layout" && base.tpl !== "hook" && base.tpl !== "end") delete base.tpl;
      const at = parsePlacement(base.at);
      if (at) base.at = at;
      else delete base.at;
      return {
        ...(base as unknown as TextItem),
        ...parseRichStyle(t as unknown as Record<string, unknown>),
      };
    });
}

function parseTracks(raw: unknown): TrackStates {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: TrackStates = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(key);
    if (!Number.isInteger(n) || n < 0 || !value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    out[n] = { muted: v.muted === true, hidden: v.hidden === true, locked: v.locked === true };
  }
  return out;
}

function parseSources(raw: unknown): ProjectSource[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((s: Record<string, unknown>, index) => {
    if (!s || typeof s.path !== "string" || !s.path) return [];
    // Eski DownKit oturumlarındaki link kaynakları DownKit'te açılamaz.
    if (typeof s.kind === "string" && s.kind !== "local") return [];
    return [
      {
        id: typeof s.id === "string" && s.id ? s.id : `s${index + 1}`,
        path: s.path,
        title: typeof s.title === "string" && s.title ? s.title : fileName(s.path),
      },
    ];
  });
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Proje adı: dosya adının uzantısız hâli. */
export function projectNameFromPath(path: string): string {
  // ClipKit döneminin .clipkit dosyaları da açılır.
  return fileName(path).replace(/\.(downkit|clipkit)$/i, "");
}

/**
 * Proje metnini okur. Eski oturum kaydını (schemaVersion'sız) da kabul eder.
 * Bozuksa `invalid`, daha yeni bir sürümle kaydedildiyse `newer`, açılacak
 * kaynak yoksa `empty` hatası verir.
 */
export function parseProject(text: string): ProjectData {
  let raw: Record<string, unknown>;
  try {
    const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    raw = JSON.parse(clean) as Record<string, unknown>;
  } catch {
    throw new ProjectError("invalid");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ProjectError("invalid");
  const version = raw.schemaVersion;
  if (version !== undefined && (!isNum(version) || version < 1)) throw new ProjectError("invalid");
  if (isNum(version) && version > PROJECT_SCHEMA) throw new ProjectError("newer");
  if (!Array.isArray(raw.clips)) throw new ProjectError("invalid");
  // Eski tek kaynaklı oturum: { source: {...} }.
  const sources = parseSources(
    Array.isArray(raw.sources) ? raw.sources : raw.source ? [raw.source] : [],
  );
  if (sources.length === 0) throw new ProjectError("empty");
  return {
    schemaVersion: PROJECT_SCHEMA,
    app: "DownKit",
    savedAt: typeof raw.savedAt === "string" ? raw.savedAt : new Date(0).toISOString(),
    name:
      typeof raw.name === "string" && raw.name
        ? raw.name
        : sources[0].title.replace(/\.[^.]+$/, ""),
    sources,
    clips: parseClips(raw.clips),
    texts: parseTexts(raw.texts),
    images: parseImages(raw.images),
    music: parseMusic(raw.music),
    blurs: parseBlurs(raw.blurs),
    effects: parseEffects(raw.effects),
    tracks: parseTracks(raw.tracks),
    exportOptions:
      raw.exportOptions &&
      typeof raw.exportOptions === "object" &&
      !Array.isArray(raw.exportOptions)
        ? (raw.exportOptions as Record<string, unknown>)
        : undefined,
    projectPath: typeof raw.projectPath === "string" ? raw.projectPath : null,
    dirty: raw.dirty === true,
  };
}

export function serializeProject(data: ProjectData): string {
  return JSON.stringify({ ...data, schemaVersion: PROJECT_SCHEMA, app: "DownKit" }, null, 2);
}

/** Kaynak yolları yeniden bağlanınca (eksik medya) proje güncellenir. */
export function relinkSources(data: ProjectData, paths: Record<string, string>): ProjectData {
  return {
    ...data,
    sources: data.sources.map((s) => (paths[s.id] ? { ...s, path: paths[s.id] } : s)),
  };
}

/** Kaynağı atla: kaynak ve ona ait klipler projeden çıkar. */
export function dropSources(data: ProjectData, ids: readonly string[]): ProjectData {
  if (ids.length === 0) return data;
  return {
    ...data,
    sources: data.sources.filter((s) => !ids.includes(s.id)),
    clips: data.clips.filter((c) => !c.sourceId || !ids.includes(c.sourceId)),
  };
}

/** Eksik bir dosya başka klasörde bulununca, diğer eksiklerin de aynı klasörde
 * olma ihtimaline karşı aday yollar (aynı ad, yeni klasör). */
export function siblingCandidates(
  found: string,
  missing: readonly ProjectSource[],
): Record<string, string> {
  const dir = found.slice(0, Math.max(found.lastIndexOf("\\"), found.lastIndexOf("/")) + 1);
  const out: Record<string, string> = {};
  for (const s of missing) out[s.id] = dir + fileName(s.path);
  return out;
}
