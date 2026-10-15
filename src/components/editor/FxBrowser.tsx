import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, Star, X } from "lucide-react";
import {
  FX_CATEGORIES,
  FX_CATEGORY,
  LOOK_FX_IDS,
  type FxCategory,
  type LookFx,
  type LookFxId,
} from "../../lib/lookFx";
import { fxDrag } from "../../lib/fxDrag";
import { applyEffectCard } from "../../lib/effectActions";
import { LookFxLayer } from "./LookFxLayer";

const FAVORITES_KEY = "downkit.fxFavorites";

function loadFavorites(): LookFxId[] {
  try {
    const raw = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((id): id is LookFxId => LOOK_FX_IDS.includes(id)) : [];
  } catch {
    return [];
  }
}

function saveFavorites(ids: LookFxId[]) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids));
  } catch {
    // Kayıt yoksa favoriler bu oturumda kalır.
  }
}

type Tab = "all" | "favorites" | FxCategory;

/** Görünüm efektleri: kategori, arama, favoriler; kartın üzerinde beklerken canlı
 * önizleme. Tıklayınca imleçte efekt şeridine düşer (seçili bloğa eklenir); klibe
 * sürükleyince klibin tamamına uygulanır. Şiddet seçili blokta/klipte ayarlanır. */
export function FxBrowser({ sample }: { sample: string | null }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [favorites, setFavorites] = useState<LookFxId[]>(loadFavorites);
  const needle = query.trim().toLocaleLowerCase();
  const shown = LOOK_FX_IDS.filter((id) => {
    if (tab === "favorites" && !favorites.includes(id)) return false;
    if (tab !== "all" && tab !== "favorites" && FX_CATEGORY[id] !== tab) return false;
    if (!needle) return true;
    const text = `${t(`lookFx.names.${id}`)} ${t(`lookFx.hints.${id}`)}`.toLocaleLowerCase();
    return text.includes(needle);
  });
  const toggleFavorite = (id: LookFxId) => {
    const next = favorites.includes(id) ? favorites.filter((f) => f !== id) : [...favorites, id];
    setFavorites(next);
    saveFavorites(next);
  };
  const tabs: Tab[] = ["all", "favorites", ...FX_CATEGORIES];

  return (
    <div className="space-y-2" data-fx-browser>
      <label className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--dk-border)] bg-[var(--dk-bg)] px-2 focus-within:border-[var(--dk-accent)]">
        <Search size={13} className="shrink-0 text-[var(--dk-text-muted)]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("lookFx.search")}
          aria-label={t("lookFx.search")}
          className="min-w-0 flex-1 bg-transparent text-xs outline-none"
        />
        {query ? (
          <button type="button" aria-label={t("lookFx.clear")} onClick={() => setQuery("")}>
            <X size={12} />
          </button>
        ) : null}
      </label>
      <div className="flex flex-wrap gap-1" role="tablist">
        {tabs.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`rounded-full px-2 py-0.5 text-[11px] ${
              tab === id
                ? "bg-[var(--dk-accent)] text-white"
                : "bg-[var(--dk-bg)] text-[var(--dk-text-muted)] hover:text-[var(--dk-text)]"
            }`}
          >
            {t(`lookFx.tabs.${id}`)}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="py-3 text-center text-[11px] text-[var(--dk-text-muted)]">
          {tab === "favorites" && !needle ? t("lookFx.noFavorites") : t("lookFx.none")}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          {shown.map((id) => (
            <FxCard
              key={id}
              id={id}
              sample={sample}
              favorite={favorites.includes(id)}
              onFavorite={() => toggleFavorite(id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FxCard({
  id,
  sample,
  favorite,
  onFavorite,
}: {
  id: LookFxId;
  sample: string | null;
  favorite: boolean;
  onFavorite: () => void;
}) {
  const { t } = useTranslation();
  const [hover, setHover] = useState(false);
  const [time, setTime] = useState(0);
  // Üzerinde beklerken efekt canlanır (zamanla değişen efektler hareket eder).
  useEffect(() => {
    if (!hover) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      setTime((now - start) / 1000);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [hover]);
  const fx: LookFx = { [id]: 0.8 };
  const label = t(`lookFx.names.${id}`);
  return (
    <div className="relative">
      <button
        type="button"
        data-fx-card={id}
        title={t(`lookFx.hints.${id}`)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        onClick={() => applyEffectCard({ kind: "lookFx", id })}
        {...fxDrag({ kind: "lookFx", id }, label)}
        className="block w-full overflow-hidden rounded-lg border border-[var(--dk-border)] text-left hover:border-[var(--dk-accent)] focus-visible:border-[var(--dk-accent)]"
      >
        <div className="relative aspect-video overflow-hidden bg-[linear-gradient(135deg,#334,#556_50%,#a86)]">
          <LookFxLayer fx={fx} time={hover ? time : 0.05}>
            {sample ? (
              <img
                src={sample}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
                draggable={false}
              />
            ) : null}
          </LookFxLayer>
        </div>
        <span className="block truncate px-1.5 py-1 text-[11px]">{label}</span>
      </button>
      <button
        type="button"
        aria-pressed={favorite}
        aria-label={t(favorite ? "lookFx.unfavorite" : "lookFx.favorite", { name: label })}
        onClick={onFavorite}
        className="absolute top-1 right-1 rounded-full bg-black/50 p-0.5"
      >
        <Star size={11} className={favorite ? "fill-[#facc15] text-[#facc15]" : "text-white"} />
      </button>
    </div>
  );
}
