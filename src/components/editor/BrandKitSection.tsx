import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ImagePlus, Pencil, Trash2, Wand2 } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import {
  applyBrandKit,
  defaultKitName,
  kitFromProject,
  useBrandKits,
  type BrandKit,
} from "../../lib/brandKit";
import { CAPTION_PRESETS } from "../../lib/captionPresets";
import { FONTS } from "../../lib/captionStyle";
import { fileName, IMAGE_EXTENSIONS } from "../../lib/layers";
import { chooseFile } from "../../lib/tauri-api";
import { HelpTip } from "../ui/HelpTip";
import { Select } from "../ui/Select";
import { Switch } from "../ui/Switch";

// Marka kiti: yazı tipi, ana / vurgu rengi, logo, altyazı stili, açılış ve kapanış yazısı.
// Kitler bilgisayarda saklanır; "Uygula" bütün projeye tek tıkla giydirir.

const COLORS = [
  "#4f7bff",
  "#e11d48",
  "#ffd43b",
  "#4ade80",
  "#a855f7",
  "#f97316",
  "#111111",
  "#ffffff",
];

function Colors({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <span className="mr-auto text-[11px] text-[var(--dk-text-muted)]">{label}</span>
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={c}
          aria-pressed={value === c}
          onClick={() => onChange(c)}
          className={`h-4 w-4 rounded-full border border-white/30 ${value === c ? "ring-2 ring-[var(--dk-accent)]" : ""}`}
          style={{ background: c }}
        />
      ))}
    </div>
  );
}

function KitForm({ initial, onDone }: { initial: BrandKit; onDone: () => void }) {
  const { t } = useTranslation();
  const save = useBrandKits((s) => s.save);
  const [kit, setKit] = useState(initial);
  const [error, setError] = useState(false);
  const set = (patch: Partial<BrandKit>) => setKit((k) => ({ ...k, ...patch }));
  const field =
    "h-7 w-full rounded-md border border-[var(--dk-border)] bg-[var(--dk-bg)] px-2 text-xs outline-none focus:border-[var(--dk-accent)]";
  return (
    <form
      className="space-y-1.5 rounded-lg border border-[var(--dk-accent)]/50 p-2"
      data-brand-form
      onSubmit={(e) => {
        e.preventDefault();
        if (!kit.name.trim()) {
          setError(true);
          return;
        }
        save({ ...kit, name: kit.name.trim() });
        onDone();
      }}
    >
      <input
        value={kit.name}
        maxLength={40}
        aria-label={t("brand.name")}
        placeholder={t("brand.name")}
        onChange={(e) => {
          set({ name: e.target.value });
          setError(false);
        }}
        className={field}
      />
      {error ? (
        <p className="text-[11px] text-[var(--dk-error)]">{t("brand.nameRequired")}</p>
      ) : null}
      <Select
        value={kit.font}
        ariaLabel={t("brand.font")}
        className="w-full [&>button]:h-7"
        onChange={(font) => set({ font })}
        options={FONTS.map((f) => ({ value: f.id, label: f.family }))}
      />
      <Colors
        label={t("brand.primary")}
        value={kit.primary}
        onChange={(primary) => set({ primary })}
      />
      <Colors label={t("brand.accent")} value={kit.accent} onChange={(accent) => set({ accent })} />
      <Select
        value={kit.captionPreset ?? ""}
        ariaLabel={t("brand.captionPreset")}
        className="w-full [&>button]:h-7"
        onChange={(v) => set({ captionPreset: v || undefined })}
        options={[
          { value: "", label: t("brand.noCaptionPreset") },
          ...CAPTION_PRESETS.map((p) => ({ value: p.id, label: t(`captionPreset.${p.id}`) })),
        ]}
      />
      <input
        value={kit.intro ?? ""}
        maxLength={80}
        aria-label={t("brand.intro")}
        placeholder={t("brand.intro")}
        onChange={(e) => set({ intro: e.target.value || undefined })}
        className={field}
      />
      <input
        value={kit.outro ?? ""}
        maxLength={80}
        aria-label={t("brand.outro")}
        placeholder={t("brand.outro")}
        onChange={(e) => set({ outro: e.target.value || undefined })}
        className={field}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() =>
            void chooseFile(t("editor.imageFiles"), IMAGE_EXTENSIONS)
              .then((path) => {
                if (path)
                  set({
                    logo: { path, name: fileName(path), x: 0.88, y: 0.08, size: 0.16, opacity: 1 },
                  });
              })
              .catch(() => {})
          }
          className="flex min-w-0 flex-1 items-center gap-1 rounded-md bg-[var(--dk-bg)] px-2 py-1 text-[11px] hover:bg-white/10"
        >
          <ImagePlus size={12} />
          <span className="truncate">{kit.logo ? kit.logo.name : t("brand.logo")}</span>
        </button>
        {kit.logo ? (
          <button
            type="button"
            aria-label={t("brand.removeLogo")}
            onClick={() => set({ logo: undefined })}
            className="rounded p-0.5 text-[var(--dk-text-muted)] hover:text-white"
          >
            <Trash2 size={12} />
          </button>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px]">{t("brand.progress")}</span>
        <Switch
          checked={kit.progress}
          label={t("brand.progress")}
          onChange={(progress) => set({ progress })}
        />
      </div>
      <div className="flex justify-end gap-1">
        <button
          type="button"
          onClick={onDone}
          className="rounded px-2 py-0.5 text-[11px] hover:bg-white/5"
        >
          {t("history.cancelClear")}
        </button>
        <button
          type="submit"
          className="rounded bg-[var(--dk-accent)] px-2 py-0.5 text-[11px] font-bold text-white"
        >
          {t("brand.save")}
        </button>
      </div>
    </form>
  );
}

