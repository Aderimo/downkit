import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { usePhoneTemplate } from "../../lib/phoneSafe";
import { missingFiles, shareIssues, type ShareIssue } from "../../lib/shareCheck";
import { pathsExist } from "../../lib/tauri-api";

/** Paylaşmadan önce kontrol: dışa aktarma panelinde canlı uyarı listesi. */
export function ShareCheck() {
  const { t, i18n } = useTranslation();
  const nf = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 });
  const clips = useEditorStore((s) => s.clips);
  const tracks = useEditorStore((s) => s.tracks);
  const texts = useEditorStore((s) => s.texts);
  const images = useEditorStore((s) => s.images);
  const music = useEditorStore((s) => s.music);
  const sources = useEditorStore((s) => s.sources);
  const frame = useEditorStore((s) => s.exportOptions.frame);
  const loudness = useEditorStore((s) => s.exportOptions.loudness);
  const template = usePhoneTemplate((s) => s.template);
  const [missing, setMissing] = useState<string[]>([]);
  const info = sources[0]?.source.info;
  const issues: ShareIssue[] = shareIssues({
    clips,
    tracks,
    texts,
    images,
    music,
    frame,
    loudness,
    sourceAspect: info?.width && info.height ? info.width / info.height : null,
    template,
  });
  useEffect(() => {
    let alive = true;
    const paths = [
      ...sources.map((s) => s.source.path),
      ...images.map((i) => i.path),
      ...music.map((m) => m.path),
    ];
    missingFiles(paths, pathsExist)
      .then((names) => alive && setMissing(names))
      .catch(() => alive && setMissing([]));
    return () => {
      alive = false;
    };
  }, [sources, images, music]);
  const all: ShareIssue[] = missing.length
    ? [
        { id: "missing", level: "warn", params: { names: missing.slice(0, 3).join(", ") } },
        ...issues,
      ]
    : issues;
  return (
    <div
      className="space-y-1.5 rounded-xl border border-[var(--dk-border)] bg-[var(--dk-bg)]/40 p-3"
      data-share-check
    >
      <p className="text-xs font-semibold">{t("shareCheck.title")}</p>
      {all.length === 0 ? (
        <p className="flex items-center gap-1.5 text-[11px] text-[var(--dk-success,#22c55e)]">
          <CheckCircle2 size={13} />
          {t("shareCheck.ok")}
        </p>
      ) : (
        <ul className="space-y-1">
          {all.map((issue) => (
            <li
              key={issue.id}
              data-issue={issue.id}
              className={`flex items-start gap-1.5 text-[11px] ${
                issue.level === "warn" ? "text-[var(--dk-warning)]" : "text-[var(--dk-text-muted)]"
              }`}
            >
              {issue.level === "warn" ? (
                <AlertTriangle size={13} className="mt-px shrink-0" />
              ) : (
                <Info size={13} className="mt-px shrink-0" />
              )}
              <span>
                {t(
                  `shareCheck.${issue.id}`,
                  Object.fromEntries(
                    Object.entries(issue.params ?? {}).map(([k, v]) => [
                      k,
                      typeof v === "number" ? nf.format(v) : v,
                    ]),
                  ),
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
