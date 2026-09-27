import { useCallback, useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { HomeScreen } from "./screens/HomeScreen";
import { DownloadsScreen } from "./screens/DownloadsScreen";
import { ConvertScreen } from "./screens/ConvertScreen";
import { CompressScreen } from "./screens/CompressScreen";
import { ResizeScreen } from "./screens/ResizeScreen";
import { BatchScreen } from "./screens/BatchScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { EditorScreen } from "./screens/EditorScreen";
import { RecordScreen } from "./screens/RecordScreen";
import { ScreenshotScreen } from "./screens/ScreenshotScreen";
import { useSnipStore } from "./store/snipStore";
import { Tutorial } from "./components/Tutorial";
import { UpdateDialog } from "./components/UpdateDialog";
import { tourForRoute, useTutorialStore } from "./lib/tutorial";
import { initDeepLinks } from "./lib/deepLink";
import { useEditorStore } from "./store/editorStore";
import { useSettingsStore } from "./lib/appSettings";
import { useConvertFile } from "./store/localFileStore";
import { analyzeLink } from "./lib/workspaceActions";
import type { Route } from "./types/route";

function App() {
  // Geliştirmede README ekran görüntüleri için başlangıç sayfası: ?route=settings
  const [route, setRoute] = useState<Route>(
    () =>
      ((import.meta.env.DEV && new URLSearchParams(window.location.search).get("route")) ||
        "home") as Route,
  );

  // Ana sayfaya sürüklenen yerel dosya Dönüştür aracında açılır.
  const openLocalFile = useCallback((path: string) => {
    void useConvertFile.getState().load(path);
    setRoute("convert");
  }, []);

  // Bir sayfa ilk kez açılınca o sayfanın turu kendiliğinden başlar (açık bir tur yoksa).
  const editorReady = useEditorStore((s) => s.phase === "ready");
  const tutorialOpen = useTutorialStore((s) => s.open);
  const pageTours = useSettingsStore((s) => s.pageTours);
  const pageTour = tourForRoute(route, editorReady);
  useEffect(() => {
    if (tutorialOpen || !pageTours || !pageTour) return;
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("demo")) return;
    if (useTutorialStore.getState().seen.includes(pageTour)) return;
    const timer = setTimeout(() => {
      if (!useTutorialStore.getState().open) useTutorialStore.getState().start(pageTour);
    }, 700);
    return () => clearTimeout(timer);
  }, [pageTour, tutorialOpen, pageTours]);

  // Kayıtlar'dan bir video düzenleyicide açılır.
  const openInEditor = useCallback((path: string) => {
    setRoute("editor");
    void useEditorStore.getState().openFile(path);
  }, []);

  // Ekran görüntüsü düzenlenmek ya da çevrilmek üzere açılınca (kısayol, tepsi,
  // seçim penceresi) Ekran Görüntüsü sayfasına geçilir.
  useEffect(
    () =>
      useSnipStore.subscribe((next, prev) => {
        if (next.openSeq !== prev.openSeq) setRoute("screenshot");
      }),
    [],
  );

  const analyzeFromHistory = useCallback((url: string) => {
    setRoute("home");
    void analyzeLink(url);
  }, []);

  // Tarayıcıdaki yer iminden gelen "downkit://" bağlantıları.
  useEffect(() => {
    void initDeepLinks((target) => {
      if (target.action === "edit") {
        setRoute("editor");
        void useEditorStore.getState().openUrl(target.url);
      } else {
        setRoute("home");
        void analyzeLink(target.url);
      }
    });
  }, []);

  return (
    <div className="flex h-full">
      <Sidebar route={route} onNavigate={setRoute} />
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="dk-scroll min-h-0 flex-1 overflow-y-auto">
          {route === "home" ? (
            <HomeScreen onNavigate={setRoute} onOpenLocalFile={openLocalFile} />
          ) : null}
          {route === "downloads" ? <DownloadsScreen onAnalyze={analyzeFromHistory} /> : null}
          {route === "convert" ? <ConvertScreen /> : null}
          {route === "compress" ? <CompressScreen /> : null}
          {route === "resize" ? <ResizeScreen key="resize" /> : null}
          {route === "batch" ? <BatchScreen /> : null}
          {route === "editor" ? <EditorScreen /> : null}
          {route === "record" ? <RecordScreen onOpenInEditor={openInEditor} /> : null}
          {route === "screenshot" ? <ScreenshotScreen /> : null}
          {route === "settings" ? <SettingsScreen /> : null}
        </main>
        <StatusBar pageTour={pageTour} onOpenRecorder={() => setRoute("record")} />
      </div>
      <Tutorial />
      <UpdateDialog />
    </div>
  );
}

export default App;
