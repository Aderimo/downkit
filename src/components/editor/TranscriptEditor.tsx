import { useMemo, useState } from "react";
import { HelpTip } from "../ui/HelpTip";
import { useTranslation } from "react-i18next";
import { ArrowUp, Move, Pencil, Scissors, Search, Smile, Star, X } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { usePlayerStore } from "../../store/playerStore";
import { editLineText, removeWord, shiftCaptions, toggleEmphasis } from "../../lib/captionEdit";
import { seekTimeline } from "../../lib/sequencePlayer";
import { EMOJI_PICKS, suggestEmoji } from "../../lib/captionEmoji";
import { setLineEmoji } from "../../lib/captionActions";
import { useFillers } from "../../lib/fillers";
import {
  cutLine,
  cutSelection,
  flatWords,
  moveSelectionBefore,
  selectionSpan,
  spanRange,
  useTranscriptSelection,
  type WordRef,
} from "../../lib/transcriptEdit";
import { formatTimecode } from "../../lib/timeline";
import type { TextItem } from "../../lib/textItems";

// Transkript: otomatik altyazılar satır satır, kelimeler çip olarak. Kelimeye tıkla →
// o ana git; yıldız → anahtar kelime (hep vurgulu); kalem → satırı düzelt; × → kelimeyi
// yalnız altyazıdan sil. Metinden kurgu: kelimeleri sürükleyerek ya da Shift+tıklayarak
// seç → videodan kes ya da başka cümlenin önüne taşı; makas → cümlenin tamamını kes.

function update(id: string, fn: (t: TextItem) => TextItem | null) {
  useEditorStore.getState().applyTexts((texts) =>
    texts.flatMap((t) => {
      if (t.id !== id) return [t];
      const next = fn(t);
      return next ? [next] : [];
    }),
  );
}

// Sürükleyerek seçim: basılan kelime, Shift+tık için son tıklanan kelime.
let pressed: WordRef | null = null;
let lastClicked: WordRef | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("pointerup", () => {
    pressed = null;
  });
}

const sameRef = (a: WordRef | null, b: WordRef) =>
  !!a && a.textId === b.textId && a.index === b.index;

const normalize = (s: string) =>
  s
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .toLocaleLowerCase("tr")
    .trim();

interface LineProps {
  item: TextItem;
  active: boolean;
  /** Bu satırdaki dolgu kelimelerinin sırası (Kısalt panelinde bulunanlar). */
  fillers?: ReadonlySet<number>;
  /** Seçili kelimelerin sırası. */
  selected?: ReadonlySet<number>;
  /** Aramada bulunan kelimelerin sırası. */
  matches?: ReadonlySet<number>;
  /** Taşıma hedefi seçiliyor: satırın önüne "buraya taşı" düğmesi. */
  moveTarget: boolean;
  onStatus: (text: string) => void;
}

