import { useTranslation } from "react-i18next";
import { Layers, Maximize2, RefreshCw, Shrink } from "lucide-react";
import { ConvertScreen } from "./ConvertScreen";
import { CompressScreen } from "./CompressScreen";
import { ResizeScreen } from "./ResizeScreen";
import { FileBatchScreen } from "./FileBatchScreen";
import { Tabs } from "../components/ui/Tabs";
import type { ConvertTab } from "../types/route";

/** Bilgisayardaki dosyalar: biçim değiştir, küçült, boyutlandır ya da çok dosyaya
 * aynı işi uygula. Her sekme kendi dosyasını hatırlar. */
export function ConvertPage({ tab, onTab }: { tab: ConvertTab; onTab: (tab: ConvertTab) => void }) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="mx-auto flex max-w-5xl justify-center px-6 pt-5" data-tour="convert-tabs">
        <Tabs
          value={tab}
          onChange={onTab}
          items={[
            { value: "convert", label: t("convertPage.convert"), icon: <RefreshCw size={14} /> },
            { value: "compress", label: t("convertPage.compress"), icon: <Shrink size={14} /> },
            { value: "resize", label: t("convertPage.resize"), icon: <Maximize2 size={14} /> },
            { value: "batch", label: t("convertPage.batch"), icon: <Layers size={14} /> },
          ]}
        />
      </div>
      {tab === "convert" ? <ConvertScreen /> : null}
      {tab === "compress" ? <CompressScreen /> : null}
      {tab === "resize" ? <ResizeScreen key="resize" /> : null}
      {tab === "batch" ? <FileBatchScreen /> : null}
    </div>
  );
}
