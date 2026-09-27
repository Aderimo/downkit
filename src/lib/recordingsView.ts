// Kayıtlarım görünümü: oyun / uygulama klasörüne göre süzme, güne göre gruplama
// ve sıralama. Varsayılan sıra eskiden yeniye: en yeni kayıt en altta.

import type { RecordingFile } from "../types/recorder";

export interface DayGroup {
  /** "2026-09-26" (yerel gün). */
  key: string;
  /** Günün başlangıcı (ms): başlık yazısı buradan üretilir. */
  dayStart: number;
  files: RecordingFile[];
}

export interface FolderCount {
  /** null: kayıt klasörünün kendisi (uygulamaya ayrılmamış). */
  name: string | null;
  count: number;
}

function dayKey(ms: number): { key: string; start: number } {
  const d = new Date(ms);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, start };
}

/** `folder`: undefined = tümü, null = ayrılmamış olanlar, ad = o klasör. */
export function groupRecordings(
  files: readonly RecordingFile[],
  folder: string | null | undefined,
  newestLast: boolean,
): DayGroup[] {
  const picked = files
    .filter((f) => folder === undefined || f.folder === folder)
    .sort((a, b) => (newestLast ? a.createdMs - b.createdMs : b.createdMs - a.createdMs));
  const groups: DayGroup[] = [];
  for (const file of picked) {
    const { key, start } = dayKey(file.createdMs);
    const last = groups.at(-1);
    if (last && last.key === key) last.files.push(file);
    else groups.push({ key, dayStart: start, files: [file] });
  }
  return groups;
}

/** Klasör çipleri: adlar alfabetik, ayrılmamışlar en sonda. */
export function folderCounts(files: readonly RecordingFile[]): FolderCount[] {
  const counts = new Map<string | null, number>();
  for (const f of files) counts.set(f.folder, (counts.get(f.folder) ?? 0) + 1);
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) =>
      a.name === null
        ? 1
        : b.name === null
          ? -1
          : a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
}

/** Gün başlığı: "today" / "yesterday" ya da tarih ("24 Eylül 2026"). */
export function dayLabelKind(dayStart: number, now: number): "today" | "yesterday" | "date" {
  const today = dayKey(now).start;
  if (dayStart === today) return "today";
  // Yaz saati geçişlerinde gün 23 ya da 25 saat sürebilir.
  const diff = today - dayStart;
  if (diff > 0 && diff <= 25 * 3_600_000) return "yesterday";
  return "date";
}
