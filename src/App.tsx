import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { useSnipStore } from "./store/snipStore";
import { Tutorial } from "./components/Tutorial";
import { UpdateDialog } from "./components/UpdateDialog";
import { WhatsNewDialog } from "./components/WhatsNewDialog";
import { SetupWizard } from "./components/SetupWizard";
import { tourForRoute, useTutorialStore } from "./lib/tutorial";
import { useEditorStore } from "./store/editorStore";
import { openMontage } from "./lib/editorActions";
import { useSettingsStore } from "./lib/appSettings";
import type { ConvertTab, Route } from "./types/route";
import { RecordScreen } from "./screens/RecordScreen";
import { DownloadPage } from "./screens/DownloadPage";
import { useNavStore } from "./lib/navigation";
import { useConvertFile, useCompressFile, useResizeFile } from "./store/localFileStore";

// İndir açılış sayfası; ötekiler ilk açıldıklarında yüklenir.
const SettingsScreen = lazy(() =>
  import("./screens/SettingsScreen").then((m) => ({ default: m.SettingsScreen })),
);
const EditorScreen = lazy(() =>
  import("./screens/EditorScreen").then((m) => ({ default: m.EditorScreen })),
);
const ConvertPage = lazy(() =>
  import("./screens/ConvertPage").then((m) => ({ default: m.ConvertPage })),
);
const ScreenshotScreen = lazy(() =>
  import("./screens/ScreenshotScreen").then((m) => ({ default: m.ScreenshotScreen })),
);

function App() {
  // Geliştirmede README ekran görüntüleri için başlangıç sayfası: ?route=settings
  const [route, setRoute] = useState<Route>(
    () =>
      ((import.meta.env.DEV && new URLSearchParams(window.location.search).get("route")) ||
        "download") as Route,
  );
  const [convertTab, setConvertTab] = useState<ConvertTab>("convert");

  // Bilgisayardaki bir dosya: istenen Dönüştür sekmesinde açılır.
  const openLocalFile = useCallback((path: string, tab: ConvertTab = "convert") => {
    const store =
      tab === "compress" ? useCompressFile : tab === "resize" ? useResizeFile : useConvertFile;
    void store.getState().load(path);
    setConvertTab(tab);
    setRoute("convert");
  }, []);

  // Bir sayfa ilk kez açılınca o sayfanın turu kendiliğinden başlar (açık bir tur yoksa).
  const editorReady = useEditorStore((s) => s.phase === "ready");
  const tutorialOpen = useTutorialStore((s) => s.open);
  const pageTours = useSettingsStore((s) => s.pageTours);
  const setupDone = useSettingsStore((s) => s.setupDone);
  const pageTour = tourForRoute(route, editorReady);
  useEffect(() => {
    if (tutorialOpen || !pageTours || !pageTour || !setupDone) return;
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("demo")) return;
    if (useTutorialStore.getState().seen.includes(pageTour)) return;
    const timer = setTimeout(() => {
      if (!useTutorialStore.getState().open) useTutorialStore.getState().start(pageTour);
    }, 700);
    return () => clearTimeout(timer);
  }, [pageTour, tutorialOpen, pageTours, setupDone]);

  // Kayıtlar'dan bir video düzenleyicide açılır.
  const openInEditor = useCallback((path: string) => {
    setRoute("editor");
    void useEditorStore.getState().openFile(path);
  }, []);
  // Kütüphanede seçilen kayıtlar tek projede, aralarında geçişle.
  const openMontageInEditor = useCallback((paths: string[]) => {
    setRoute("editor");
    void openMontage(paths);
  }, []);

  // Başka bir yerden gelen sayfa isteği (ör. "İndir ve düzenle" bitti, Dönüştür sekmesi).
  useEffect(
    () =>
      useNavStore.subscribe((next, prev) => {
        const request = next.request;
        if (!request || request.seq === prev.request?.seq) return;
        if (request.editPath) openInEditor(request.editPath);
        else if (request.route === "convert" && request.filePath)
          openLocalFile(request.filePath, request.convertTab);
        else {
          if (request.convertTab) setConvertTab(request.convertTab);
          setRoute(request.route);
        }
      }),
    [openInEditor, openLocalFile],
  );

  // Ekran görüntüsü düzenlenmek ya da çevrilmek üzere açılınca (kısayol, tepsi,
  // seçim penceresi) Ekran Görüntüsü sayfasına geçilir.
  useEffect(
    () =>
      useSnipStore.subscribe((next, prev) => {
        if (next.openSeq !== prev.openSeq) setRoute("screenshot");
      }),
    [],
  );

  return (
    <div className="flex h-full">
      <Sidebar route={route} onNavigate={setRoute} compact={route === "editor" && editorReady} />
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="dk-scroll min-h-0 flex-1 overflow-y-auto">
          <Suspense fallback={null}>
            {route === "download" ? (
              <DownloadPage onOpenLocalFile={(p) => openLocalFile(p)} />
            ) : null}
            {route === "convert" ? <ConvertPage tab={convertTab} onTab={setConvertTab} /> : null}
            {route === "editor" ? <EditorScreen /> : null}
            {route === "record" ? (
              <RecordScreen onOpenInEditor={openInEditor} onMontage={openMontageInEditor} />
            ) : null}
            {route === "screenshot" ? <ScreenshotScreen /> : null}
            {route === "settings" ? <SettingsScreen /> : null}
          </Suspense>
        </main>
        <StatusBar pageTour={pageTour} onOpenRecorder={() => setRoute("record")} />
      </div>
      <Tutorial />
      <UpdateDialog />
      <WhatsNewDialog />
      {import.meta.env.DEV && new URLSearchParams(window.location.search).has("demo") ? null : (
        <SetupWizard />
      )}
    </div>
  );
}

export default App;
