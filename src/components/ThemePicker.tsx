import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronLeft, ChevronRight, Palette } from "lucide-react";
import { useSettingsStore } from "../lib/appSettings";
import {
  CUSTOM_THEME_ID,
  resolveTheme,
  THEMES,
  type Theme,
  type ThemeChoice,
  type ThemeMode,
} from "../lib/themes";
import { Tabs } from "./ui/Tabs";
import { CustomThemePanel } from "./CustomThemePanel";
import { ThemePreview } from "./ThemePreview";

/** Kaydırmalı tema şeridi: oklar, fare tekerleği, sürükleme ve klavye okları
 * (seçimi bir yana kaydırıp hemen uygular). Altta sayfa noktaları. */
function ThemeCarousel({ themes }: { themes: readonly Theme[] }) {
  const { t } = useTranslation();
  const current = useSettingsStore((s) => s.theme);
  const update = useSettingsStore((s) => s.update);
  const strip = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(0);
  const [edges, setEdges] = useState({ start: true, end: true });
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);

  const measure = useCallback(() => {
    const el = strip.current;
    if (!el) return;
    const width = el.clientWidth || 1;
    setPages(Math.max(1, Math.ceil((el.scrollWidth - 4) / width)));
    setPage(Math.round(el.scrollLeft / width));
    setEdges({
      start: el.scrollLeft <= 2,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2,
    });
  }, []);

  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    // Dikey tekerlek şeridi yana kaydırır; şeridin ucuna gelince sayfa kayar.
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const atEnd = e.deltaY > 0 && el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
      const atStart = e.deltaY < 0 && el.scrollLeft <= 2;
      if (atEnd || atStart) return;
      e.preventDefault();
      el.scrollBy({ left: e.deltaY, behavior: "auto" });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      el.removeEventListener("wheel", onWheel);
    };
  }, [measure, themes]);

  // Seçili tema görünür olsun (sekme değişince ya da klavyeyle seçince).
  useEffect(() => {
    strip.current
      ?.querySelector<HTMLElement>('[aria-checked="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [current, themes]);

  const scrollPage = (dir: number) => {
    const el = strip.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth, behavior: "smooth" });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const index = themes.findIndex((theme) => theme.id === current);
    const step = e.key === "ArrowRight" ? 1 : -1;
    const next = themes[(index + step + themes.length) % themes.length] ?? themes[0];
    update({ theme: next.id as ThemeChoice });
    strip.current?.querySelector<HTMLElement>(`[data-theme-id="${next.id}"]`)?.focus();
  };

  return (
    <div className="rounded-2xl border border-[var(--dk-border-strong)] bg-[var(--dk-surface-2)] p-3">
      <div className="relative">
        <div
          ref={strip}
          role="radiogroup"
          aria-label={t("settings.theme")}
          onScroll={measure}
          onKeyDown={onKeyDown}
          onPointerDown={(e) => {
            if (e.pointerType !== "mouse" || e.button !== 0) return;
            drag.current = { x: e.clientX, left: strip.current?.scrollLeft ?? 0, moved: false };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            const el = strip.current;
            if (!d || !el) return;
            const dx = e.clientX - d.x;
            if (!d.moved && Math.abs(dx) > 5) {
              d.moved = true;
              el.setPointerCapture(e.pointerId);
              el.style.scrollSnapType = "none";
            }
            if (d.moved) el.scrollLeft = d.left - dx;
          }}
          onPointerUp={(e) => {
            const el = strip.current;
            if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
            if (el) el.style.scrollSnapType = "";
            // Sürükleme bitince tıklama sayılmasın.
            if (drag.current?.moved) {
              const stop = (ev: Event) => ev.stopPropagation();
              el?.addEventListener("click", stop, { capture: true, once: true });
              setTimeout(() => el?.removeEventListener("click", stop, { capture: true }), 0);
            }
            drag.current = null;
          }}
          className="dk-noscrollbar flex snap-x snap-mandatory scroll-px-1 gap-3 overflow-x-auto scroll-smooth px-1 py-1"
        >
          {themes.map((theme, index) => {
            const selected = theme.id === current;
            const focusable = selected || (index === 0 && !themes.some((x) => x.id === current));
            return (
              <button
                key={theme.id}
                type="button"
                role="radio"
                aria-checked={selected}
                data-theme-id={theme.id}
                tabIndex={focusable ? 0 : -1}
                onClick={() => update({ theme: theme.id as ThemeChoice })}
                className={`relative flex w-[168px] shrink-0 snap-start flex-col gap-2 rounded-xl border bg-[var(--dk-surface)] p-2 text-left transition hover:border-[var(--dk-accent)] ${
                  selected ? "dk-selected" : "border-[var(--dk-border)]"
                }`}
              >
                <ThemePreview theme={theme} />
                <span className="min-w-0 px-0.5">
                  <span className="block truncate text-sm font-semibold text-white">
                    {t(`themes.${theme.id}.name`)}
                  </span>
                  <span className="block truncate text-[11px] text-[var(--dk-text-muted)]">
                    {t(`themes.${theme.id}.hint`)}
                  </span>
                </span>
                {selected ? (
                  <span className="absolute top-3 right-3 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--dk-accent)] text-white shadow">
                    <Check size={12} strokeWidth={3} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        {!edges.start ? (
          <ArrowButton
            side="left"
            label={t("settings.themesPrev")}
            onClick={() => scrollPage(-1)}
          />
        ) : null}
        {!edges.end ? (
          <ArrowButton
            side="right"
            label={t("settings.themesNext")}
            onClick={() => scrollPage(1)}
          />
        ) : null}
      </div>
      {pages > 1 ? (
        <div className="mt-2 flex justify-center gap-1.5">
          {Array.from({ length: pages }, (_, i) => (
            <button
              key={i}
              type="button"
              aria-label={t("settings.themesPage", { page: i + 1 })}
              aria-current={i === page}
              onClick={() => {
                const el = strip.current;
                if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
              }}
              className={`h-2 rounded-full transition-all ${
                i === page ? "w-5 bg-[var(--dk-accent)]" : "w-2 bg-[var(--dk-border-strong)]"
              }`}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ArrowButton({
  side,
  label,
  onClick,
}: {
  side: "left" | "right";
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`dk-press absolute top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--dk-surface)] text-[var(--dk-text)] ${
        side === "left" ? "-left-2" : "-right-2"
      }`}
    >
      {side === "left" ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
    </button>
  );
}

type ThemeTab = ThemeMode | "custom";

/** Ayarlar'daki tema bölümü: Koyu / Açık / Özel sekmeleri; hazır temalar kaydırmalı
 * şeritte, tıklayınca hemen uygulanır. */
export function ThemeSection() {
  const { t } = useTranslation();
  const current = useSettingsStore((s) => s.theme);
  const [tab, setTab] = useState<ThemeTab>(() =>
    current === CUSTOM_THEME_ID ? "custom" : resolveTheme(current).mode,
  );

  return (
    <section className="dk-card space-y-4 p-5" data-tour="settings-theme">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2.5 text-base font-semibold text-white">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--dk-accent)]/15 text-[var(--dk-accent-hover)]">
            <Palette size={18} />
          </span>
          {t("settings.theme")}
        </h2>
        <span className="rounded-full border border-[var(--dk-border-strong)] px-2.5 py-0.5 text-xs text-[var(--dk-text-muted)]">
          {current === CUSTOM_THEME_ID ? t("settings.themeCustom") : t(`themes.${current}.name`)}
        </span>
        <Tabs<ThemeTab>
          className="ml-auto"
          value={tab}
          onChange={setTab}
          items={[
            { value: "dark", label: t("settings.themesDark") },
            { value: "light", label: t("settings.themesLight") },
            { value: "custom", label: t("settings.themeCustom") },
          ]}
        />
      </div>
      {tab === "custom" ? (
        <CustomThemePanel />
      ) : (
        <ThemeCarousel themes={THEMES.filter((theme) => theme.mode === tab)} />
      )}
    </section>
  );
}
