import { useCallback, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { HomeScreen } from "./screens/HomeScreen";
import { DownloadsScreen } from "./screens/DownloadsScreen";
import { ConvertScreen } from "./screens/ConvertScreen";
import { CompressScreen } from "./screens/CompressScreen";
import { ResizeScreen } from "./screens/ResizeScreen";
import { HistoryScreen } from "./screens/HistoryScreen";
import { BatchScreen } from "./screens/BatchScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { TrimScreen } from "./screens/TrimScreen";
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

  const analyzeFromHistory = useCallback((url: string) => {
    setRoute("home");
    void analyzeLink(url);
  }, []);

  return (
    <div className="flex h-full">
      <Sidebar route={route} onNavigate={setRoute} />
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="dk-scroll min-h-0 flex-1 overflow-y-auto">
          {route === "home" ? (
            <HomeScreen onNavigate={setRoute} onOpenLocalFile={openLocalFile} />
          ) : null}
          {route === "downloads" ? <DownloadsScreen /> : null}
          {route === "convert" ? <ConvertScreen /> : null}
          {route === "compress" ? <CompressScreen /> : null}
          {route === "resize" ? <ResizeScreen key="resize" variant="resize" /> : null}
          {route === "prepare" ? <ResizeScreen key="prepare" variant="platform" /> : null}
          {route === "history" ? <HistoryScreen onAnalyze={analyzeFromHistory} /> : null}
          {route === "batch" ? <BatchScreen /> : null}
          {route === "editor" ? <TrimScreen /> : null}
          {route === "settings" ? <SettingsScreen /> : null}
        </main>
        <StatusBar />
      </div>
    </div>
  );
}

export default App;
