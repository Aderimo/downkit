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
