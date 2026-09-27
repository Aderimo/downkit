// "Hatayı bildir" için panoya kopyalanan rapor. Kişisel bilgi sızmasın diye
// Windows kullanıcı adı içeren yollar gizlenir; ayrıntı makul uzunlukta kesilir.

export interface ReportInput {
  message: string;
  detail: string | null;
  /** Ör. "download · youtube · MP4 · 1080p" */
  context?: string | null;
}

const MAX_DETAIL = 3500;

/** "C:\Users\ahmet\Videos" → "C:\Users\<kullanıcı>\Videos" (ters/düz eğik çizgi). */
export function redactPaths(text: string): string {
  return text
    .replace(/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\s"']+/gi, "$1<user>")
    .replace(/(\/home\/)[^/\s"']+/g, "$1<user>");
}

const MAX_LOG = 2500;

export function buildErrorReport(
  input: ReportInput,
  appVersion: string | null,
  userAgent: string,
  recentLog = "",
): string {
  const log = redactPaths(recentLog).trim();
  const logTail = log.length > MAX_LOG ? `…${log.slice(log.length - MAX_LOG)}` : log;
  const windows = /Windows NT ([\d.]+)/.exec(userAgent)?.[1];
  const detail = input.detail ? redactPaths(input.detail).trim() : "";
  const trimmed =
    detail.length > MAX_DETAIL ? `…${detail.slice(detail.length - MAX_DETAIL)}` : detail;
  return [
    `DownKit ${appVersion ? `v${appVersion}` : "(sürüm ?)"} · Windows ${windows ?? "?"}`,
    input.context ? `İş: ${input.context}` : null,
    `Hata: ${redactPaths(input.message)}`,
    trimmed ? `\nAyrıntı:\n\`\`\`\n${trimmed}\n\`\`\`` : null,
    logTail ? `\nSon günlük:\n\`\`\`\n${logTail}\n\`\`\`` : null,
  ]
    .filter((line) => line !== null)
    .join("\n");
}
