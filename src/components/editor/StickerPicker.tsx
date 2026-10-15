import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  STICKER_COLORS,
  STICKER_KINDS,
  TEXT_STICKERS,
  addSticker,
  stickerDataUrl,
  type StickerKind,
} from "../../lib/stickers";

/** Çıkartmalar: renk seç, (not/etiket için) yazı yaz, karta tıkla → imleçte 3 sn. */
export function StickerPicker() {
  const { t } = useTranslation();
  const [color, setColor] = useState<string>(STICKER_COLORS[0]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const label = text.trim() || t("stickers.defaultText");
  // Kart görselleri seçilen renk ve yazıyla yeniden çizilir.
  const previews = useMemo(
    () =>
      Object.fromEntries(
        STICKER_KINDS.map((k) => [k, stickerDataUrl(k, color, TEXT_STICKERS.has(k) ? label : "")]),
      ) as Record<StickerKind, string | null>,
    [color, label],
  );
  const add = (kind: StickerKind) => {
    setError(null);
    addSticker(kind, color, TEXT_STICKERS.has(kind) ? label : "").catch(() =>
      setError(t("stickers.failed")),
    );
  };
  return (
    <div className="space-y-2" data-stickers>
      <p className="text-xs font-semibold">{t("stickers.title")}</p>
      <div className="flex items-center gap-1.5" role="radiogroup" aria-label={t("stickers.color")}>
        {STICKER_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={color === c}
            aria-label={c}
            onClick={() => setColor(c)}
            className={`h-5 w-5 rounded-full border-2 ${
              color === c ? "border-[var(--dk-accent)]" : "border-[var(--dk-border)]"
            }`}
            style={{ background: c }}
          />
        ))}
        <input
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 40))}
          placeholder={t("stickers.textPlaceholder")}
          aria-label={t("stickers.textPlaceholder")}
          className="ml-1 h-6 min-w-0 flex-1 rounded-md border border-[var(--dk-border)] bg-[var(--dk-bg)] px-1.5 text-[11px] outline-none focus:border-[var(--dk-accent)]"
        />
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {STICKER_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            data-sticker={kind}
            title={t(`stickers.kinds.${kind}`)}
            aria-label={t(`stickers.kinds.${kind}`)}
            onClick={() => add(kind)}
            className="aspect-square rounded-lg border border-[var(--dk-border)] bg-[var(--dk-bg)] p-1 hover:border-[var(--dk-accent)]"
          >
            {previews[kind] ? (
              <img
                src={previews[kind]!}
                alt=""
                className="h-full w-full object-contain"
                draggable={false}
              />
            ) : null}
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="text-[11px] text-[var(--dk-error)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
