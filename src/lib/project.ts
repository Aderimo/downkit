import { create } from "zustand";
import { parseGradient, parseSplit } from "./splitLayout";
import { parseFrameTrack } from "./faceTrack";
import { parseAlsoFrames } from "./multiFormat";
import { parseProgressBar } from "./reelTemplates";
import i18n from "../i18n";
import { fitView, useEditorStore, type ExportOptions } from "../store/editorStore";
import {
  autosaveClear,
  autosaveRead,
  autosaveWrite,
  chooseProjectFile,
  chooseProjectSavePath,
  pathsExist,
  projectRead,
  projectSave,
} from "./tauri-api";
import {
  dropSources,
  parseProject,
  PROJECT_SCHEMA,
  ProjectError,
  projectNameFromPath,
  relinkSources,
  serializeProject,
  siblingCandidates,
  type ProjectData,
  type ProjectSource,
} from "./projectFile";
import { localizeError } from "./errors";
import { isMediaPath } from "./validation";
import { useStartFormat } from "./editorPanel";

// Proje dosyası, otomatik kayıt ve kurtarma.
//
// - Kaydet / Farklı kaydet / Aç: .downkit dosyası (Rust tarafı atomik yazar, eski sürümü yedekler).
// - Otomatik kayıt: her değişiklikten kısa süre sonra kurtarma dosyasına yazılır
//   (uygulama veri klasörü; Tauri yoksa localStorage). Düzenleyici bilerek
//   kapatılınca silinir; program beklenmedik kapanırsa açılışta "kaldığın yerden
//   devam" olarak sunulur.
// - Eksik medya: açılan projedeki dosya yerinde yoksa yeniden bağlama penceresi.

const LEGACY_SESSION_KEY = "downkit.editorSession";
const RECENT_KEY = "downkit.recentProjects";
const RECENT_LIMIT = 8;
const AUTOSAVE_DELAY = 800;

export interface RecentProject {
  path: string;
  name: string;
  savedAt: string;
}

interface MissingState {
  data: ProjectData;
  /** Yeri bulunamayan kaynaklar. */
  missing: ProjectSource[];
  /** Kullanıcının seçtiği yeni yollar (kaynak kimliği → yol). */
  relinked: Record<string, string>;
  /** Atlanacak kaynaklar. */
  skipped: string[];
  link: { path: string | null; dirty: boolean };
}

interface ProjectState {
  /** Bağlı proje dosyası (hiç kaydedilmediyse null). */
  path: string | null;
  name: string | null;
  /** Son kayıttan beri değişiklik var mı. */
  dirty: boolean;
  saving: boolean;
  /** Proje yüklenirken otomatik kayıt ve "değişti" işareti durur. */
  loading: boolean;
  missing: MissingState | null;
  error: string | null;
}

export const useProjectStore = create<ProjectState>(() => ({
  path: null,
  name: null,
  dirty: false,
  saving: false,
  loading: false,
  missing: null,
  error: null,
}));

const project = () => useProjectStore.getState();
const editor = () => useEditorStore.getState();

// ——— Düzenleyici durumu ↔ proje verisi ———

/** Şu anki düzenleyici durumunun proje verisi. */
export function currentProjectData(): ProjectData {
  const s = editor();
  const { path, name } = project();
  return {
    schemaVersion: PROJECT_SCHEMA,
    app: "DownKit",
    savedAt: new Date().toISOString(),
    name: name ?? s.sources[0]?.title.replace(/\.[^.]+$/, "") ?? "Proje",
    sources: s.sources.map((entry) => ({
      id: entry.id,
      path: entry.source.path,
      title: entry.title,
    })),
    clips: s.clips,
    texts: s.texts,
    images: s.images,
    music: s.music,
    blurs: s.blurs,
    effects: s.effects,
    tracks: s.tracks,
    exportOptions: { ...s.exportOptions },
    projectPath: path,
    dirty: project().dirty,
  };
}

