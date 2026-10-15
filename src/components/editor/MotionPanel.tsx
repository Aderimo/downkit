import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Clapperboard, FileJson, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { removeImage } from "../../lib/layerActions";
import type { ImageItem, MotionSpec } from "../../lib/layers";
import {
  addLottie,
  addMotionTitle,
  controlLabel,
  defaultValues,
  loadMotionTemplates,
  updateMotionTitle,
  useMotionTemplates,
} from "../../lib/motion";
import { motionPreview, type MotionTemplate } from "../../lib/tauri-api";
import { formatTimecode } from "../../lib/timeline";
import { Button } from "../ui/Button";
import { HelpTip } from "../ui/HelpTip";
import { Switch } from "../ui/Switch";

/** Galeri kapakları bir kez çizilir. */
const thumbs = new Map<string, string>();

function useThumb(template: MotionTemplate): string | null {
  const [url, setUrl] = useState(() => thumbs.get(template.id) ?? null);
  useEffect(() => {
    if (url) return;
    let alive = true;
    const spec = { template: template.id, values: defaultValues(template), background: true };
    void motionPreview(spec, template.duration * 0.5)
      .then((u) => {
        thumbs.set(template.id, u);
        if (alive) setUrl(u);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [template, url]);
  return url;
}

/** Düzenlenen seçim: yeni başlık ya da var olan katman. */
interface Draft {
  template: MotionTemplate;
  spec: MotionSpec;
  /** Var olan katmanı düzenlerken kimliği. */
  itemId: string | null;
}

/** Hareketli başlıklar: şablon seç, metni ve rengi yaz, ekle. */
export function MotionPanel() {
  const { t } = useTranslation();
  const list = useMotionTemplates((s) => s.list);
  const failed = useMotionTemplates((s) => s.failed);
  const images = useEditorStore((s) => s.images);
  const items = useMemo(() => images.filter((i) => i.motion), [images]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [lottie, setLottie] = useState<"idle" | "busy" | "error">("idle");

  useEffect(() => {
    void loadMotionTemplates();
  }, []);

  function edit(item: ImageItem) {
    const template = list?.find((x) => x.id === item.motion?.template);
    if (!template || !item.motion) return;
    setDraft({ template, spec: item.motion, itemId: item.id });
  }

  async function importLottie() {
    setLottie("busy");
    try {
      await addLottie();
      setLottie("idle");
    } catch {
      setLottie("error");
    }
  }

  if (draft) return <MotionEditor draft={draft} onClose={() => setDraft(null)} />;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        <p className="text-sm font-semibold text-white">{t("motion.title")}</p>
        <HelpTip title={t("motion.title")} text={t("motion.hint")} />
      </div>
      {failed ? <p className="text-xs text-[var(--dk-error)]">{t("motion.loadFailed")}</p> : null}
      {!list && !failed ? (
        <p className="flex items-center gap-2 text-xs text-[var(--dk-text-muted)]">
          <Loader2 size={14} className="animate-spin" /> {t("motion.loading")}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        {list?.map((template) => (
          <TemplateTile
            key={template.id}
            template={template}
            onPick={() =>
              setDraft({
                template,
                spec: { template: template.id, values: defaultValues(template), background: false },
                itemId: null,
              })
            }
          />
        ))}
      </div>
      <Button
        variant="secondary"
        size="sm"
        className="w-full"
        icon={
          lottie === "busy" ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <FileJson size={15} />
          )
        }
        disabled={lottie === "busy"}
        onClick={() => void importLottie()}
      >
        {lottie === "busy" ? t("motion.rendering") : t("motion.lottie")}
      </Button>
      {lottie === "error" ? (
        <p className="text-xs text-[var(--dk-error)]">{t("motion.lottieFailed")}</p>
      ) : null}
      {items.length > 0 ? (
        <div className="space-y-1.5 pt-1">
          <p className="text-xs font-semibold text-[var(--dk-text-muted)]">{t("motion.added")}</p>
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 rounded-lg border border-[var(--dk-border)] bg-[var(--dk-surface-2)] px-2.5 py-1.5"
            >
              <Clapperboard size={14} className="shrink-0 text-[var(--dk-accent-hover)]" />
              <span className="min-w-0 flex-1 truncate text-xs text-[var(--dk-text)]">
                {item.name}
                <span className="ml-1.5 font-mono text-[10px] text-[var(--dk-text-muted)]">
                  {formatTimecode(item.start, 1)}
                </span>
              </span>
              {item.motion?.template === "lottie" ? null : (
                <button
                  type="button"
                  onClick={() => edit(item)}
                  aria-label={t("motion.edit")}
                  className="rounded p-1 text-[var(--dk-text-muted)] hover:text-[var(--dk-text)]"
                >
                  <Pencil size={13} />
                </button>
              )}
              <button
                type="button"
                onClick={() => removeImage(item.id)}
                aria-label={t("editor.layerRemove")}
                className="rounded p-1 text-[var(--dk-text-muted)] hover:text-[var(--dk-error)]"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <p className="text-[11px] leading-snug text-[var(--dk-text-muted)]">{t("motion.credit")}</p>
    </div>
  );
}

function TemplateTile({ template, onPick }: { template: MotionTemplate; onPick: () => void }) {
  const { t } = useTranslation();
  const thumb = useThumb(template);
  return (
    <button
      type="button"
      onClick={onPick}
      data-motion-template={template.id}
      className="group overflow-hidden rounded-xl border border-[var(--dk-border)] bg-[var(--dk-surface-2)] text-left transition hover:border-[var(--dk-accent)]"
    >
      <div className="flex aspect-video items-center justify-center bg-black/40">
        {thumb ? (
          <img src={thumb} alt="" className="h-full w-full object-contain" />
        ) : (
          <Loader2 size={16} className="animate-spin text-[var(--dk-text-muted)]" />
        )}
      </div>
      <p className="truncate px-2 py-1.5 text-xs text-[var(--dk-text)]">
        {t(`motion.tpl.${template.id}.name`)}
      </p>
    </button>
  );
}

function MotionEditor({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const { t } = useTranslation();
  const { template } = draft;
  const [spec, setSpec] = useState(draft.spec);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  // Önizleme: yazmayı bekleyip (kısa gecikme) şablonun ortasındaki kare.
  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      void motionPreview({ ...spec, background: true }, template.duration * 0.5)
        .then((u) => alive && setPreview(u))
        .catch(() => {});
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [spec, template]);

  function setValue(index: number, value: string) {
    setSpec((s) => ({ ...s, values: s.values.map((v, i) => (i === index ? value : v)) }));
  }

  async function apply() {
    setBusy(true);
    setError(false);
    try {
      if (draft.itemId) await updateMotionTitle(draft.itemId, spec);
      else await addMotionTitle(spec);
      onClose();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onClose}
        className="flex items-center gap-1.5 text-xs text-[var(--dk-text-muted)] hover:text-[var(--dk-text)]"
      >
        <ArrowLeft size={14} /> {t("motion.back")}
      </button>
      <p className="text-sm font-semibold text-white">{t(`motion.tpl.${template.id}.name`)}</p>
      <div className="flex aspect-video items-center justify-center overflow-hidden rounded-xl border border-[var(--dk-border)] bg-black/40">
        {preview ? (
          <img src={preview} alt="" className="h-full w-full object-contain" />
        ) : (
          <Loader2 size={16} className="animate-spin text-[var(--dk-text-muted)]" />
        )}
      </div>
      {template.controls.map((control, index) =>
        control.kind === "text" ? (
          <label key={index} className="block space-y-1">
            <span className="text-xs text-[var(--dk-text-muted)]">
              {controlLabel(control.name)}
            </span>
            <textarea
              rows={spec.values[index]?.includes("\n") ? 2 : 1}
              value={spec.values[index] ?? ""}
              maxLength={120}
              onChange={(e) => setValue(index, e.target.value)}
              className="w-full resize-none rounded-lg border border-[var(--dk-border)] bg-[var(--dk-surface-2)] px-2.5 py-1.5 text-sm text-[var(--dk-text)] outline-none focus:border-[var(--dk-accent)]"
            />
          </label>
        ) : (
          <label key={index} className="flex items-center justify-between gap-2">
            <span className="text-xs text-[var(--dk-text-muted)]">
              {controlLabel(control.name)}
            </span>
            <input
              type="color"
              value={spec.values[index] ?? control.value}
              onChange={(e) => setValue(index, e.target.value)}
              className="h-7 w-12 cursor-pointer rounded border border-[var(--dk-border)] bg-transparent"
            />
          </label>
        ),
      )}
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs text-[var(--dk-text)]">{t("motion.background")}</p>
          <p className="text-[11px] text-[var(--dk-text-muted)]">{t("motion.backgroundHint")}</p>
        </div>
        <Switch
          checked={spec.background}
          onChange={(background) => setSpec((s) => ({ ...s, background }))}
          label={t("motion.background")}
        />
      </div>
      {error ? <p className="text-xs text-[var(--dk-error)]">{t("motion.renderFailed")}</p> : null}
      <Button
        className="w-full"
        icon={busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
        disabled={busy}
        onClick={() => void apply()}
      >
        {busy ? t("motion.rendering") : draft.itemId ? t("motion.update") : t("motion.add")}
      </Button>
    </div>
  );
}
