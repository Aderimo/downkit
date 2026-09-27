import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowRight,
  CircleHelp,
  Clapperboard,
  FolderOpen,
  Heart,
  Lightbulb,
  Link2,
  ListChecks,
  Settings,
  X,
  type LucideIcon,
} from "lucide-react";
import { siDiscord } from "simple-icons";
import { BrandMark } from "./BrandMark";
import { Button } from "./ui/Button";
import { openExternalLink } from "../lib/tauri-api";
import { AUTHOR_NAME, DISCORD_URL, DONATE_URL } from "../lib/links";
import {
  findTarget,
  placeCard,
  unionRect,
  useTutorialStore,
  type Rect,
  type TourId,
} from "../lib/tutorial";

const CARD_WIDTH = 400;
const SPOT_PADDING = 6;

const WELCOME_ICON: Record<string, LucideIcon> = {
  link: Link2,
  editor: Clapperboard,
  local: FolderOpen,
  queue: ListChecks,
  settings: Settings,
  help: CircleHelp,
  support: Heart,
};

// Çeviri metinlerindeki <k>…</k> tuşları, <b>…</b> vurguyu gösterir.
const RICH: Record<string, ReactElement> = {
  k: (
    <kbd className="rounded-md border border-[var(--dk-border-strong)] bg-[var(--dk-bg)] px-1.5 py-0.5 font-mono text-[12px] text-white" />
  ),
  b: <strong className="font-semibold text-white" />,
};

const LOCAL_TOURS: TourId[] = ["convert", "compress", "resize"];

/** Adımın metin anahtarı: karşılama turu `tutorial.*`, sayfa turları `tour.*`;
 * yerel araçlar ortak adımlarda `tour.local.*` kullanır. */
function textKey(tour: TourId, stepId: string, exists: (key: string) => boolean): string {
  if (tour === "welcome") return `tutorial.${stepId}`;
  const own = `tour.${tour}.${stepId}`;
  if (LOCAL_TOURS.includes(tour) && !exists(`${own}.title`)) return `tour.local.${stepId}`;
  return own;
}

interface Layout {
  key: string;
  spot: Rect | null;
  left: number;
  top: number;
  side: ReturnType<typeof placeCard>["side"];
  cardHeight: number;
  /** İlk yerleşimde kart/vurgu köşeden kayarak gelmesin; yalnızca adımlar arası kayar. */
  animate: boolean;
}

function measureTargets(targets: string[]): Rect | null {
  const elements = targets
    .map((id) => findTarget(id))
    .filter((el): el is HTMLElement => el !== null);
  // Sayfa ya da kenar çubuğu kaydırılmışsa vurgulanacak öğe görünür yere getirilir.
  elements[0]?.scrollIntoView({ block: "nearest" });
  const union = unionRect(
    elements.map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    }),
  );
  if (!union) return null;
  // Ekrandan taşan büyük alanlar (ör. uzun liste) görünür kısma kırpılır.
  const top = Math.max(union.top, 8);
  const bottom = Math.min(union.top + union.height, window.innerHeight - 8);
  return {
    left: union.left - SPOT_PADDING,
    top: top - SPOT_PADDING,
    width: union.width + SPOT_PADDING * 2,
    height: Math.max(0, bottom - top) + SPOT_PADDING * 2,
  };
}

/** Karşılama turu ve sayfa turları. İlgili öğeyi vurgular ve yanında anlatır. */
export function Tutorial() {
  const open = useTutorialStore((s) => s.open);
  return open ? <TutorialOverlay /> : null;
}

