// SRT altyazı dosyası → zaman damgalı satırlar. Düzenleyici her satırı bir yazı
// katmanı yapar (sonra tek tek düzenlenebilir).

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

const TIME = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

function seconds(stamp: string): number | null {
  const m = TIME.exec(stamp);
  if (!m) return null;
  const [, h, min, s, ms] = m;
  return Number(h) * 3600 + Number(min) * 60 + Number(s) + Number(ms.padEnd(3, "0")) / 1000;
}

/** Bozuk bloklar atlanır; <i>, {\an8} gibi biçim etiketleri temizlenir. */
export function parseSrt(text: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  for (const block of text.replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
    const lines = block.split("\n").map((l) => l.trim());
    const timing = lines.findIndex((l) => l.includes("-->"));
    if (timing < 0) continue;
    const [a, b] = lines[timing].split("-->");
    const start = seconds(a);
    const end = seconds(b ?? "");
    if (start === null || end === null || end <= start) continue;
    const body = lines
      .slice(timing + 1)
      .join("\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\{\\[^}]*\}/g, "")
      .trim();
    if (body) cues.push({ start, end, text: body });
  }
  return cues;
}

// ——— Dışa aktarma: SRT ve VTT ———

function stamp(seconds: number, separator: "," | "."): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)}${separator}${p(ms % 1000, 3)}`;
}

/** Yazı satırları → SRT (zamana göre sıralı; boş satırlar atlanır). */
export function toSrt(cues: readonly SubtitleCue[]): string {
  return [...cues]
    .filter((c) => c.text.trim() && c.end > c.start)
    .sort((a, b) => a.start - b.start)
    .map((c, i) => `${i + 1}\n${stamp(c.start, ",")} --> ${stamp(c.end, ",")}\n${c.text.trim()}\n`)
    .join("\n");
}

/** Yazı satırları → WebVTT. */
export function toVtt(cues: readonly SubtitleCue[]): string {
  const body = [...cues]
    .filter((c) => c.text.trim() && c.end > c.start)
    .sort((a, b) => a.start - b.start)
    .map((c) => `${stamp(c.start, ".")} --> ${stamp(c.end, ".")}\n${c.text.trim()}\n`)
    .join("\n");
  return `WEBVTT\n\n${body}`;
}