function Line({ item, active, fillers, selected, matches, moveTarget, onStatus }: LineProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  const [picking, setPicking] = useState(false);
  const time = usePlayerStore((s) => (active ? s.currentTime : -1));
  const words = item.words ?? [];

  function commit() {
    setEditing(false);
    if (draft.trim() !== item.text.trim()) {
      update(item.id, (x) => {
        const next = editLineText(x, draft);
        return next.text ? next : null;
      });
    }
  }

  return (
    <li
      data-transcript-line={item.id}
      className={`space-y-1 rounded-lg border p-2 ${
        active ? "border-[var(--dk-accent)] bg-[var(--dk-accent)]/10" : "border-[var(--dk-border)]"
      }`}
    >
      {moveTarget ? (
        <button
          type="button"
          data-move-target={item.id}
          onClick={() => {
            if (moveSelectionBefore(item.id)) onStatus(t("transcript.moved"));
          }}
          className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-[#60a5fa] py-0.5 text-[11px] text-[#93c5fd] hover:bg-[#60a5fa]/15"
        >
          <ArrowUp size={11} />
          {t("transcript.moveHere")}
        </button>
      ) : null}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => seekTimeline(item.start)}
          className="font-mono text-[10px] text-[var(--dk-text-muted)] hover:text-white"
          title={t("transcript.seek")}
        >
          {formatTimecode(item.start, 1)}
        </button>
        <span className="flex-1" />
        <button
          type="button"
          aria-label={t("transcript.emoji")}
          aria-expanded={picking}
          title={t("transcript.emoji")}
          onClick={() => setPicking(!picking)}
          className={`flex h-5 min-w-5 items-center justify-center rounded px-0.5 text-xs hover:bg-white/10 ${
            item.emoji ? "" : "text-[var(--dk-text-muted)] hover:text-white"
          }`}
        >
          {item.emoji ?? <Smile size={12} />}
        </button>
        <button
          type="button"
          aria-label={t("transcript.edit")}
          title={t("transcript.edit")}
          onClick={() => {
            setDraft(item.text);
            setEditing(!editing);
          }}
          className="rounded p-0.5 text-[var(--dk-text-muted)] hover:bg-white/10 hover:text-white"
        >
          <Pencil size={12} />
        </button>
        <button
          type="button"
          aria-label={t("transcript.cutLine")}
          title={t("transcript.cutLine")}
          onClick={() => {
            const removed = cutLine(item.id);
            if (removed > 0) onStatus(t("transcript.cut", { seconds: removed.toFixed(1) }));
          }}
          className="rounded p-0.5 text-[var(--dk-text-muted)] hover:bg-[#f87171]/20 hover:text-[#f87171]"
        >
          <Scissors size={12} />
        </button>
      </div>
      {picking ? <EmojiPicker item={item} onClose={() => setPicking(false)} /> : null}
      {editing ? (
        <input
          autoFocus
          value={draft}
          aria-label={t("transcript.edit")}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(item.text);
              setEditing(false);
            }
          }}
          className="h-7 w-full rounded-md border border-[var(--dk-accent)] bg-[var(--dk-surface-2)] px-2 text-xs outline-none"
        />
      ) : (
        <div className="flex flex-wrap gap-1">
          {(words.length > 0 ? words : [{ text: item.text, start: item.start, end: item.end }]).map(
            (w, i) => {
              const ref = { textId: item.id, index: i };
              const speaking = active && time >= w.start && time < w.end + 0.05;
              const emph = "emph" in w && w.emph;
              const filler = fillers?.has(i) ?? false;
              const isSelected = selected?.has(i) ?? false;
              const match = matches?.has(i) ?? false;
              return (
                <span
                  key={i}
                  data-word-chip
                  data-filler-word={filler || undefined}
                  data-selected={isSelected || undefined}
                  data-match={match || undefined}
                  title={filler ? t("transcript.filler") : undefined}
                  className={`group relative inline-flex items-center rounded-md text-xs ${
                    filler
                      ? "underline decoration-[#fb923c] decoration-wavy underline-offset-2 "
                      : ""
                  }${match ? "ring-1 ring-[#ffd43b] " : ""}${
                    isSelected
                      ? "bg-[#60a5fa]/35 text-white"
                      : speaking
                        ? "bg-[var(--dk-accent)] text-white"
                        : emph
                          ? "bg-[#ffd43b]/20 text-[#ffd43b]"
                          : "bg-[var(--dk-bg)] text-[var(--dk-text)]"
                  }`}
                >
                  <button
                    type="button"
                    className="px-1.5 py-0.5 select-none"
                    onPointerDown={() => {
                      pressed = ref;
                    }}
                    onPointerEnter={(e) => {
                      if (pressed && e.buttons === 1 && !sameRef(pressed, ref)) {
                        useTranscriptSelection.getState().select(pressed, ref);
                      }
                    }}
                    onClick={(e) => {
                      const selection = useTranscriptSelection.getState();
                      if (e.shiftKey && lastClicked) {
                        selection.select(lastClicked, ref);
                        return;
                      }
                      if (selection.anchor) selection.clear();
                      lastClicked = ref;
                      seekTimeline(w.start);
                    }}
                  >
                    {w.text}
                  </button>
                  {words.length > 0 ? (
                    <span className="hidden items-center pr-0.5 group-hover:flex">
                      <button
                        type="button"
                        aria-label={t("transcript.emphasis", { word: w.text })}
                        title={t("transcript.emphasis", { word: w.text })}
                        onClick={() => update(item.id, (x) => toggleEmphasis(x, i))}
                        className="rounded p-0.5 hover:bg-white/15"
                      >
                        <Star size={10} fill={emph ? "currentColor" : "none"} />
                      </button>
                      <button
                        type="button"
                        aria-label={t("transcript.removeWord", { word: w.text })}
                        title={t("transcript.removeWord", { word: w.text })}
                        onClick={() => update(item.id, (x) => removeWord(x, i))}
                        className="rounded p-0.5 hover:bg-white/15"
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ) : null}
                </span>
              );
            },
          )}
        </div>
      )}
    </li>
  );
}

