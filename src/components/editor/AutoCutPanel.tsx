import { useEffect, useState, type ReactNode } from "react";
import { HelpTip } from "../ui/HelpTip";
import { useTranslation } from "react-i18next";
import {
  Captions,
  FolderDown,
  Gauge,
  Loader2,
  Play,
  ScissorsLineDashed,
  Search,
  Sparkles,
} from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import {
  findSilences,
  removeSilences,
  silenceKey,
  useSilenceStore,
  useTimelineSilences,
  currentlyMostlySilent,
} from "../../lib/silence";
import { rangesDuration } from "../../lib/rangeCut";
import { seekTimeline } from "../../lib/sequencePlayer";
import { formatTimecode } from "../../lib/timeline";
import { localizeError } from "../../lib/errors";
import { Button } from "../ui/Button";
import { isSelected, removeFillers, useFillers, useFillerStore } from "../../lib/fillers";
import { useAddTool } from "../../lib/editorPanel";
import {
  keepOnly,
  makeSuggestions,
  saveDrafts,
  SUGGEST_LENGTHS,
  useSuggestStore,
} from "../../lib/clipSuggest";
import { sequenceEnd } from "../../lib/sequence";
import {
  applyShortenPlan,
  makeShortenPlan,
  planResult,
  SHORTEN_TARGETS,
  useShortenStore,
} from "../../lib/shorten";

// "Kısalt" paneli: sessizlikleri bul → listede gözden geçir (kalsın / kes) → tek tıkla sil.
// Kesim bütün izlerde yapılır; altyazılar, logo ve videodan ayrılmış ses de birlikte kayar.

function Row({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <div className="space-y-1 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-[var(--dk-text-muted)]">{label}</span>
        <span className="font-mono text-[11px]">{value}</span>
      </div>
      {children}
    </div>
  );
}

