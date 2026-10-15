import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, LayoutDashboard, Pencil, RotateCcw, Save, Trash2 } from "lucide-react";
import {
  deleteWorkspace,
  FIXED_PANELS,
  PANEL_IDS,
  PRESET_IDS,
  renameWorkspace,
  resetWorkspace,
  saveWorkspaceAs,
  switchWorkspace,
  togglePanel,
  useWorkspaceStore,
  workspaceApi,
  workspaceName,
} from "../../lib/workspaces";
import { Menu, MenuDivider, MenuItem, MenuLabel } from "../ui/Menu";

// "Düzen" menüsü: hazır ve kendi düzenler arasında geçiş, şu anki düzeni kaydetme,
// kaydedilen hâline sıfırlama, kendi düzeni yeniden adlandırma / silme, panelleri aç-kapa.

const width = () => document.querySelector("[data-workspace]")?.clientWidth ?? window.innerWidth;

/** Kaydet / yeniden adlandır için küçük ad kutusu. */
function NameForm({
  initial,
  onDone,
  onCancel,
}: {
  initial: string;
  onDone: (name: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial);
  const [error, setError] = useState(false);
  return (
    <form
      className="space-y-1 p-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) {
          setError(true);
          return;
        }
        onDone(name);
      }}
    >
      <input
        autoFocus
        value={name}
        maxLength={40}
        aria-label={t("workspace.name")}
        placeholder={t("workspace.namePlaceholder")}
        onChange={(e) => {
          setName(e.target.value);
          setError(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
        className="h-7 w-full rounded-md border border-[var(--dk-border)] bg-[var(--dk-bg)] px-2 text-xs outline-none focus:border-[var(--dk-accent)]"
      />
      {error ? (
        <p className="text-[11px] text-[var(--dk-error)]">{t("workspace.nameRequired")}</p>
      ) : null}
      <div className="flex justify-end gap-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2 py-0.5 text-[11px] hover:bg-white/5"
        >
          {t("history.cancelClear")}
        </button>
        <button
          type="submit"
          className="rounded bg-[var(--dk-accent)] px-2 py-0.5 text-[11px] font-bold text-white"
        >
          {t("workspace.saveConfirm")}
        </button>
      </div>
    </form>
  );
}

export function WorkspaceMenu() {
  const { t } = useTranslation();
  const active = useWorkspaceStore((s) => s.active);
  const custom = useWorkspaceStore((s) => s.custom);
  const open = useWorkspaceStore((s) => s.open);
  const [naming, setNaming] = useState<null | { mode: "save" } | { mode: "rename"; id: string }>(
    null,
  );

  return (
    <Menu
      label={t("workspace.menu")}
      width={260}
      trigger={({ open: shown, toggle }) => (
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={shown}
          title={t("workspace.menuHint")}
          data-tour="editor-workspace"
          onClick={() => {
            setNaming(null);
            toggle();
          }}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--dk-border)] px-2.5 text-xs font-semibold hover:bg-white/5"
        >
          <LayoutDashboard size={14} />
          <span className="max-w-[120px] truncate">{workspaceName(active)}</span>
          <ChevronDown size={13} className="text-[var(--dk-text-muted)]" />
        </button>
      )}
    >
      {(close) => {
        const api = workspaceApi();
        const go = (id: string) => {
          if (api) switchWorkspace(api, id, width());
          close();
        };
        if (naming) {
          const current =
            naming.mode === "rename" ? (custom.find((c) => c.id === naming.id)?.name ?? "") : "";
          return (
            <NameForm
              initial={current}
              onCancel={() => setNaming(null)}
              onDone={(name) => {
                if (naming.mode === "save" && api) saveWorkspaceAs(api, name);
                if (naming.mode === "rename") renameWorkspace(naming.id, name);
                setNaming(null);
                close();
              }}
            />
          );
        }
        return (
          <>
            <MenuLabel>{t("workspace.presets")}</MenuLabel>
            {PRESET_IDS.map((id) => (
              <MenuItem
                key={id}
                label={t(`workspace.preset.${id}`)}
                checked={active === id}
                onSelect={() => go(id)}
              />
            ))}
            {custom.length > 0 ? (
              <>
                <MenuLabel>{t("workspace.mine")}</MenuLabel>
                {custom.map((c) => (
                  <div
                    key={c.id}
                    className="group flex items-center"
                    data-custom-workspace={c.name}
                  >
                    <div className="min-w-0 flex-1">
                      <MenuItem
                        label={c.name}
                        checked={active === c.id}
                        onSelect={() => go(c.id)}
                      />
                    </div>
                    <button
                      type="button"
                      aria-label={t("workspace.rename", { name: c.name })}
                      title={t("workspace.rename", { name: c.name })}
                      onClick={() => setNaming({ mode: "rename", id: c.id })}
                      className="rounded p-1 text-[var(--dk-text-muted)] opacity-0 group-hover:opacity-100 hover:text-white focus:opacity-100"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      aria-label={t("workspace.delete", { name: c.name })}
                      title={t("workspace.delete", { name: c.name })}
                      onClick={() => deleteWorkspace(api, c.id, width())}
                      className="rounded p-1 text-[var(--dk-text-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--dk-error)] focus:opacity-100"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </>
            ) : null}
            <MenuDivider />
            <MenuItem
              icon={<Save size={14} />}
              label={t("workspace.saveAs")}
              onSelect={() => setNaming({ mode: "save" })}
            />
            <MenuItem
              icon={<RotateCcw size={14} />}
              label={t("workspace.reset")}
              onSelect={() => {
                if (api) resetWorkspace(api, width());
                close();
              }}
            />
            <MenuDivider />
            <MenuLabel>{t("workspace.panels")}</MenuLabel>
            {PANEL_IDS.filter((id) => !FIXED_PANELS.includes(id)).map((id) => (
              <MenuItem
                key={id}
                label={t(`workspace.panel.${id}`)}
                checked={open.includes(id)}
                onSelect={() => togglePanel(id)}
              />
            ))}
          </>
        );
      }}
    </Menu>
  );
}
