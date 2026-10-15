import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Mic, Plus, Square, Volume2 } from "lucide-react";
import { SFX_KINDS, addSfx, playSfx, startVoiceover, type SfxKind } from "../../lib/sfx";

/** Ses efektleri (dinle, ekle) ve seslendirme kaydı. */
export function SfxAndVoice() {
  const { t } = useTranslation();
  const [note, setNote] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const stopRef = useRef<(() => Promise<unknown>) | null>(null);
  const add = (kind: SfxKind) => {
    setNote(null);
    addSfx(kind).catch(() => setNote(t("sfx.failed")));
  };
  const toggleVoice = async () => {
    setNote(null);
    if (recording && stopRef.current) {
      setRecording(false);
      try {
        await stopRef.current();
        setNote(t("voice.saved"));
      } catch {
        setNote(t("voice.failed"));
      }
      stopRef.current = null;
      return;
    }
    try {
      const session = await startVoiceover();
      stopRef.current = session.stop;
      setRecording(true);
    } catch {
      setNote(t("voice.noMic"));
    }
  };
  return (
    <div className="space-y-2" data-sfx>
      <p className="text-xs font-semibold">{t("sfx.title")}</p>
      <div className="grid grid-cols-2 gap-1.5">
        {SFX_KINDS.map((kind) => (
          <div
            key={kind}
            className="flex items-center gap-1 rounded-lg border border-[var(--dk-border)] px-1.5 py-1"
          >
            <button
              type="button"
              aria-label={t("sfx.listen", { name: t(`sfx.kinds.${kind}`) })}
              onClick={() => playSfx(kind)}
              className="text-[var(--dk-text-muted)] hover:text-[var(--dk-text)]"
            >
              <Volume2 size={12} />
            </button>
            <span className="min-w-0 flex-1 truncate text-[11px]">{t(`sfx.kinds.${kind}`)}</span>
            <button
              type="button"
              data-sfx-add={kind}
              aria-label={t("sfx.add", { name: t(`sfx.kinds.${kind}`) })}
              onClick={() => add(kind)}
              className="rounded bg-[var(--dk-bg)] p-0.5 hover:bg-[var(--dk-accent)] hover:text-white"
            >
              <Plus size={12} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => void toggleVoice()}
        aria-pressed={recording}
        className={`flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold ${
          recording
            ? "bg-[var(--dk-error)] text-white"
            : "border border-[var(--dk-border)] hover:border-[var(--dk-accent)]"
        }`}
      >
        {recording ? <Square size={13} /> : <Mic size={13} />}
        {recording ? t("voice.stop") : t("voice.start")}
      </button>
      {note ? <p className="text-[11px] text-[var(--dk-text-muted)]">{note}</p> : null}
    </div>
  );
}
