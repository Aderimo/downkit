import { useEffect, useMemo, useRef } from "react";
import {
  DockviewDefaultTab,
  DockviewReact,
  type DockviewReadyEvent,
  type DockviewTheme,
  type IDockviewPanelHeaderProps,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import i18n from "../../i18n";
import {
  FIXED_PANELS,
  PANEL_IDS,
  rememberLayout,
  restoreWorkspace,
  setWorkspaceApi,
  useWorkspaceStore,
  type PanelId,
} from "../../lib/workspaces";
import {
  InspectorPanel,
  PhoneDockPanel,
  TimelinePanel,
  ToolsPanel,
  TranscriptPanel,
  ViewerPanel,
} from "./EditorPanels";

// Düzenleyicinin çalışma alanı: paneller sekmelerinden sürüklenip başka yere bırakılır
// (yan yana, alt alta, aynı grupta sekme ya da yüzen pencere), aradaki çizgilerden
// boyutlandırılır, kapatılır; "Düzen" menüsünden geri açılır. Tauri'de HTML5 sürükleme
// güvenilmez olduğundan işaretçi (pointer) olaylarıyla çalışır.

const THEME: DockviewTheme = {
  name: "downkit",
  className: "dockview-theme-downkit",
  colorScheme: "dark",
  gap: 6,
  dndOverlayMounting: "absolute",
  dndPanelOverlay: "group",
  dndTabIndicator: "line",
};

/** Sekme: Video ve Zaman çizelgesi kapatılamaz. */
function Tab(props: IDockviewPanelHeaderProps) {
  return (
    <DockviewDefaultTab
      {...props}
      hideClose={FIXED_PANELS.includes(props.api.id as PanelId)}
      data-panel-tab={props.api.id}
    />
  );
}

export function Workspace() {
  const hostRef = useRef<HTMLDivElement>(null);
  const disposers = useRef<(() => void)[]>([]);
  const components = useMemo(
    () => ({
      tools: ToolsPanel,
      viewer: ViewerPanel,
      phone: PhoneDockPanel,
      inspector: InspectorPanel,
      timeline: TimelinePanel,
      transcript: TranscriptPanel,
    }),
    [],
  );

  useEffect(
    () => () => {
      for (const d of disposers.current) d();
      disposers.current = [];
      setWorkspaceApi(null);
    },
    [],
  );

  function onReady({ api }: DockviewReadyEvent) {
    setWorkspaceApi(api);
    const width = hostRef.current?.clientWidth ?? window.innerWidth;
    restoreWorkspace(api, useWorkspaceStore.getState().active, width);
    const syncOpen = () =>
      useWorkspaceStore
        .getState()
        .setOpen(PANEL_IDS.filter((id) => api.getPanel(id)?.api.isVisible));
    syncOpen();
    // Yerleşim değişince (sürükleme, boyut, kapatma) son hâl saklanır; sık yazmasın diye gecikmeli.
    let timer = 0;
    const changed = api.onDidLayoutChange(() => {
      syncOpen();
      window.clearTimeout(timer);
      timer = window.setTimeout(() => rememberLayout(api), 400);
    });
    const active = api.onDidActivePanelChange(syncOpen);
    disposers.current.push(
      () => changed.dispose(),
      () => active.dispose(),
      () => window.clearTimeout(timer),
    );
  }

  return (
    <div ref={hostRef} className="min-h-0 flex-1" data-workspace>
      <DockviewReact
        className="h-full"
        components={components}
        defaultTabComponent={Tab}
        theme={THEME}
        dndStrategy="pointer"
        floatingGroupDragHandle="titlebar"
        onReady={onReady}
        // Ekran okuyucu duyuruları uygulamanın dilinde.
        getAnnouncement={(e) =>
          i18n.t(`workspace.announce.${e.kind}`, { panel: e.panel.title ?? "" })
        }
      />
    </div>
  );
}
