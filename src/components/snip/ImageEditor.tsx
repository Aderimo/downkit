import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  ArrowUpRight,
  Circle,
  Copy,
  Crop,
  Droplet,
  FileDown,
  FolderOpen,
  Grid3x3,
  Hash,
  Highlighter,
  Languages,
  Pencil,
  Redo2,
  Save,
  ScanText,
  Square,
  Type,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  BOX_TOOLS,
  COLORS,
  clampCrop,
  nextStep,
  normalizeRect,
  render,
  strokeWidth,
  type Shape,
  type Tool,
  type TranslatedBox,
} from "../../lib/annotate";
import { canvasBytes, loadImage } from "../../lib/imageExport";
import { groupOcrBlocks, ocrLanguageFor, resolveDirection } from "../../lib/snip";
import { getSnipSettings, type ShotFormat } from "../../lib/snipSettings";
import { closeEditor, onShotSaved, resolveShotDir, shotName } from "../../lib/snipActions";
import { localizeError } from "../../lib/errors";
import {
  copyText,
  imageCopy,
  imageWrite,
  ocrImage,
  revealInFolder,
  translateText,
} from "../../lib/tauri-api";
import { useSnipStore } from "../../store/snipStore";
import type { SnipImage } from "../../types/snip";
import { Button } from "../ui/Button";

type EditorTool = Tool | "crop";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Geri alınabilen durum: şekiller ve kırpma. */
interface Doc {
  shapes: Shape[];
  crop: Box | null;
}

const TOOLS: { tool: EditorTool; icon: LucideIcon; key: string }[] = [
  { tool: "arrow", icon: ArrowUpRight, key: "A" },
  { tool: "rect", icon: Square, key: "R" },
  { tool: "ellipse", icon: Circle, key: "E" },
  { tool: "pen", icon: Pencil, key: "P" },
  { tool: "highlight", icon: Highlighter, key: "H" },
  { tool: "text", icon: Type, key: "T" },
  { tool: "step", icon: Hash, key: "N" },
  { tool: "blur", icon: Droplet, key: "B" },
  { tool: "pixelate", icon: Grid3x3, key: "X" },
  { tool: "crop", icon: Crop, key: "C" },
];

const HISTORY_LIMIT = 100;

/** Görüntü boyuna göre yazı ve adım boyları (kalınlık seçimi 1–3). */
function textSize(level: number, w: number, h: number) {
  return Math.round(Math.max(14, Math.max(w, h) / 70) * [1, 1.4, 2][level - 1]);
}
function stepSize(level: number, w: number, h: number) {
  return Math.round(Math.max(11, Math.max(w, h) / 100) * [1, 1.3, 1.7][level - 1]);
}

interface TextEdit {
  x: number;
  y: number;
  value: string;
}

interface OcrState {
  busy: "read" | "translate" | null;
  text: string | null;
  translated: string | null;
  error: string | null;
}

const EMPTY_OCR: OcrState = { busy: null, text: null, translated: null, error: null };
const NO_TRANSLATIONS: TranslatedBox[] = [];

/** Ekran görüntüsü düzenleyicisi: ok, şekil, kalem, vurgu, yazı, numaralı adım,
 * bulanıklaştırma, pikselleştirme, kırpma; kopyala / kaydet; yazıyı okuma ve
 * görsel çeviri. Şekiller görüntü pikselinde tutulur: ekranda ne görünüyorsa
 * dosyada o çıkar. */
