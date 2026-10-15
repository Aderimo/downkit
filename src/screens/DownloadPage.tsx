import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, ListPlus } from "lucide-react";
import { HomeScreen } from "./HomeScreen";
import { BatchScreen } from "./BatchScreen";
import { DownloadsScreen } from "./DownloadsScreen";
import { Tabs } from "../components/ui/Tabs";
import { analyzeLink } from "../lib/workspaceActions";
import { openConvertTab } from "../lib/navigation";

type Mode = "single" | "many";

/** İndir sayfası: üstte link (tek ya da çok), altta indirmeler ve geçmiş.
 * Hepsi tek sayfada: kullanıcı başka yere gitmeden indirmesini izler. */
export function DownloadPage({ onOpenLocalFile }: { onOpenLocalFile: (path: string) => void }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("single");
  const downloadsRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);

  return (
    <div>
      <div ref={topRef} className="mx-auto flex max-w-[1500px] justify-center px-6 pt-5">
        <Tabs
          value={mode}
          onChange={setMode}
          items={[
            { value: "single", label: t("downloadPage.single"), icon: <Link size={14} /> },
            { value: "many", label: t("downloadPage.many"), icon: <ListPlus size={14} /> },
          ]}
        />
      </div>
      {mode === "single" ? (
        <HomeScreen
          onOpenTool={(tab) => openConvertTab(tab)}
          onShowDownloads={() => downloadsRef.current?.scrollIntoView({ behavior: "smooth" })}
          onOpenLocalFile={onOpenLocalFile}
        />
      ) : (
        <BatchScreen />
      )}
      <div ref={downloadsRef} className="border-t border-[var(--dk-border)]">
        <DownloadsScreen
          onAnalyze={(url) => {
            setMode("single");
            void analyzeLink(url);
            topRef.current?.scrollIntoView({ behavior: "smooth" });
          }}
        />
      </div>
    </div>
  );
}
