import { useTranslation } from "react-i18next";
import {
  ArrowDownToLine,
  ExternalLink,
  Heart,
  History,
  House,
  Layers,
  Maximize2,
  RefreshCw,
  Scissors,
  Settings,
  Shrink,
  Smartphone,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "../types/route";
import { useJobsStore } from "../store/jobsStore";
import { ACTIVE_STATUSES } from "../types/jobs";
import { siDiscord } from "simple-icons";
import { BrandMark } from "./BrandMark";
import { AUTHOR_NAME, AUTHOR_URL, DISCORD_URL, DONATE_URL } from "../lib/links";
import { openExternalLink } from "../lib/tauri-api";

interface NavItem {
  route: Route;
  icon: LucideIcon;
  labelKey: string;
}

const MAIN_ITEMS: NavItem[] = [
  { route: "home", icon: House, labelKey: "nav.home" },
  { route: "downloads", icon: ArrowDownToLine, labelKey: "nav.downloads" },
  { route: "convert", icon: RefreshCw, labelKey: "nav.convert" },
  { route: "compress", icon: Shrink, labelKey: "nav.compress" },
  { route: "resize", icon: Maximize2, labelKey: "nav.resize" },
  { route: "prepare", icon: Smartphone, labelKey: "nav.prepareForPlatform" },
  { route: "history", icon: History, labelKey: "nav.history" },
];

const TOOL_ITEMS: NavItem[] = [
  { route: "batch", icon: Layers, labelKey: "nav.batch" },
  { route: "editor", icon: Scissors, labelKey: "nav.videoEditor" },
  { route: "settings", icon: Settings, labelKey: "nav.settings" },
];

interface SidebarProps {
  route: Route;
  onNavigate: (route: Route) => void;
}

export function Sidebar({ route, onNavigate }: SidebarProps) {
  const { t } = useTranslation();
  const activeJobs = useJobsStore(
    (s) => s.jobs.filter((j) => ACTIVE_STATUSES.includes(j.status) || j.status === "queued").length,
  );

  return (
    <aside className="dk-scroll flex w-60 shrink-0 flex-col overflow-y-auto border-r border-[var(--dk-border)] bg-[var(--dk-sidebar)] px-4 py-5">
      <button
        type="button"
        onClick={() => onNavigate("home")}
        title={t("app.tagline")}
        className="mb-7 flex items-center gap-3 rounded-xl px-1 text-left"
      >
        <BrandMark size={46} className="shrink-0 drop-shadow-[0_8px_18px_rgb(79_123_255/35%)]" />
        <span className="min-w-0">
          <span className="font-brand block text-[22px] font-black leading-tight text-white">
            {t("app.name")}
          </span>
          <span className="font-brand block text-[13px] font-extrabold leading-tight text-[#FFD43B]">
            by {AUTHOR_NAME}
          </span>
        </span>
      </button>

      <NavList
        items={MAIN_ITEMS}
        route={route}
        onNavigate={onNavigate}
        badge={{ downloads: activeJobs }}
      />

      <p className="mb-2 mt-7 px-3 text-xs font-medium text-[var(--dk-text-muted)]">
        {t("nav.sectionTools")}
      </p>
      <NavList items={TOOL_ITEMS} route={route} onNavigate={onNavigate} />

      <div className="mt-auto pt-6">
        <div className="rounded-2xl border border-[var(--dk-border)] bg-[var(--dk-surface)] p-3">
          <p className="text-[11px] text-[var(--dk-text-muted)]">{t("sidebar.madeBy")}</p>
          <button
            type="button"
            onClick={() => void openExternalLink(AUTHOR_URL)}
            title={AUTHOR_URL}
            className="font-brand mt-0.5 flex items-center gap-1.5 text-[15px] font-extrabold text-white hover:text-[#FFD43B]"
          >
            {AUTHOR_NAME}
            <ExternalLink size={13} className="text-[var(--dk-text-muted)]" />
          </button>
          <button
            type="button"
            onClick={() => void openExternalLink(DISCORD_URL)}
            className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#5865F2] px-3 py-2 text-sm font-medium text-white transition hover:brightness-110"
          >
            <svg viewBox="0 0 24 24" width={16} height={16} fill="white" aria-hidden>
              <path d={siDiscord.path} />
            </svg>
            {t("sidebar.discord")}
          </button>
          <button
            type="button"
            onClick={() => void openExternalLink(DONATE_URL)}
            title={t("sidebar.donateHint")}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-[#f472b6]/40 px-3 py-2 text-sm font-medium text-[#f9a8d4] transition hover:bg-[#f472b6]/10"
          >
            <Heart size={15} />
            {t("sidebar.donate")}
          </button>
        </div>
      </div>
    </aside>
  );
}

function NavList({
  items,
  route,
  onNavigate,
  badge = {},
}: {
  items: NavItem[];
  route: Route;
  onNavigate: (route: Route) => void;
  badge?: Partial<Record<Route, number>>;
}) {
  const { t } = useTranslation();
  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const isActive = item.route === route;
        const Icon = item.icon;
        const count = badge[item.route] ?? 0;
        return (
          <button
            key={item.route}
            type="button"
            onClick={() => onNavigate(item.route)}
            className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] transition-colors ${
              isActive
                ? "bg-[var(--dk-accent)]/15 text-white shadow-[inset_0_0_0_1px_rgb(91_124_255/35%)]"
                : "text-[var(--dk-text)]/85 hover:bg-white/5 hover:text-white"
            }`}
          >
            <Icon
              size={20}
              className={
                isActive
                  ? "text-[var(--dk-accent-hover)]"
                  : "text-[var(--dk-text-muted)] group-hover:text-[var(--dk-text)]"
              }
            />
            <span className="flex-1">{t(item.labelKey)}</span>
            {count > 0 ? (
              <span className="dk-gradient min-w-5 rounded-full px-1.5 text-center text-xs font-semibold text-white">
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
