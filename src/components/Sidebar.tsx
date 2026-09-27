import { useTranslation } from "react-i18next";
import {
  ArrowDownToLine,
  Camera,
  ExternalLink,
  Heart,
  House,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  Maximize2,
  RefreshCw,
  Clapperboard,
  Video,
  Settings,
  Shrink,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "../types/route";
import { useJobsStore } from "../store/jobsStore";
import { ACTIVE_STATUSES } from "../types/jobs";
import { siDiscord } from "simple-icons";
import { BrandMark } from "./BrandMark";
import { AUTHOR_NAME, AUTHOR_URL, DISCORD_URL, DONATE_URL } from "../lib/links";
import { openExternalLink } from "../lib/tauri-api";
import { useSettingsStore } from "../lib/appSettings";
import { useRecorderStore } from "../store/recorderStore";

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
];

const TOOL_ITEMS: NavItem[] = [
  { route: "batch", icon: Layers, labelKey: "nav.batch" },
  { route: "editor", icon: Clapperboard, labelKey: "nav.videoEditor" },
  { route: "record", icon: Video, labelKey: "nav.record" },
  { route: "screenshot", icon: Camera, labelKey: "nav.screenshot" },
  { route: "settings", icon: Settings, labelKey: "nav.settings" },
];

interface SidebarProps {
  route: Route;
  onNavigate: (route: Route) => void;
}