export function AutoCutPanel() {
  const { t } = useTranslation();
  const status = useSilenceStore((s) => s.status);
  const error = useSilenceStore((s) => s.error);
  const options = useSilenceStore((s) => s.options);
  const analyzed = useSilenceStore((s) => s.analyzed);
  const voice = useSilenceStore((s) => s.voice);
  const kept = useSilenceStore((s) => s.kept);
  const setOptions = useSilenceStore((s) => s.setOptions);
  const toggleKept = useSilenceStore((s) => s.toggleKept);
  const hasAudio = useEditorStore((s) => s.sources.some((x) => x.source.info.audioCodec !== null));
  const ranges = useTimelineSilences();
  const [done, setDone] = useState<string | null>(null);
  const cut = ranges.filter((r) => !kept.includes(silenceKey(r)));
  const seconds = rangesDuration(cut);
  const stale =
    status === "done" &&
    (analyzed?.noiseDb !== options.noiseDb || analyzed?.minSeconds !== options.minSeconds);

  const find = () => {
    setDone(null);
    void findSilences().catch(() => {});
  };

  return (
    <div className="space-y-3" data-autocut>
      <ShortenCard />
      <SuggestCard />
      <div className="flex items-center gap-1.5 border-t border-[var(--dk-border)] pt-3">
        <p className="text-xs font-semibold text-white">{t("autoCut.title")}</p>
        <HelpTip title={t("autoCut.title")} text={t("autoCut.hint")} />
      </div>
      {!hasAudio ? (
        <p className="rounded-lg bg-[var(--dk-bg)] p-2 text-[11px] text-[var(--dk-text-muted)]">
          {t("autoCut.noAudio")}
        </p>
      ) : (
        <>
          <Row label={t("autoCut.threshold")} value={`${options.noiseDb} dB`}>
            <input
              type="range"
              min={-55}
              max={-20}
              step={1}
              value={options.noiseDb}
              aria-label={t("autoCut.threshold")}
              onChange={(e) => setOptions({ noiseDb: Number(e.target.value) })}
              className="dk-volume w-full"
            />
          </Row>
          <p className="-mt-1 text-[10px] text-[var(--dk-text-muted)]">
            {t("autoCut.thresholdHint")}
          </p>
          <Row
            label={t("autoCut.minSilence")}
            value={t("autoCut.seconds", { value: options.minSeconds.toFixed(1) })}
          >
            <input
              type="range"
              min={0.3}
              max={2}
              step={0.1}
              value={options.minSeconds}
              aria-label={t("autoCut.minSilence")}
              onChange={(e) => setOptions({ minSeconds: Number(e.target.value) })}
              className="dk-volume w-full"
            />
          </Row>
          <Row
            label={t("autoCut.pad")}
            value={t("autoCut.seconds", { value: options.pad.toFixed(2) })}
          >
            <input
              type="range"
              min={0}
              max={0.4}
              step={0.02}
              value={options.pad}
              aria-label={t("autoCut.pad")}
              onChange={(e) => setOptions({ pad: Number(e.target.value) })}
              className="dk-volume w-full"
            />
          </Row>
          <Button
            size="sm"
            variant={status === "done" && !stale ? "secondary" : "primary"}
            className="w-full"
            disabled={status === "running"}
            icon={
              status === "running" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Search size={14} />
              )
            }
            onClick={find}
          >
            {status === "running"
              ? t("autoCut.finding")
              : status === "done"
                ? t("autoCut.findAgain")
                : t("autoCut.find")}
          </Button>
          {status === "error" ? (
            <p className="text-[11px] text-[#f87171]">
              {localizeError(error, "autoCut.failed").message}
            </p>
          ) : null}
          {status === "done" ? (
            <div className="space-y-2">
              <p className="text-xs text-white" data-silence-summary>
                {ranges.length === 0
                  ? currentlyMostlySilent()
                    ? t("autoCut.noSpeech")
                    : t("autoCut.none")
                  : t("autoCut.summary", { count: cut.length, seconds: seconds.toFixed(1) })}
              </p>
              {voice ? (
                <p className="text-[10px] text-[var(--dk-text-muted)]">{t("autoCut.voiceTrack")}</p>
              ) : null}
              {ranges.length > 0 ? (
                <>
                  <ul className="dk-scroll max-h-64 space-y-1 overflow-y-auto pr-1">
                    {ranges.map((r) => {
                      const key = silenceKey(r);
                      const keep = kept.includes(key);
                      return (
                        <li
                          key={key}
                          data-silence-row={key}
                          className={`flex items-center gap-2 rounded-md px-2 py-1 text-xs ${
                            keep ? "bg-[var(--dk-bg)] opacity-60" : "bg-[#f87171]/10"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={!keep}
                            aria-label={t("autoCut.cutThis", { time: formatTimecode(r.start, 1) })}
                            onChange={() => toggleKept(key)}
                            className="accent-[#f87171]"
                          />
                          <button
                            type="button"
                            onClick={() => seekTimeline(Math.max(0, r.start - 0.5))}
                            className="font-mono text-[11px] hover:text-white"
                            title={t("autoCut.listen")}
                          >
                            {formatTimecode(r.start, 1)}
                          </button>
                          <span className="flex-1" />
                          <span className="rounded bg-black/30 px-1.5 font-mono text-[10px] text-[var(--dk-text-muted)]">
                            [..{(r.end - r.start).toFixed(1)}s]
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <Button
                    size="sm"
                    variant="primary"
                    className="w-full"
                    disabled={cut.length === 0}
                    icon={<ScissorsLineDashed size={14} />}
                    onClick={() => {
                      const removed = removeSilences();
                      setDone(t("autoCut.removed", { seconds: removed.toFixed(1) }));
                    }}
                  >
                    {t("autoCut.remove", { seconds: seconds.toFixed(1) })}
                  </Button>
                </>
              ) : null}
            </div>
          ) : null}
          {done ? (
            <p className="text-[11px] text-[#4ade80]" role="status">
              {done}
            </p>
          ) : null}
        </>
      )}
      <FillerSection />
    </div>
  );
}

const secs = (v: number) => v.toFixed(1);

/** Hedef süreye indir: sessizlik + dolgu + en az önemli cümleler; önce plan, sonra uygula. */
function ShortenCard() {
  const { t } = useTranslation();
  const duration = useEditorStore((s) => sequenceEnd(s.clips));
  const hasCaptions = useEditorStore((s) => s.texts.some((x) => x.auto && x.words?.length));
  const target = useShortenStore((s) => s.target);
  const plan = useShortenStore((s) => s.plan);
  const skipped = useShortenStore((s) => s.skipped);
  const busy = useShortenStore((s) => s.busy);
  const error = useShortenStore((s) => s.error);
  const [done, setDone] = useState<string | null>(null);
  // Zaman çizelgesi değişince eski plan geçersiz (aralıklar kaymış olabilir).
  const clips = useEditorStore((s) => s.clips);
  const texts = useEditorStore((s) => s.texts);
  useEffect(() => {
    useShortenStore.getState().reset();
  }, [clips, texts]);
  const after = plan ? planResult(plan, skipped) : duration;
  const sum = (ranges: readonly { start: number; end: number }[]) =>
    ranges.reduce((n, r) => n + r.end - r.start, 0);
  return (
    <div
      className="space-y-2 rounded-xl border border-[var(--dk-accent)]/50 bg-[var(--dk-accent)]/10 p-2.5"
      data-shorten
    >
      <div className="flex items-center gap-2">
        <Gauge size={14} className="text-[var(--dk-accent)]" />
        <p className="flex-1 text-xs font-semibold text-white">{t("shorten.title")}</p>
        <span className="font-mono text-[11px] text-[var(--dk-text-muted)]" data-shorten-now>
          {t("autoCut.seconds", { value: secs(duration) })}
        </span>
      </div>
      <div className="flex gap-1" role="group" aria-label={t("shorten.target")}>
        {SHORTEN_TARGETS.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={target === s}
            onClick={() => {
              setDone(null);
              useShortenStore.getState().setTarget(s);
            }}
            className={`flex-1 rounded-md py-1 text-[11px] font-semibold ${
              target === s
                ? "bg-[var(--dk-accent)] text-white"
                : "bg-[var(--dk-bg)] hover:bg-white/10"
            }`}
          >
            {t("shorten.under", { seconds: s })}
          </button>
        ))}
      </div>
      {duration <= target && !plan ? (
        <p className="text-[11px] text-[#4ade80]">{t("shorten.already", { seconds: target })}</p>
      ) : (
        <Button
          size="sm"
          variant={plan ? "secondary" : "primary"}
          className="w-full"
          disabled={busy}
          icon={busy ? <Loader2 size={14} className="animate-spin" /> : <Gauge size={14} />}
          onClick={() => {
            setDone(null);
            void makeShortenPlan();
          }}
        >
          {busy
            ? t("autoCut.finding")
            : plan
              ? t("shorten.replan")
              : t("shorten.plan", { seconds: target })}
        </Button>
      )}
      {error ? (
        <p className="text-[11px] text-[#f87171]">
          {localizeError(error, "autoCut.failed").message}
        </p>
      ) : null}
      {!hasCaptions && !plan ? (
        <p className="text-[10px] text-[var(--dk-text-muted)]">{t("shorten.needCaptions")}</p>
      ) : null}
      {plan ? (
        <div className="space-y-1.5 text-[11px]" data-shorten-plan>
          <div className="flex justify-between">
            <span>{t("shorten.silences", { count: plan.silences.length })}</span>
            <span className="font-mono">−{secs(sum(plan.silences))}</span>
          </div>
          <div className="flex justify-between">
            <span>{t("shorten.fillers", { count: plan.fillers.length })}</span>
            <span className="font-mono">−{secs(sum(plan.fillers))}</span>
          </div>
          {plan.sentences.length > 0 ? (
            <>
              <p className="pt-1 text-[var(--dk-text-muted)]">{t("shorten.sentences")}</p>
              <ul className="dk-scroll max-h-40 space-y-1 overflow-y-auto pr-1">
                {plan.sentences.map((s) => {
                  const on = !skipped.includes(s.textId);
                  return (
                    <li
                      key={s.textId}
                      data-shorten-sentence={s.textId}
                      className={`flex items-start gap-2 rounded-md px-2 py-1 ${on ? "bg-[#f87171]/10" : "bg-[var(--dk-bg)] opacity-60"}`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        aria-label={t("shorten.cutSentence", { text: s.text })}
                        onChange={() => useShortenStore.getState().toggleSentence(s.textId)}
                        className="mt-0.5 accent-[#f87171]"
                      />
                      <button
                        type="button"
                        onClick={() => seekTimeline(Math.max(0, s.start - 0.3))}
                        className="min-w-0 flex-1 text-left hover:text-white"
                      >
                        <span className="font-mono text-[10px] text-[var(--dk-text-muted)]">
                          {formatTimecode(s.start, 0)}
                        </span>{" "}
                        {s.text}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
          <p
            className={`pt-1 font-semibold ${after <= target + 0.05 ? "text-[#4ade80]" : "text-[#fbbf24]"}`}
            data-shorten-result
          >
            {after <= target + 0.05
              ? t("shorten.result", { before: secs(plan.before), after: secs(after) })
              : t("shorten.notReached", { after: secs(after), seconds: target })}
          </p>
          <Button
            size="sm"
            variant="primary"
            className="w-full"
            disabled={after >= plan.before - 0.05}
            icon={<ScissorsLineDashed size={14} />}
            onClick={() => {
              const removed = applyShortenPlan();
              setDone(t("autoCut.removed", { seconds: secs(removed) }));
            }}
          >
            {t("shorten.apply", { after: secs(after) })}
          </Button>
        </div>
      ) : null}
      {done ? (
        <p className="text-[11px] text-[#4ade80]" role="status">
          {done}
        </p>
      ) : null}
    </div>
  );
}

/** Uzun videodan klip önerileri: işaret, heyecanlı an, bölüm ve konuşma yoğunluğuna göre. */
function SuggestCard() {
  const { t } = useTranslation();
  const duration = useEditorStore((s) => sequenceEnd(s.clips));
  const hasCaptions = useEditorStore((s) => s.texts.some((x) => x.auto));
  const length = useSuggestStore((s) => s.length);
  const list = useSuggestStore((s) => s.list);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Zaman çizelgesi değişince eski öneriler geçersiz.
  const clips = useEditorStore((s) => s.clips);
  useEffect(() => {
    useSuggestStore.getState().setList(null);
  }, [clips]);
  // En kısa klipten (15 sn) 1.5 kat kısa videoda öneri anlamsız.
  if (duration < 22.5) return null;
  return (
    <div
      className="space-y-2 rounded-xl border border-[#4ade80]/40 bg-[#4ade80]/5 p-2.5"
      data-suggest
    >
      <div className="flex items-center gap-2">
        <Sparkles size={14} className="text-[#4ade80]" />
        <p className="flex-1 text-xs font-semibold text-white">{t("suggest.title")}</p>
        <HelpTip title={t("suggest.title")} text={t("suggest.hint")} />
      </div>
      <div className="flex items-center gap-1" role="group" aria-label={t("suggest.length")}>
        <span className="mr-1 text-[11px] text-[var(--dk-text-muted)]">{t("suggest.length")}</span>
        {SUGGEST_LENGTHS.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={length === s}
            onClick={() => useSuggestStore.getState().setLength(s)}
            className={`flex-1 rounded-md py-1 text-[11px] font-semibold ${
              length === s ? "bg-[#4ade80] text-[#111]" : "bg-[var(--dk-bg)] hover:bg-white/10"
            }`}
          >
            {t("shorten.under", { seconds: s })}
          </button>
        ))}
      </div>
      <Button
        size="sm"
        variant={list ? "secondary" : "primary"}
        className="w-full"
        icon={<Sparkles size={14} />}
        onClick={() => {
          setStatus(null);
          makeSuggestions();
        }}
      >
        {list ? t("suggest.again") : t("suggest.make")}
      </Button>
      {!hasCaptions ? (
        <p className="text-[10px] text-[var(--dk-text-muted)]">{t("suggest.better")}</p>
      ) : null}
      {list && list.length === 0 ? (
        <p className="text-[11px] text-white">{t("suggest.none")}</p>
      ) : null}
      {list && list.length > 0 ? (
        <>
          <ul className="space-y-1.5">
            {list.map((s, i) => (
              <li
                key={`${s.start}-${s.end}`}
                data-suggestion={i + 1}
                className="space-y-1 rounded-lg bg-[var(--dk-bg)] p-2 text-[11px]"
              >
                <div className="flex items-center gap-1.5">
                  <span className="flex h-4 w-4 items-center justify-center rounded bg-[#4ade80] text-[10px] font-bold text-[#111]">
                    {i + 1}
                  </span>
                  <span className="font-mono">
                    {formatTimecode(s.start, 0)}–{formatTimecode(s.end, 0)}
                  </span>
                  <span className="text-[var(--dk-text-muted)]">
                    · {t("autoCut.seconds", { value: Math.round(s.end - s.start) })}
                  </span>
                </div>
                {s.title ? <p className="truncate text-white">“{s.title}”</p> : null}
                {s.reasons.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {s.reasons.map((r) => (
                      <span key={r} className="rounded bg-white/10 px-1.5 text-[10px]">
                        {t(`suggest.reason.${r}`)}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => seekTimeline(s.start)}
                    className="flex flex-1 items-center justify-center gap-1 rounded-md bg-[var(--dk-surface)] py-1 font-semibold hover:bg-white/10"
                  >
                    <Play size={11} />
                    {t("suggest.watch")}
                  </button>
                  <button
                    type="button"
                    aria-label={t("suggest.openLabel", { number: i + 1 })}
                    onClick={() => keepOnly(s)}
                    className="flex flex-1 items-center justify-center gap-1 rounded-md bg-[#4ade80] py-1 font-bold text-[#111]"
                  >
                    <ScissorsLineDashed size={11} />
                    {t("suggest.open")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            variant="secondary"
            className="w-full"
            disabled={saving}
            icon={
              saving ? <Loader2 size={14} className="animate-spin" /> : <FolderDown size={14} />
            }
            onClick={() => {
              setSaving(true);
              void saveDrafts(list)
                .then((n) => setStatus(n > 0 ? t("suggest.saved", { count: n }) : null))
                .catch((err: unknown) =>
                  setStatus(localizeError(err, "suggest.saveFailed").message),
                )
                .finally(() => setSaving(false));
            }}
          >
            {t("suggest.saveAll")}
          </Button>
        </>
      ) : null}
      {status ? (
        <p className="text-[11px] text-[#4ade80]" role="status">
          {status}
        </p>
      ) : null}
    </div>
  );
}

/** Dolgu kelimeleri ve tekrarlar: altyazının kelime zamanlarından, anında. */
function FillerSection() {
  const { t } = useTranslation();
  const hasCaptions = useEditorStore((s) => s.texts.some((x) => x.auto && x.words?.length));
  const hits = useFillers();
  const choice = useFillerStore((s) => s.choice);
  const toggle = useFillerStore((s) => s.toggle);
  const [done, setDone] = useState<string | null>(null);
  const selected = hits.filter((h) => isSelected(h, choice));
  const seconds = selected.reduce((n, h) => n + (h.end - h.start), 0);
  return (
    <div className="space-y-2 border-t border-[var(--dk-border)] pt-3" data-fillers>
      <div className="flex items-center gap-1.5">
        <p className="text-xs font-semibold text-white">{t("fillers.title")}</p>
        <HelpTip title={t("fillers.title")} text={t("fillers.hint")} />
      </div>
      {!hasCaptions ? (
        <Button
          size="sm"
          variant="secondary"
          className="w-full"
          icon={<Captions size={14} />}
          onClick={() => useAddTool.getState().setTool("subtitles")}
        >
          {t("fillers.needCaptions")}
        </Button>
      ) : hits.length === 0 ? (
        <p className="text-xs text-white" data-filler-summary>
          {t("fillers.none")}
        </p>
      ) : (
        <>
          <p className="text-xs text-white" data-filler-summary>
            {t("fillers.summary", { count: selected.length, total: hits.length })}
          </p>
          <ul className="dk-scroll max-h-56 space-y-1 overflow-y-auto pr-1">
            {hits.map((h) => {
              const on = isSelected(h, choice);
              return (
                <li
                  key={h.key}
                  data-filler-row={h.word}
                  className={`flex items-center gap-2 rounded-md px-2 py-1 text-xs ${
                    on ? "bg-[#fb923c]/10" : "bg-[var(--dk-bg)] opacity-70"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    aria-label={t("fillers.cutThis", {
                      word: h.word,
                      time: formatTimecode(h.start, 1),
                    })}
                    onChange={() => toggle(h)}
                    className="accent-[#fb923c]"
                  />
                  <button
                    type="button"
                    onClick={() => seekTimeline(Math.max(0, h.start - 1))}
                    className="font-mono text-[11px] hover:text-white"
                    title={t("autoCut.listen")}
                  >
                    {formatTimecode(h.start, 1)}
                  </button>
                  <span className="min-w-0 flex-1 truncate font-semibold">{h.word}</span>
                  <span className="rounded bg-black/30 px-1.5 text-[10px] text-[var(--dk-text-muted)]">
                    {t(`fillers.kind.${h.kind}`)}
                  </span>
                </li>
              );
            })}
          </ul>
          <Button
            size="sm"
            variant="primary"
            className="w-full"
            disabled={selected.length === 0}
            icon={<ScissorsLineDashed size={14} />}
            onClick={() => {
              const removed = removeFillers();
              setDone(t("autoCut.removed", { seconds: removed.toFixed(1) }));
            }}
          >
            {t("fillers.remove", { count: selected.length, seconds: seconds.toFixed(1) })}
          </Button>
        </>
      )}
      {done ? (
        <p className="text-[11px] text-[#4ade80]" role="status">
          {done}
        </p>
      ) : null}
    </div>
  );
}