function TutorialOverlay() {
  const { t, i18n } = useTranslation();
  const tour = useTutorialStore((s) => s.tour);
  const steps = useTutorialStore((s) => s.steps);
  const step = useTutorialStore((s) => s.step);
  const dontShowAgain = useTutorialStore((s) => s.dontShowAgain);
  const goTo = useTutorialStore((s) => s.goTo);
  const setDontShowAgain = useTutorialStore((s) => s.setDontShowAgain);
  const close = useTutorialStore((s) => s.close);
  const cardRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout | null>(null);

  const current = steps[step] ?? steps[0];
  const last = step >= steps.length - 1;
  const isWelcomeTour = tour === "welcome";
  const welcomeIntro = isWelcomeTour && current.id === "welcome";
  const Icon = isWelcomeTour ? WELCOME_ICON[current.id] : Lightbulb;
  const key = textKey(tour, current.id, (k) => i18n.exists(k));
  const layoutKey = `${tour}:${step}`;
  // Karşılama turunun ilk adımı numaralanmaz.
  const numbered = isWelcomeTour ? steps.slice(1) : steps;
  const number = isWelcomeTour ? step : step + 1;

  // Kartın yüksekliği adıma göre değiştiği için yerleşim her adımda yeniden ölçülür.
  useLayoutEffect(() => {
    const measure = () => {
      const cardHeight = cardRef.current?.offsetHeight ?? 300;
      const spot = measureTargets(current.targets);
      const placed = placeCard(
        spot,
        { width: CARD_WIDTH, height: cardHeight },
        { width: window.innerWidth, height: window.innerHeight },
      );
      // Pencere boyutu değişince vurgu kaymadan yerine oturur; yalnızca adım değişince kayar.
      setLayout((prev) => ({
        key: layoutKey,
        spot,
        cardHeight,
        ...placed,
        animate: prev !== null && prev.key !== layoutKey,
      }));
    };
    // Çizimden hemen sonra (boyamadan önce) ölçülür; requestAnimationFrame
    // gizli pencerede çalışmadığı için kullanılmaz.
    measure();
    // Pencere büyütülür/küçültülürse, yazı tipi geç yüklenip kart uzarsa ya da
    // sayfa kaydırılırsa vurgu yeniden hesaplanır.
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    if (cardRef.current) observer.observe(cardRef.current);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [layoutKey, current.targets]);

  // Tur açıkken sayfanın kısayolları (Ctrl+V, Boşluk…) çalışmasın.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      const onControl = e.target instanceof HTMLElement && e.target.closest("button, input");
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight" || (e.key === "Enter" && !onControl)) {
        if (last) close();
        else goTo(step + 1);
      } else if (e.key === "ArrowLeft") goTo(step - 1);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [step, last, close, goTo]);

  const ready = layout?.key === layoutKey;
  const spot = ready ? layout.spot : null;
  const arrowSide =
    ready && (layout.side === "right" || layout.side === "left") ? layout.side : null;

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label={t("tutorial.label")}
    >
      {/* Karartma: vurgulanan öğenin çevresi dışında her yer. */}
      {spot ? (
        <div
          key="spot"
          className={`pointer-events-none fixed rounded-2xl ring-2 ring-[var(--dk-accent)] ${
            layout?.animate ? "transition-all duration-300" : ""
          }`}
          style={{
            left: spot.left,
            top: spot.top,
            width: spot.width,
            height: spot.height,
            boxShadow:
              "0 0 0 9999px var(--dk-dim), 0 0 32px 4px color-mix(in srgb, var(--dk-accent) 45%, transparent)",
          }}
        />
      ) : (
        <div key="dim" className="fixed inset-0 bg-[var(--dk-dim)] backdrop-blur-[2px]" />
      )}

      <div
        ref={cardRef}
        className={`dk-card fixed space-y-4 p-5 shadow-2xl shadow-black/60 duration-300 ${
          layout?.animate ? "transition-[left,top,opacity]" : "transition-opacity"
        } ${ready ? "opacity-100" : "opacity-0"}`}
        style={{ width: CARD_WIDTH, left: layout?.left ?? 0, top: layout?.top ?? 0 }}
      >
        {arrowSide && spot && layout ? (
          <span
            className={`absolute h-3.5 w-3.5 -translate-y-1/2 rotate-45 bg-[var(--dk-surface)] ${
              arrowSide === "right"
                ? "-left-[7px] border-b border-l border-[var(--dk-border)]"
                : "-right-[7px] border-t border-r border-[var(--dk-border)]"
            }`}
            style={{
              top: Math.min(
                Math.max(spot.top + spot.height / 2 - layout.top, 24),
                layout.cardHeight - 24,
              ),
            }}
          />
        ) : null}

        <div className="flex items-start gap-3">
          {welcomeIntro ? (
            <BrandMark size={52} className="shrink-0" />
          ) : Icon ? (
            <span
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                current.id === "support"
                  ? "bg-[#f472b6]/15 text-[var(--dk-pink)]"
                  : "bg-[var(--dk-accent)]/15 text-[var(--dk-accent-hover)]"
              }`}
            >
              <Icon size={22} />
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            {!welcomeIntro ? (
              <p className="text-xs text-[var(--dk-text-muted)]">
                {isWelcomeTour
                  ? t("tutorial.stepOf", { step: number, total: numbered.length })
                  : t("tutorial.pageStepOf", {
                      page: t(`tour.${tour}.name`),
                      step: number,
                      total: numbered.length,
                    })}
              </p>
            ) : null}
            <h2 className="text-lg leading-snug font-semibold text-white">{t(`${key}.title`)}</h2>
          </div>
          <button
            type="button"
            onClick={close}
            title={t("tutorial.close")}
            aria-label={t("tutorial.close")}
            className="-mt-1 -mr-1 rounded-lg p-1.5 text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-2.5 text-sm leading-relaxed text-[var(--dk-text)]/90">
          <p>
            <Trans i18nKey={`${key}.body`} components={RICH} />
          </p>
          {i18n.exists(`${key}.tip`) ? (
            <p className="text-[13px] text-[var(--dk-text-muted)]">
              <Trans i18nKey={`${key}.tip`} components={RICH} />
            </p>
          ) : null}
        </div>

        {isWelcomeTour && current.id === "support" ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void openExternalLink(DONATE_URL)}
                className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-[#f472b6]/50 bg-[#f472b6]/10 text-sm font-semibold text-[var(--dk-pink)] transition hover:bg-[#f472b6]/20"
              >
                <Heart size={16} />
                {t("sidebar.donate")}
              </button>
              <button
                type="button"
                onClick={() => void openExternalLink(DISCORD_URL)}
                className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-[#5865F2] text-sm font-medium text-white transition hover:brightness-110"
              >
                <svg viewBox="0 0 24 24" width={16} height={16} fill="white" aria-hidden>
                  <path d={siDiscord.path} />
                </svg>
                {t("sidebar.discord")}
              </button>
            </div>
            <p className="font-brand text-right text-sm font-extrabold text-[var(--dk-brand)]">
              — {AUTHOR_NAME}
            </p>
          </div>
        ) : null}

        <div className="flex items-center gap-3 border-t border-[var(--dk-border)] pt-4">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--dk-text-muted)] select-none hover:text-[var(--dk-text)]">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="h-4 w-4 accent-[var(--dk-accent)]"
            />
            {isWelcomeTour ? t("tutorial.dontShowAgain") : t("tutorial.noPageTours")}
          </label>
          <div className="ml-auto flex items-center gap-2">
            {step === 0 ? (
              <Button variant="ghost" size="sm" onClick={close}>
                {t("tutorial.skip")}
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                icon={<ArrowLeft size={15} />}
                onClick={() => goTo(step - 1)}
              >
                {t("tutorial.back")}
              </Button>
            )}
            <Button size="sm" onClick={() => (last ? close() : goTo(step + 1))} autoFocus>
              {welcomeIntro
                ? t("tutorial.start")
                : last
                  ? t("tutorial.finish")
                  : t("tutorial.next")}
              {!last ? <ArrowRight size={15} /> : null}
            </Button>
          </div>
        </div>

        {numbered.length > 1 && !welcomeIntro ? (
          <div className="flex justify-center gap-1.5">
            {numbered.map((s, i) => {
              const index = isWelcomeTour ? i + 1 : i;
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-label={t("tutorial.goToStep", { step: i + 1 })}
                  onClick={() => goTo(index)}
                  className={`h-1.5 rounded-full transition-all ${
                    index === step
                      ? "w-5 bg-[var(--dk-accent)]"
                      : "w-1.5 bg-[var(--dk-border-strong)]"
                  }`}
                />
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