export function BrandKitSection() {
  const { t } = useTranslation();
  const kits = useBrandKits((s) => s.kits);
  const remove = useBrandKits((s) => s.remove);
  const hasProject = useEditorStore((s) => s.clips.length > 0);
  const [editing, setEditing] = useState<BrandKit | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  return (
    <div
      className="space-y-2 rounded-xl border border-[var(--dk-border)] bg-[var(--dk-bg)]/40 p-3"
      data-brand-kits
    >
      <div className="flex items-center gap-1.5">
        <p className="text-xs font-semibold text-white">{t("brand.title")}</p>
        <HelpTip title={t("brand.title")} text={t("brand.hint")} />
      </div>
      {kits.map((kit) => (
        <div key={kit.id} className="flex items-center gap-1.5" data-brand-kit={kit.name}>
          <span className="h-3 w-3 rounded-full" style={{ background: kit.primary }} />
          <span className="h-3 w-3 rounded-full" style={{ background: kit.accent }} />
          <span className="min-w-0 flex-1 truncate text-xs">{kit.name}</span>
          <button
            type="button"
            aria-label={t("brand.apply", { name: kit.name })}
            title={t("brand.apply", { name: kit.name })}
            disabled={!hasProject}
            onClick={() => {
              applyBrandKit(kit);
              setApplied(kit.name);
            }}
            className="flex items-center gap-1 rounded-md bg-[var(--dk-accent)] px-2 py-0.5 text-[11px] font-bold text-white disabled:opacity-40"
          >
            <Wand2 size={11} />
            {t("brand.applyShort")}
          </button>
          <button
            type="button"
            aria-label={t("brand.edit", { name: kit.name })}
            onClick={() => setEditing(kit)}
            className="rounded p-0.5 text-[var(--dk-text-muted)] hover:text-white"
          >
            <Pencil size={12} />
          </button>
          <button
            type="button"
            aria-label={t("brand.delete", { name: kit.name })}
            onClick={() => remove(kit.id)}
            className="rounded p-0.5 text-[var(--dk-text-muted)] hover:text-[var(--dk-error)]"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      {applied ? (
        <p className="text-[11px] text-[#4ade80]" role="status">
          {t("brand.applied", { name: applied })}
        </p>
      ) : null}
      {editing ? (
        <KitForm key={editing.id} initial={editing} onDone={() => setEditing(null)} />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(kitFromProject(defaultKitName()))}
          className="w-full rounded-md border border-dashed border-[var(--dk-border-strong)] py-1.5 text-xs hover:bg-white/5"
        >
          {t("brand.new")}
        </button>
      )}
    </div>
  );
}