export function ImageEditor({
  image,
  translateOnOpen,
}: {
  image: SnipImage;
  translateOnOpen: boolean;
}) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [tool, setTool] = useState<EditorTool>("arrow");
  const [color, setColor] = useState(COLORS[0]);
  const [level, setLevel] = useState(2);
  const [doc, setDoc] = useState<Doc>(() => ({
    shapes: useSnipStore.getState().demoShapes ?? [],
    crop: null,
  }));
  const [past, setPast] = useState<Doc[]>([]);
  const [future, setFuture] = useState<Doc[]>([]);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [draftCrop, setDraftCrop] = useState<Box | null>(null);
  const [textEdit, setTextEdit] = useState<TextEdit | null>(null);
  const [scale, setScale] = useState(1);
  const [dirty, setDirty] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [ocr, setOcr] = useState<OcrState>(EMPTY_OCR);
  const [translations, setTranslations] = useState<TranslatedBox[]>([]);
  const [showTranslation, setShowTranslation] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);

  const W = img?.naturalWidth ?? image.width;
  const H = img?.naturalHeight ?? image.height;

  useEffect(() => {
    let cancelled = false;
    loadImage(image.url)
      .then((loaded) => !cancelled && setImg(loaded))
      .catch(() => !cancelled && setLoadError(true));
    return () => {
      cancelled = true;
    };
  }, [image.url]);

  // Ekrandaki boyut / görüntü boyu: yazı kutusu ekranda doğru yerde ve boyda dursun.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !img) return;
    const observer = new ResizeObserver(() => {
      if (canvas.width > 0) setScale(canvas.clientWidth / canvas.width);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [img]);

  const commit = useCallback(
    (next: Doc) => {
      setPast((p) => [...p.slice(-(HISTORY_LIMIT - 1)), doc]);
      setFuture([]);
      setDoc(next);
      setDirty(true);
    },
    [doc],
  );

  const undo = useCallback(() => {
    if (past.length === 0) return;
    setFuture((f) => [doc, ...f]);
    setDoc(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
    setDirty(true);
  }, [doc, past]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    setPast((p) => [...p, doc]);
    setDoc(future[0]);
    setFuture((f) => f.slice(1));
    setDirty(true);
  }, [doc, future]);

  const visibleTranslations = useMemo(
    () => (showTranslation ? translations : NO_TRANSLATIONS),
    [showTranslation, translations],
  );

  // Ekrandaki tuval: görüntü, şekiller, çizilmekte olan şekil ve kırpma çerçevesi.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !img) return;
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    render(ctx, img, draft ? [...doc.shapes, draft] : doc.shapes, visibleTranslations);
    const crop = draftCrop ?? doc.crop;
    if (crop) {
      ctx.save();
      ctx.fillStyle = "rgb(0 0 0 / 55%)";
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.rect(crop.x, crop.y, crop.w, crop.h);
      ctx.fill("evenodd");
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = Math.max(1, W / 900);
      ctx.setLineDash([ctx.lineWidth * 6, ctx.lineWidth * 4]);
      ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);
      ctx.restore();
    }
  }, [img, doc, draft, draftCrop, visibleTranslations, W, H]);

  /** Dışa aktarılacak tuval: tam çözünürlük, kırpma uygulanmış, çerçevesiz. */
  const exportCanvas = useCallback((): HTMLCanvasElement | null => {
    if (!img) return null;
    const full = document.createElement("canvas");
    full.width = W;
    full.height = H;
    const ctx = full.getContext("2d");
    if (!ctx) return null;
    render(ctx, img, doc.shapes, visibleTranslations);
    if (!doc.crop) return full;
    const out = document.createElement("canvas");
    out.width = doc.crop.w;
    out.height = doc.crop.h;
    out
      .getContext("2d")
      ?.drawImage(
        full,
        doc.crop.x,
        doc.crop.y,
        doc.crop.w,
        doc.crop.h,
        0,
        0,
        doc.crop.w,
        doc.crop.h,
      );
    return out;
  }, [img, doc, visibleTranslations, W, H]);

  function toImage(e: { clientX: number; clientY: number }) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * W) / Math.max(1, r.width),
      y: ((e.clientY - r.top) * H) / Math.max(1, r.height),
    };
  }

  // Aynı yazı iki kez eklenmesin (Enter ile bitirip ardından kutu kaybolurken
  // gelen odak kaybı da bitirmeyi çağırabilir).
  const committedText = useRef<TextEdit | null>(null);
  const commitText = useCallback(() => {
    if (!textEdit || committedText.current === textEdit) return;
    committedText.current = textEdit;
    const text = textEdit.value.replace(/\s+$/, "");
    setTextEdit(null);
    if (!text.trim()) return;
    commit({
      ...doc,
      shapes: [
        ...doc.shapes,
        { kind: "text", x: textEdit.x, y: textEdit.y, text, color, size: textSize(level, W, H) },
      ],
    });
  }, [textEdit, commit, doc, color, level, W, H]);

  function onPointerDown(e: PointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0 || !img) return;
    // Tuvale tıklamak odağı değiştirmesin: yeni açılan yazı kutusu odağını
    // kaybedip yazılan harfler araç kısayolu sanılmasın.
    e.preventDefault();
    if (textEdit) {
      commitText();
      if (tool === "text") return;
    }
    const p = toImage(e);
    if (tool === "text") {
      setTextEdit({ x: p.x, y: p.y, value: "" });
      return;
    }
    if (tool === "step") {
      commit({
        ...doc,
        shapes: [
          ...doc.shapes,
          {
            kind: "step",
            x: p.x,
            y: p.y,
            n: nextStep(doc.shapes),
            color,
            size: stepSize(level, W, H),
          },
        ],
      });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = p;
    const width = strokeWidth(level, W, H);
    if (tool === "crop") {
      setDraftCrop({ x: p.x, y: p.y, w: 0, h: 0 });
    } else if (tool === "pen" || tool === "highlight") {
      setDraft({ kind: tool, points: [p.x, p.y], color, width });
    } else if (BOX_TOOLS.includes(tool)) {
      setDraft({
        kind: tool as "arrow" | "rect" | "ellipse" | "blur" | "pixelate",
        x1: p.x,
        y1: p.y,
        x2: p.x,
        y2: p.y,
        color,
        width,
      });
    }
  }

  function onPointerMove(e: PointerEvent<HTMLCanvasElement>) {
    if (!start.current) return;
    const p = toImage(e);
    if (draftCrop) {
      const r = normalizeRect(start.current.x, start.current.y, p.x, p.y);
      setDraftCrop({ x: r.x, y: r.y, w: r.w, h: r.h });
      return;
    }
    setDraft((d) => {
      if (!d) return d;
      if (d.kind === "pen" || d.kind === "highlight") {
        const n = d.points.length;
        // Çok sık nokta biriktirme (her piksel değil).
        if (Math.hypot(p.x - d.points[n - 2], p.y - d.points[n - 1]) < W / 1500) return d;
        return { ...d, points: [...d.points, p.x, p.y] };
      }
      if ("x2" in d) return { ...d, x2: p.x, y2: p.y };
      return d;
    });
  }

  function onPointerUp() {
    start.current = null;
    if (draftCrop) {
      const crop = clampCrop(draftCrop, W, H);
      setDraftCrop(null);
      if (crop) {
        commit({ ...doc, crop });
        setTool("arrow");
      }
      return;
    }
    if (!draft) return;
    setDraft(null);
    if (draft.kind === "pen" || draft.kind === "highlight") {
      if (draft.points.length >= 4) commit({ ...doc, shapes: [...doc.shapes, draft] });
      return;
    }
    if ("x2" in draft) {
      const min = draft.kind === "arrow" ? 6 : 3;
      const big = Math.abs(draft.x2 - draft.x1) > min || Math.abs(draft.y2 - draft.y1) > min;
      if (big) commit({ ...doc, shapes: [...doc.shapes, draft] });
    }
  }

  const flash = useCallback((tone: "ok" | "error", text: string) => {
    setMessage({ tone, text });
  }, []);

  const pngBytes = useCallback(async () => {
    const canvas = exportCanvas();
    if (!canvas) throw new Error("no-image");
    return canvasBytes(canvas, "png", 100);
  }, [exportCanvas]);

  const copy = useCallback(async () => {
    try {
      await imageCopy(await pngBytes());
      flash("ok", t("snip.copied"));
    } catch (err) {
      flash("error", localizeError(err, "snip.copyFailed").message);
    }
  }, [pngBytes, flash, t]);

  const write = useCallback(
    async (dir: string, name: string, format: ShotFormat) => {
      const canvas = exportCanvas();
      if (!canvas) return;
      const settings = getSnipSettings();
      try {
        const path = await imageWrite(
          await canvasBytes(canvas, format, settings.quality),
          dir,
          name,
          format,
        );
        if (settings.copyOnSave) await imageCopy(await canvasBytes(canvas, "png", 100));
        setSavedPath(path);
        setDirty(false);
        onShotSaved(path);
        flash("ok", settings.copyOnSave ? t("snip.savedAndCopied") : t("snip.saved"));
      } catch (err) {
        flash("error", localizeError(err, "snip.saveFailed").message);
      }
    },
    [exportCanvas, flash, t],
  );

  const save = useCallback(async () => {
    try {
      await write(await resolveShotDir(), shotName(), getSnipSettings().format);
    } catch (err) {
      flash("error", localizeError(err, "snip.saveFailed").message);
    }
  }, [write, flash]);

  const saveAs = useCallback(async () => {
    const format = getSnipSettings().format;
    let chosen: string | null;
    try {
      const dir = await resolveShotDir();
      chosen = await saveDialog({
        defaultPath: `${dir}\\${shotName()}.${format}`,
        filters: [
          { name: "PNG", extensions: ["png"] },
          { name: "JPEG", extensions: ["jpg", "jpeg"] },
          { name: "WebP", extensions: ["webp"] },
        ],
      });
    } catch {
      return;
    }
    if (!chosen) return;
    const slash = Math.max(chosen.lastIndexOf("\\"), chosen.lastIndexOf("/"));
    const file = chosen.slice(slash + 1);
    const dot = file.lastIndexOf(".");
    const ext = dot > 0 ? file.slice(dot + 1).toLowerCase() : "";
    const picked: ShotFormat =
      ext === "jpg" || ext === "jpeg"
        ? "jpg"
        : ext === "webp"
          ? "webp"
          : ext === "png"
            ? "png"
            : format;
    await write(chosen.slice(0, slash), dot > 0 ? file.slice(0, dot) : file, picked);
  }, [write]);

  /** Görüntüdeki yazıyı okur (Windows OCR, çevrimdışı); istenirse çevirip
   * özgün yazının üstüne yerleştirir (görsel çeviri). */
  const readText = useCallback(
    async (translate: boolean) => {
      setOcr((o) => ({ ...o, busy: translate ? "translate" : "read", error: null }));
      try {
        const direction = getSnipSettings().translateDirection;
        const out = await ocrImage(image.path, ocrLanguageFor(direction));
        const blocks = groupOcrBlocks(out.lines);
        const text = blocks.map((b) => b.text).join("\n\n");
        if (!text.trim()) {
          setOcr({ ...EMPTY_OCR, error: t("snip.noText") });
          return;
        }
        if (!translate) {
          setOcr({ busy: null, text, translated: null, error: null });
          return;
        }
        const { from, to } = resolveDirection(direction, text);
        const joined = blocks.map((b) => b.text.replace(/\s*\n\s*/g, " ")).join("\n");
        const parts = (await translateText(joined, from, to)).split("\n");
        setOcr({ busy: null, text, translated: parts.join("\n\n"), error: null });
        if (parts.length === blocks.length) {
          setTranslations(
            blocks.map((b, i) => ({
              x: b.x,
              y: b.y,
              width: b.width,
              height: b.height,
              lineHeight: b.lineHeight,
              text: parts[i],
            })),
          );
          setShowTranslation(true);
        }
      } catch (err) {
        setOcr((o) => ({
          ...o,
          busy: null,
          error: localizeError(err, translate ? "snip.translateFailed" : "snip.ocrFailed").message,
        }));
      }
    },
    [image.path, t],
  );

  const autoTranslated = useRef(false);
  useEffect(() => {
    if (translateOnOpen && img && !autoTranslated.current) {
      autoTranslated.current = true;
      void readText(true);
    }
  }, [translateOnOpen, img, readText]);

  const close = useCallback(() => {
    if (dirty && !window.confirm(t("snip.discardConfirm"))) return;
    closeEditor();
  }, [dirty, t]);

  // Klavye: araçlar tek harfle, Ctrl+Z/Y, Ctrl+C, Ctrl+S, Ctrl+Shift+S, Esc.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable=true], [role=listbox]")) return;
      const key = e.key.toLowerCase();
      if (e.ctrlKey && !e.altKey) {
        if (key === "z" && !e.shiftKey) undo();
        else if (key === "y" || (key === "z" && e.shiftKey)) redo();
        else if (key === "c") void copy();
        else if (key === "s" && e.shiftKey) void saveAs();
        else if (key === "s") void save();
        else return;
        e.preventDefault();
        return;
      }
      if (e.altKey || e.metaKey) return;
      if (key === "escape") {
        if (draft || draftCrop) {
          setDraft(null);
          setDraftCrop(null);
          start.current = null;
        }
        return;
      }
      const match = TOOLS.find((x) => x.key.toLowerCase() === key);
      if (match) {
        e.preventDefault();
        setTool(match.tool);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, copy, save, saveAs, draft, draftCrop]);

  if (loadError) {
    return (
      <div className="dk-card space-y-3 p-6 text-center">
        <p className="text-sm text-[var(--dk-error)]">{t("snip.loadFailed")}</p>
        <Button variant="secondary" onClick={() => closeEditor()}>
          {t("snip.back")}
        </Button>
      </div>
    );
  }

  const outW = doc.crop?.w ?? W;
  const outH = doc.crop?.h ?? H;

  return (
    <div className="space-y-3" data-tour="snip-editor">
      <div className="dk-card flex flex-wrap items-center gap-2 p-2" data-tour="snip-tools">
        <div
          className="flex flex-wrap items-center gap-1"
          role="toolbar"
          aria-label={t("snip.tools")}
        >
          {TOOLS.map(({ tool: id, icon: Icon, key }) => (
            <button
              key={id}
              type="button"
              aria-pressed={tool === id}
              title={`${t(`snip.tool.${id}`)} (${key})`}
              aria-label={t(`snip.tool.${id}`)}
              onClick={() => setTool(id)}
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                tool === id
                  ? "dk-gradient text-white"
                  : "text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-[var(--dk-text)]"
              }`}
            >
              <Icon size={17} />
            </button>
          ))}
        </div>
        <span className="h-6 w-px bg-[var(--dk-border)]" />
        <div className="flex items-center gap-1" role="radiogroup" aria-label={t("snip.color")}>
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={c}
              onClick={() => setColor(c)}
              className={`h-5 w-5 rounded-full border-2 transition-transform ${
                color === c ? "scale-110 border-white" : "border-white/20 hover:scale-105"
              }`}
              style={{ background: c }}
            />
          ))}
        </div>
        <span className="h-6 w-px bg-[var(--dk-border)]" />
        <div className="flex items-center gap-1" role="radiogroup" aria-label={t("snip.thickness")}>
          {[1, 2, 3].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={level === n}
              title={t("snip.thickness")}
              aria-label={`${t("snip.thickness")} ${n}`}
              onClick={() => setLevel(n)}
              className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                level === n ? "bg-white/10" : "hover:bg-white/5"
              }`}
            >
              <span
                className="block rounded-full bg-[var(--dk-text)]"
                style={{ width: 4 + n * 3, height: 4 + n * 3 }}
              />
            </button>
          ))}
        </div>
        <span className="h-6 w-px bg-[var(--dk-border)]" />
        <button
          type="button"
          onClick={undo}
          disabled={past.length === 0}
          title={`${t("snip.undo")} (Ctrl+Z)`}
          aria-label={t("snip.undo")}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-[var(--dk-text)] disabled:opacity-30"
        >
          <Undo2 size={17} />
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={future.length === 0}
          title={`${t("snip.redo")} (Ctrl+Y)`}
          aria-label={t("snip.redo")}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-[var(--dk-text)] disabled:opacity-30"
        >
          <Redo2 size={17} />
        </button>
        {doc.crop ? (
          <button
            type="button"
            onClick={() => commit({ ...doc, crop: null })}
            className="rounded-lg px-2 py-1 text-xs text-[var(--dk-accent-hover)] hover:underline"
          >
            {t("snip.removeCrop")}
          </button>
        ) : null}
        <span className="ml-auto font-mono text-xs text-[var(--dk-text-muted)]">
          {outW} × {outH}
        </span>
        <button
          type="button"
          onClick={close}
          title={t("snip.close")}
          aria-label={t("snip.close")}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-[var(--dk-text)]"
        >
          <X size={17} />
        </button>
      </div>

      <div className="dk-card dk-checker flex justify-center overflow-hidden p-3">
        <div className="relative">
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className={`block touch-none shadow-2xl ${tool === "text" ? "cursor-text" : "cursor-crosshair"}`}
            style={{ maxWidth: "100%", maxHeight: "calc(100vh - 300px)" }}
          />
          {textEdit ? (
            <textarea
              autoFocus
              value={textEdit.value}
              onChange={(e) => setTextEdit({ ...textEdit, value: e.target.value })}
              onBlur={commitText}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  commitText();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setTextEdit(null);
                }
              }}
              placeholder={t("snip.textPlaceholder")}
              aria-label={t("snip.tool.text")}
              rows={textEdit.value.split("\n").length}
              className="absolute resize-none overflow-hidden rounded border border-dashed border-white/70 bg-black/30 p-0 font-semibold outline-none"
              style={{
                left: textEdit.x * scale,
                top: textEdit.y * scale,
                // Çizimdeki satır aralığıyla aynı (annotate: 1,25).
                lineHeight: 1.25,
                fontSize: textSize(level, W, H) * scale,
                width: `${Math.max(10, ...textEdit.value.split("\n").map((l) => l.length)) + 2}ch`,
                color,
                fontFamily: '"Segoe UI", system-ui, sans-serif',
              }}
            />
          ) : null}
        </div>
      </div>

      <div className="dk-card flex flex-wrap items-center gap-2 p-3" data-tour="snip-actions">
        <Button icon={<Copy size={16} />} onClick={() => void copy()} title="Ctrl+C">
          {t("snip.copy")}
        </Button>
        <Button
          variant="success"
          icon={<Save size={16} />}
          onClick={() => void save()}
          title="Ctrl+S"
        >
          {t("snip.save")}
        </Button>
        <Button
          variant="secondary"
          icon={<FileDown size={16} />}
          onClick={() => void saveAs()}
          title="Ctrl+Shift+S"
        >
          {t("snip.saveAs")}
        </Button>
        <span className="h-6 w-px bg-[var(--dk-border)]" />
        <Button
          variant="secondary"
          icon={<ScanText size={16} />}
          disabled={ocr.busy !== null}
          onClick={() => void readText(false)}
        >
          {ocr.busy === "read" ? t("snip.reading") : t("snip.readText")}
        </Button>
        <Button
          variant="secondary"
          icon={<Languages size={16} />}
          disabled={ocr.busy !== null}
          onClick={() => void readText(true)}
        >
          {ocr.busy === "translate" ? t("snip.translating") : t("snip.translate")}
        </Button>
        {translations.length > 0 ? (
          <label className="flex items-center gap-2 text-xs text-[var(--dk-text-muted)]">
            <input
              type="checkbox"
              checked={showTranslation}
              onChange={(e) => setShowTranslation(e.target.checked)}
              className="accent-[var(--dk-accent)]"
            />
            {t("snip.showTranslation")}
          </label>
        ) : null}
        <div className="ml-auto flex min-w-0 items-center gap-3 text-sm">
          {message ? (
            <span
              role="status"
              className={`truncate ${
                message.tone === "ok" ? "text-[var(--dk-success)]" : "text-[var(--dk-error)]"
              }`}
            >
              {message.text}
            </span>
          ) : null}
          {savedPath ? (
            <button
              type="button"
              onClick={() => void revealInFolder(savedPath)}
              className="flex shrink-0 items-center gap-1 text-[var(--dk-accent-hover)] hover:underline"
            >
              <FolderOpen size={14} />
              {t("snip.showInFolder")}
            </button>
          ) : null}
        </div>
      </div>

      {ocr.error ? (
        <p className="rounded-xl border border-[var(--dk-warning)]/30 bg-[var(--dk-warning)]/10 px-4 py-3 text-sm">
          {ocr.error}
        </p>
      ) : null}
      {ocr.text ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <TextBox title={t("snip.recognizedText")} text={ocr.text} />
          {ocr.translated ? (
            <TextBox title={t("snip.translatedText")} text={ocr.translated} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function TextBox({ title, text }: { title: string; text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div className="dk-card space-y-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{title}</p>
        <button
          type="button"
          onClick={() =>
            void copyText(text).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            })
          }
          className="flex items-center gap-1 text-xs text-[var(--dk-accent-hover)] hover:underline"
        >
          <Copy size={13} />
          {copied ? t("snip.textCopied") : t("snip.copyText")}
        </button>
      </div>
      <textarea
        readOnly
        value={text}
        rows={Math.min(12, Math.max(3, text.split("\n").length))}
        className="dk-scroll w-full resize-y rounded-lg border border-[var(--dk-border)] bg-[var(--dk-bg)]/40 p-3 text-sm outline-none"
      />
    </div>
  );
}