/** Yalnızca bilinen dışa aktarma alanları geri yüklenir (eski/yabancı alan atılır). */
function mergeExportOptions(
  current: ExportOptions,
  saved: Record<string, unknown> | undefined,
): ExportOptions {
  if (!saved) return current;
  const out = { ...current } as Record<string, unknown>;
  for (const key of Object.keys(current)) {
    const value = saved[key];
    const base = out[key];
    if (value === undefined) continue;
    if (base === null || value === null || typeof value === typeof base) out[key] = value;
  }
  // Nesne alanları ayrıca doğrulanır (bozuk düzen dışa aktarmayı bozmasın).
  out.split = parseSplit(out.split);
  out.frameGradient = parseGradient(out.frameGradient);
  out.frameTrack = parseFrameTrack(out.frameTrack);
  out.frameTrackAspect =
    typeof out.frameTrackAspect === "number" && out.frameTrackAspect > 0 && out.frameTrack
      ? out.frameTrackAspect
      : null;
  out.alsoFrames = parseAlsoFrames(out.alsoFrames);
  out.progressBar = parseProgressBar(out.progressBar);
  return out as unknown as ExportOptions;
}

/**
 * Proje verisini düzenleyiciye yükler: kaynaklar sırayla açılır, açılamayanlar
 * atlanır; kliplerin kaynak kimlikleri çalışma zamanındaki kimliklere eşlenir.
 * Kaynak kalmazsa false döner.
 */
async function loadIntoEditor(data: ProjectData): Promise<boolean> {
  const [first, ...rest] = data.sources;
  if (!first) return false;
  await editor().openFile(first.path);
  let st = editor();
  if (st.phase !== "ready" || st.sources.length === 0) return false;
  const idMap = new Map<string, string>([[first.id, st.sources[0].id]]);
  const skipped: string[] = [];
  for (const saved of rest) {
    const before = editor().sources.length;
    await editor().addSourceFile(saved.path);
    st = editor();
    if (st.sources.length > before) idMap.set(saved.id, st.sources[st.sources.length - 1].id);
    else skipped.push(saved.title);
    // Ekleme hatası panelde kalıp sonraki eklemeleri engellemesin.
    if (st.addError) useEditorStore.setState({ addError: null });
  }
  const clips = data.clips.flatMap((clip) => {
    if (!clip.sourceId) return [clip];
    const mapped = idMap.get(clip.sourceId);
    return mapped ? [{ ...clip, sourceId: mapped }] : [];
  });
  const exportOptions = mergeExportOptions(editor().exportOptions, data.exportOptions);
  useEditorStore.setState({
    clips,
    texts: data.texts,
    images: data.images,
    music: data.music,
    blurs: data.blurs,
    effects: data.effects,
    tracks: data.tracks,
    exportOptions,
    selectedIds: [],
    past: [],
    future: [],
    view: fitView(clips, editor().duration),
    ...(skipped.length > 0
      ? {
          addError: {
            message: i18n.t("editor.resumeSkipped", { titles: skipped.join(", ") }),
            detail: null,
          },
        }
      : {}),
  });
  return true;
}

/** Eksik dosya yoksa doğrudan yükler; varsa yeniden bağlama penceresini açar. */
async function openData(
  data: ProjectData,
  link: { path: string | null; dirty: boolean },
): Promise<void> {
  let exists: boolean[];
  try {
    exists = await pathsExist(data.sources.map((s) => s.path));
  } catch {
    // Tauri dışında (tarayıcı önizlemesi) denetlenemez; açmayı dener.
    exists = data.sources.map(() => true);
  }
  const missing = data.sources.filter((_, i) => !exists[i]);
  if (missing.length > 0) {
    useProjectStore.setState({
      missing: { data, missing, relinked: {}, skipped: [], link },
      error: null,
    });
    return;
  }
  await finishOpen(data, link);
}

async function finishOpen(data: ProjectData, link: { path: string | null; dirty: boolean }) {
  useProjectStore.setState({ loading: true, missing: null, error: null });
  try {
    const ok = await loadIntoEditor(data);
    if (!ok) {
      useProjectStore.setState({ loading: false });
      return;
    }
    useProjectStore.setState({
      path: link.path,
      name: link.path ? projectNameFromPath(link.path) : data.name,
      dirty: link.dirty,
      loading: false,
    });
    scheduleAutosave();
  } catch (err) {
    useProjectStore.setState({
      loading: false,
      error: localizeError(err, "project.openFailed").message,
    });
  }
}

// ——— Eksik medya ———

/** Eksik kaynak için seçilen dosya; aynı klasörde diğer eksikler de varsa onlar da bağlanır. */
export async function relinkMissing(id: string, path: string): Promise<void> {
  const state = project().missing;
  if (!state) return;
  const relinked = { ...state.relinked, [id]: path };
  const others = state.missing.filter(
    (s) => s.id !== id && !relinked[s.id] && !state.skipped.includes(s.id),
  );
  if (others.length > 0) {
    const candidates = siblingCandidates(path, others);
    try {
      const ids = Object.keys(candidates);
      const found = await pathsExist(ids.map((k) => candidates[k]));
      ids.forEach((k, i) => {
        if (found[i]) relinked[k] = candidates[k];
      });
    } catch {
      // Denetlenemezse kullanıcı diğerlerini tek tek seçer.
    }
  }
  useProjectStore.setState({ missing: { ...state, relinked } });
}