/** Satırın emojisi: önerilen önce, sonra sık kullanılanlar; kaldırma düğmesi. */
function EmojiPicker({ item, onClose }: { item: TextItem; onClose: () => void }) {
  const { t } = useTranslation();
  const suggested = suggestEmoji(item);
  const choices = suggested
    ? [suggested, ...EMOJI_PICKS.filter((e) => e !== suggested)]
    : EMOJI_PICKS;
  const pick = (emoji: string | undefined) => {
    setLineEmoji(item.id, emoji);
    onClose();
  };
  return (
    <div
      className="rounded-md bg-[var(--dk-bg)] p-1.5"
      role="group"
      aria-label={t("transcript.emoji")}
    >
      <div className="grid grid-cols-8 gap-0.5">
        {choices.map((e) => (
          <button
            key={e}
            type="button"
            aria-pressed={item.emoji === e}
            title={e === suggested ? t("transcript.emojiSuggested") : undefined}
            onClick={() => pick(e)}
            className={`h-7 rounded text-base hover:bg-white/10 ${
              item.emoji === e
                ? "bg-[var(--dk-accent)]/30"
                : e === suggested
                  ? "ring-1 ring-[#ffd43b]/60"
                  : ""
            }`}
          >
            {e}
          </button>
        ))}
      </div>
      {item.emoji ? (
        <button
          type="button"
          onClick={() => pick(undefined)}
          className="mt-1 w-full rounded py-1 text-[11px] text-[var(--dk-text-muted)] hover:bg-white/10 hover:text-white"
        >
          {t("transcript.emojiRemove")}
        </button>
      ) : null}
    </div>
  );
}

/** Satır kimliği → kelime sıraları. */
function indexBy(items: readonly WordRef[]): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  for (const w of items) {
    if (!map.has(w.textId)) map.set(w.textId, new Set());
    map.get(w.textId)!.add(w.index);
  }
  return map;
}