export function Sidebar({ route, onNavigate }: SidebarProps) {
  const { t } = useTranslation();
  const collapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const update = useSettingsStore((s) => s.update);
  const activeJobs = useJobsStore(
    (s) => s.jobs.filter((j) => ACTIVE_STATUSES.includes(j.status) || j.status === "queued").length,
  );
  const recording = useRecorderStore((s) => s.status.recording !== null);
  const replayOn = useRecorderStore((s) => s.status.replay !== null);
  const toggle = () => update({ sidebarCollapsed: !collapsed });
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <aside
      className={`dk-scroll flex shrink-0 flex-col overflow-x-hidden overflow-y-auto border-r border-[var(--dk-border)] bg-[var(--dk-sidebar)] py-5 transition-[width] duration-200 short:py-3 ${
        collapsed ? "w-[84px] px-2" : "w-60 px-4"
      }`}
    >
      <div
        className={`mb-7 flex items-center short:mb-4 ${collapsed ? "flex-col gap-2" : "gap-1"}`}
      >
        <button
          type="button"
          onClick={() => onNavigate("home")}
          title={t("app.tagline")}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1 text-left"
        >
          <BrandMark
            size={collapsed ? 40 : 46}
            className="shrink-0 drop-shadow-[0_8px_18px_color-mix(in_srgb,var(--dk-accent)_35%,transparent)]"
          />
          {collapsed ? null : (
            <span className="min-w-0">
              <span className="font-brand block text-[22px] leading-tight font-black text-white">
                {t("app.name")}
              </span>
              <span className="font-brand block text-[13px] leading-tight font-extrabold text-[var(--dk-brand)]">
                by {AUTHOR_NAME}
              </span>
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={toggle}
          title={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
          aria-label={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
          data-tour="sidebar-toggle"
          className="rounded-lg p-1.5 text-[var(--dk-text-muted)] hover:bg-white/5 hover:text-white"
        >
          <ToggleIcon size={18} />
        </button>
      </div>

      <NavList
        items={MAIN_ITEMS}
        route={route}
        onNavigate={onNavigate}
        badge={{ downloads: activeJobs }}
        collapsed={collapsed}
      />

      {collapsed ? (
        <span className="mx-auto my-4 h-px w-8 bg-[var(--dk-border)]" />
      ) : (
        <p className="mt-7 mb-2 px-3 text-xs font-medium text-[var(--dk-text-muted)] short:mt-4">
          {t("nav.sectionTools")}
        </p>
      )}
      <NavList
        items={TOOL_ITEMS}
        route={route}
        onNavigate={onNavigate}
        collapsed={collapsed}
        live={{ record: recording ? "rec" : replayOn ? "replay" : undefined }}
      />

      <div className="mt-auto pt-6 short:pt-3">
        {collapsed ? (
          <div
            data-tour="maker"
            className="flex flex-col items-center gap-2 rounded-2xl border border-[var(--dk-border)] bg-[var(--dk-surface)] p-2"
          >
            <button
              type="button"
              onClick={() => void openExternalLink(AUTHOR_URL)}
              title={`${t("sidebar.madeBy")} ${AUTHOR_NAME}`}
              className="font-brand text-[11px] font-extrabold text-[var(--dk-brand)] hover:text-white"
            >
              {AUTHOR_NAME}
            </button>
            <button
              type="button"
              onClick={() => void openExternalLink(DISCORD_URL)}
              title={t("sidebar.discord")}
              aria-label={t("sidebar.discord")}
              className="flex h-9 w-full items-center justify-center rounded-xl bg-[#5865F2] text-white transition hover:brightness-110"
            >
              <svg viewBox="0 0 24 24" width={17} height={17} fill="white" aria-hidden>
                <path d={siDiscord.path} />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => void openExternalLink(DONATE_URL)}
              title={t("sidebar.donate")}
              aria-label={t("sidebar.donate")}
              className="flex h-9 w-full items-center justify-center rounded-xl border border-[#f472b6]/40 text-[var(--dk-pink)] transition hover:bg-[#f472b6]/10"
            >
              <Heart size={16} />
            </button>
          </div>
        ) : (
          <div
            data-tour="maker"
            className="rounded-2xl border border-[var(--dk-border)] bg-[var(--dk-surface)] p-3"
          >
            <p className="text-[11px] text-[var(--dk-text-muted)]">{t("sidebar.madeBy")}</p>
            <button
              type="button"
              onClick={() => void openExternalLink(AUTHOR_URL)}
              title={AUTHOR_URL}
              className="font-brand mt-0.5 flex items-center gap-1.5 text-[15px] font-extrabold text-white hover:text-[var(--dk-brand)]"
            >
              {AUTHOR_NAME}
              <ExternalLink size={13} className="text-[var(--dk-text-muted)]" />
            </button>
            <button
              type="button"
              onClick={() => void openExternalLink(DISCORD_URL)}
              className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#5865F2] px-3 py-2 text-sm font-medium text-white transition hover:brightness-110 short:mt-2 short:py-1.5"
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
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-[#f472b6]/40 px-3 py-2 text-sm font-medium text-[var(--dk-pink)] transition hover:bg-[#f472b6]/10 short:py-1.5"
            >
              <Heart size={15} />
              {t("sidebar.donate")}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

function NavList({
  items,
  route,
  onNavigate,
  badge = {},
  collapsed = false,
  live = {},
}: {
  items: NavItem[];
  collapsed?: boolean;
  route: Route;
  onNavigate: (route: Route) => void;
  badge?: Partial<Record<Route, number>>;
  /** Kayıt sürüyor (kırmızı) ya da anlık tekrar açık (sarı) noktası. */
  live?: Partial<Record<Route, "rec" | "replay" | undefined>>;
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
            data-tour={`nav-${item.route}`}
            onClick={() => onNavigate(item.route)}
            title={collapsed ? t(item.labelKey) : undefined}
            className={`group relative flex rounded-xl text-left transition-colors ${
              collapsed
                ? "flex-col items-center gap-1 px-1 py-2 text-[10px] leading-tight short:py-1.5"
                : "items-center gap-3 px-3 py-2.5 text-[15px] short:py-1.5"
            } ${
              isActive
                ? "bg-[var(--dk-accent)]/15 text-white shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--dk-accent)_35%,transparent)]"
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
            <span className={collapsed ? "line-clamp-2 w-full text-center" : "flex-1"}>
              {t(item.labelKey)}
            </span>
            {live[item.route] ? (
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  live[item.route] === "rec" ? "animate-pulse bg-[var(--dk-error)]" : "bg-[#FFD43B]"
                } ${collapsed ? "absolute top-1.5 right-3" : ""}`}
              />
            ) : null}
            {count > 0 ? (
              <span
                className={`dk-gradient min-w-5 rounded-full px-1.5 text-center text-xs font-semibold text-white ${
                  collapsed ? "absolute top-1 right-2 min-w-4 px-1 text-[10px]" : ""
                }`}
              >
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