export function skipMissing(id: string) {
  const state = project().missing;
  if (!state) return;
  const skipped = state.skipped.includes(id) ? state.skipped : [...state.skipped, id];
  const relinked = { ...state.relinked };
  delete relinked[id];
  useProjectStore.setState({ missing: { ...state, skipped, relinked } });
}

/** Eksikler bağlandı/atlandı: proje açılır. Bağlanan yol değiştiyse proje "değişti" sayılır. */
export async function continueMissing(): Promise<void> {
  const state = project().missing;
  if (!state) return;
  const data = dropSources(relinkSources(state.data, state.relinked), state.skipped);
  if (data.sources.length === 0) {
    useProjectStore.setState({ missing: null, error: i18n.t("project.nothingLeft") });
    return;
  }
  const changed = Object.keys(state.relinked).length > 0 || state.skipped.length > 0;
  await finishOpen(data, { path: state.link.path, dirty: state.link.dirty || changed });
}

export function cancelMissing() {
  useProjectStore.setState({ missing: null });
}

// ——— Kaydet / Aç ———

/** Projeyi dosyaya kaydeder. `as`: her zaman yer sorar. Kaydedildiyse true. */
export async function saveProject(options: { as?: boolean } = {}): Promise<boolean> {
  const s = editor();
  // Proje yüklenirken kaydetme: yükleme bitince bağlı yol ve durum yeniden yazılır.
  if (s.phase !== "ready" || s.sources.length === 0 || project().saving || project().loading)
    return false;
  let path = project().path;
  if (!path || options.as) {
    const suggested = `${project().name ?? currentProjectData().name}.downkit`;
    path = await chooseProjectSavePath(suggested);
    if (!path) return false;
  }
  useProjectStore.setState({ saving: true, error: null });
  const name = projectNameFromPath(path);
  try {
    const data = { ...currentProjectData(), name, projectPath: undefined, dirty: undefined };
    await projectSave(path, serializeProject(data));
    useProjectStore.setState({ path, name, dirty: false, saving: false });
    rememberRecent({ path, name, savedAt: data.savedAt });
    scheduleAutosave();
    return true;
  } catch (err) {
    useProjectStore.setState({
      saving: false,
      error: localizeError(err, "project.saveFailed").message,
    });
    return false;
  }
}

/** Proje dosyasını açar (yol verilmezse seçtirir). Video ya da ses seçilirse
 * yeni düzenleme olarak açılır (başlangıçta seçilen biçimle). */
export async function openProject(path?: string): Promise<void> {
  const chosen = path ?? (await chooseProjectFile());
  if (!chosen) return;
  if (isMediaPath(chosen)) {
    const editor = useEditorStore.getState();
    await editor.openFile(chosen);
    const frame = useStartFormat.getState().frame;
    const st = useEditorStore.getState();
    if (st.phase === "ready" && frame !== "original") st.setExportOptions({ frame });
    return;
  }
  useProjectStore.setState({ error: null });
  let data: ProjectData;
  try {
    data = parseProject(await projectRead(chosen));
  } catch (err) {
    if (err instanceof ProjectError) {
      useProjectStore.setState({ error: i18n.t(`project.error.${err.code}`) });
    } else {
      useProjectStore.setState({ error: localizeError(err, "project.openFailed").message });
      forgetRecent(chosen);
    }
    return;
  }
  rememberRecent({ path: chosen, name: projectNameFromPath(chosen), savedAt: data.savedAt });
  await openData(data, { path: chosen, dirty: false });
}

/** Düzenleyiciyi bilerek kapatır: kurtarma kaydı silinir, proje bağı kopar. */
export function closeProject() {
  editor().close();
  useProjectStore.setState({ path: null, name: null, dirty: false, missing: null, error: null });
  void discardRecovery();
}

// ——— Son projeler ———

export function recentProjects(): RecentProject[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    if (!Array.isArray(list)) return [];
    return list.filter(
      (r): r is RecentProject => !!r && typeof r.path === "string" && typeof r.name === "string",
    );
  } catch {
    return [];
  }
}