export function TranscriptEditor() {
  const { t } = useTranslation();
  const texts = useEditorStore((s) => s.texts);
  const hits = useFillers();
  const anchor = useTranscriptSelection((s) => s.anchor);
  const focus = useTranscriptSelection((s) => s.focus);
  const moving = useTranscriptSelection((s) => s.moving);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const fillerIndex = useMemo(() => indexBy(hits), [hits]);
  const words = useMemo(() => flatWords(texts), [texts]);
  const span = selectionSpan(words, anchor, focus);
  const selectedIndex = useMemo(
    () => indexBy(span ? words.slice(span[0], span[1] + 1) : []),
    [words, span],
  );
  const found = useMemo(() => {
    const q = normalize(query);
    return q ? words.filter((w) => normalize(w.text).includes(q)) : [];
  }, [words, query]);
  const matchIndex = useMemo(() => indexBy(found), [found]);
  const lines = useMemo(
    () => texts.filter((x) => x.auto).sort((a, b) => a.start - b.start),
    [texts],
  );
  const activeId = usePlayerStore(
    (s) => lines.find((l) => s.currentTime >= l.start && s.currentTime < l.end)?.id ?? null,
  );
  if (lines.length === 0) return null;
  const shift = (delta: number) =>
    useEditorStore.getState().applyTexts((all) =>
      shiftCaptions(
        all,
        all.filter((x) => x.auto).map((x) => x.id),
        delta,
      ),
    );
  const range = span ? spanRange(words, span) : null;
  const selection = useTranscriptSelection.getState();

  function nextMatch() {
    if (found.length === 0) return;
    const w = found[cursor % found.length];
    setCursor(cursor + 1);
    seekTimeline(w.start);
    document
      .querySelector(`[data-transcript-line="${w.textId}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }

  return (
    <div className="space-y-2" data-transcript>
      <div className="flex items-center gap-2">
        <p className="text-xs font-semibold text-white">{t("transcript.title")}</p>
        <HelpTip
          title={t("transcript.title")}
          text={`${t("transcript.hint")}\n\n${t("transcript.selectHint")}`}
        />
        <span className="flex-1" />
        <span className="text-[10px] text-[var(--dk-text-muted)]">{t("transcript.sync")}</span>
        <button
          type="button"
          onClick={() => shift(-0.1)}
          className="rounded-md bg-[var(--dk-bg)] px-1.5 py-0.5 font-mono text-[10px] hover:bg-white/10"
          title={t("transcript.earlier")}
        >
          −0.1
        </button>
        <button
          type="button"
          onClick={() => shift(0.1)}
          className="rounded-md bg-[var(--dk-bg)] px-1.5 py-0.5 font-mono text-[10px] hover:bg-white/10"
          title={t("transcript.later")}
        >
          +0.1
        </button>
      </div>
      <label className="flex h-7 items-center gap-1.5 rounded-md border border-[var(--dk-border)] bg-[var(--dk-bg)] px-2">
        <Search size={12} className="shrink-0 text-[var(--dk-text-muted)]" />
        <input
          value={query}
          placeholder={t("transcript.search")}
          aria-label={t("transcript.search")}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") nextMatch();
            if (e.key === "Escape") setQuery("");
          }}
          className="min-w-0 flex-1 bg-transparent text-xs outline-none"
        />
        {query ? (
          <span
            className="shrink-0 font-mono text-[10px] text-[var(--dk-text-muted)]"
            data-search-count
          >
            {t("transcript.found", { count: found.length })}
          </span>
        ) : null}
      </label>
      {span && range ? (
        <div
          className="space-y-1.5 rounded-lg border border-[#60a5fa]/60 bg-[#60a5fa]/10 p-2"
          data-transcript-selection
        >
          <p className="text-[11px] text-white">
            {moving
              ? t("transcript.moveHint")
              : t("transcript.selected", {
                  count: span[1] - span[0] + 1,
                  seconds: (range.end - range.start).toFixed(1),
                })}
          </p>
          <div className="flex gap-1.5">
            {!moving ? (
              <>
                <button
                  type="button"
                  aria-label={t("transcript.cutSelection")}
                  title={t("transcript.cutSelection")}
                  onClick={() => {
                    const removed = cutSelection();
                    if (removed > 0)
                      setStatus(t("transcript.cut", { seconds: removed.toFixed(1) }));
                  }}
                  className="flex flex-1 items-center justify-center gap-1 rounded-md bg-[#f87171] py-1 text-[11px] font-bold text-[#111]"
                >
                  <Scissors size={12} />
                  {t("transcript.cutShort")}
                </button>
                <button
                  type="button"
                  onClick={() => selection.setMoving(true)}
                  className="flex flex-1 items-center justify-center gap-1 rounded-md bg-[var(--dk-surface)] py-1 text-[11px] font-bold"
                >
                  <Move size={12} />
                  {t("transcript.move")}
                </button>
              </>
            ) : null}
            <button
              type="button"
              aria-label={t("transcript.cancelSelection")}
              title={t("transcript.cancelSelection")}
              onClick={() => selection.clear()}
              className="rounded-md bg-[var(--dk-surface)] px-2 py-1 text-[11px]"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      ) : null}
      {status ? (
        <p className="text-[11px] text-[#4ade80]" role="status">
          {status}
        </p>
      ) : null}
      <ul className="dk-scroll max-h-80 space-y-1.5 overflow-y-auto pr-1">
        {lines.map((line) => (
          <Line
            key={line.id}
            item={line}
            active={line.id === activeId}
            fillers={fillerIndex.get(line.id)}
            selected={selectedIndex.get(line.id)}
            matches={matchIndex.get(line.id)}
            moveTarget={moving && !selectedIndex.has(line.id)}
            onStatus={setStatus}
          />
        ))}
      </ul>
    </div>
  );
}
