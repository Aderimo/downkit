import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Download, Sparkles, X } from "lucide-react";
import { useUpdateStore } from "../lib/updateCheck";
import { openExternalLink } from "../lib/tauri-api";
import { Button } from "./ui/Button";

/** "Güncelleme geldi" penceresi: önce Evet/Hayır sorulur; Evet'te yanlışlıkla
 * tıklamaya karşı bir kez daha sorulur. İkinci onayda sürüm sayfası tarayıcıda
 * açılır — program kendiliğinden bir şey indirip kurmaz. */
export function UpdateDialog() {
  const { t } = useTranslation();
  const dialog = useUpdateStore((s) => s.dialog);
  const latest = useUpdateStore((s) => s.latest);
  const setDialog = useUpdateStore((s) => s.setDialog);

  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDialog(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, setDialog]);

  if (!dialog || !latest) return null;
  const close = () => setDialog(null);
  const openRelease = () => {
    void openExternalLink(latest.url);
    setDialog(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("update.askTitle")}
        className="dk-card w-full max-w-md p-5 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <span className="dk-gradient flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white">
            <Sparkles size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-white">
              {dialog === "ask" ? t("update.askTitle") : t("update.confirmTitle")}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-[var(--dk-text-muted)]">
              {dialog === "ask"
                ? t("update.askBody", { version: latest.version })
                : t("update.confirmBody")}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label={t("clipboard.dismiss")}
            className="rounded-md p-1 text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-white"
          >
            <X size={17} />
          </button>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          {dialog === "ask" ? (
            <>
              <Button variant="ghost" size="sm" onClick={close}>
                {t("update.no")}
              </Button>
              <Button size="sm" onClick={() => setDialog("confirm")}>
                {t("update.yes")}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={close}>
                {t("update.cancel")}
              </Button>
              <Button size="sm" icon={<Download size={14} />} onClick={openRelease}>
                {t("update.confirmYes")}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