function writeRecent(list: RecentProject[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_LIMIT)));
  } catch {
    // Depolama yoksa liste yalnızca bu oturumda boş kalır.
  }
}

export function rememberRecent(entry: RecentProject) {
  const key = entry.path.toLowerCase();
  writeRecent([entry, ...recentProjects().filter((r) => r.path.toLowerCase() !== key)]);
}

export function forgetRecent(path: string) {
  const key = path.toLowerCase();
  writeRecent(recentProjects().filter((r) => r.path.toLowerCase() !== key));
}

/** Diskte artık olmayan projeler listeden düşer. */
export async function existingRecentProjects(): Promise<RecentProject[]> {
  const list = recentProjects();
  if (list.length === 0) return list;
  try {
    const exists = await pathsExist(list.map((r) => r.path));
    const kept = list.filter((_, i) => exists[i]);
    if (kept.length !== list.length) writeRecent(kept);
    return kept;
  } catch {
    return list;
  }
}

// ——— Otomatik kayıt ve kurtarma ———

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAutosave() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => void writeAutosave(), AUTOSAVE_DELAY);
}

export async function writeAutosave(): Promise<void> {
  autosaveTimer = null;
  const s = editor();
  if (s.phase !== "ready" || s.sources.length === 0 || project().loading) return;
  const text = serializeProject(currentProjectData());
  try {
    await autosaveWrite(text);
  } catch {
    try {
      localStorage.setItem(LEGACY_SESSION_KEY, text);
    } catch {
      // Hiçbir yere yazılamazsa yalnızca kurtarma önerisi çıkmaz.
    }
  }
}

/** Açılışta sunulacak kurtarma kaydı (yoksa null). */
export async function loadRecovery(): Promise<ProjectData | null> {
  let text = await autosaveRead().catch(() => null);
  if (!text) {
    try {
      text = localStorage.getItem(LEGACY_SESSION_KEY);
    } catch {
      text = null;
    }
  }
  if (!text) return null;
  try {
    return parseProject(text);
  } catch {
    return null;
  }
}

export async function discardRecovery(): Promise<void> {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = null;
  try {
    localStorage.removeItem(LEGACY_SESSION_KEY);
  } catch {
    // Depolama yoksa zaten kayıt da yoktur.
  }
  try {
    await autosaveClear();
  } catch {
    // Tauri dışında dosya yok.
  }
}

/** Kurtarma kaydını açar: bağlı proje dosyası ve "kaydedilmemiş" bilgisi korunur. */
export async function resumeRecovery(data: ProjectData): Promise<void> {
  await openData(data, { path: data.projectPath ?? null, dirty: data.dirty ?? false });
}

/** Kaynak listesinin kimliği: küçük resim / önizleme akışı güncellemeleri değişiklik sayılmaz. */
function sourcesKey(sources: ReturnType<typeof editor>["sources"]): string {
  return sources.map((s) => `${s.id}|${s.source.path}`).join(";");
}

// Düzenleyicideki her içerik değişikliği: proje "değişti" olur ve otomatik kayıt planlanır.
useEditorStore.subscribe((state, previous) => {
  // Düzenleyici kapandı ya da yeni bir dosya açıldı (proje yüklemesi dışında): proje bağı kopar.
  if (!project().loading) {
    const closed = state.phase === "empty" && previous.phase !== "empty";
    const freshOpen = state.phase === "ready" && previous.phase === "loading";
    if (closed || freshOpen) {
      useProjectStore.setState({ path: null, name: null, dirty: freshOpen });
    }
  }
  if (state.phase !== "ready" || state.sources.length === 0 || state.dragOrigin) return;
  if (project().loading) return;
  // Sürükleme bitti ve geri alma adımı yazıldı: bir şey değişti.
  const dragEnded =
    previous.dragOrigin !== null && state.dragOrigin === null && state.past !== previous.past;
  const changed =
    dragEnded ||
    state.clips !== previous.clips ||
    state.texts !== previous.texts ||
    state.images !== previous.images ||
    state.music !== previous.music ||
    state.blurs !== previous.blurs ||
    state.effects !== previous.effects ||
    state.tracks !== previous.tracks ||
    sourcesKey(state.sources) !== sourcesKey(previous.sources) ||
    state.exportOptions !== previous.exportOptions;
  if (!changed) return;
  if (!project().dirty) useProjectStore.setState({ dirty: true });
  scheduleAutosave();
});
