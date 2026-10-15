import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { IDockviewPanelProps } from "dockview-react";
import {
  Blend,
  Bookmark,
  Captions,
  Clapperboard,
  EyeOff,
  Film,
  ImagePlus,
  LayoutTemplate,
  Music2,
  ScissorsLineDashed,
  SlidersHorizontal,
  Sparkles,
  SunMedium,
  Type,
  Wand2,
} from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import {
  SIMPLE_ADD_TOOLS,
  SIMPLE_EDIT_TOOLS,
  useAddTool,
  useEditorMode,
  useEditTool,
  type AddTool,
  type EditTool,
} from "../../lib/editorPanel";
import { ToolRail, type RailItem } from "../editor/ToolRail";
import { MediaPanel } from "../editor/MediaPanel";
import { BlurPanel, ImagesPanel, MusicPanel } from "../editor/LayerPanels";
import {
  PresetsPanel,
  SubtitlesPanel,
  TextTemplatesPanel,
  TransitionsPanel,
} from "../editor/AddPanels";
import { AutoCutPanel } from "../editor/AutoCutPanel";
import { MotionPanel } from "../editor/MotionPanel";
import { TemplatesPanel } from "../editor/TemplatesPanel";
import { ClipPanel } from "../editor/ClipPanel";
import { ColorPanel, EffectsPanel, FiltersPanel } from "../editor/LookPanels";
import { PlayerArea, PlayerBar } from "../editor/Viewer";
import { Timeline } from "../editor/Timeline";
import { PhonePanel } from "../editor/PhonePanel";
import { TranscriptEditor } from "../editor/TranscriptEditor";
import { Button } from "../ui/Button";

// Düzenleyicinin yerleştirilebilir panelleri. Her biri mevcut bileşeni sarar; panel
// kapsayıcısını doldurur ve kendi içinde kaydırır.

const RAIL_WIDTH = 64;

/** İpucundaki örnek animasyon (scripts/tips ile üretilir, public/tips altında). */
const tipMedia = (id: string) => `/tips/${id}.webm`;

function useAddItems(): RailItem<AddTool>[] {
  const { t } = useTranslation();
  const mode = useEditorMode((s) => s.mode);
  const all: RailItem<AddTool>[] = [
    {
      id: "media",
      label: t("editor.toolMedia"),
      description: t("editor.toolDesc.media"),
      media: tipMedia("media"),
      icon: <Film size={18} />,
    },
    {
      id: "templates",
      label: t("editor.toolTemplates"),
      description: t("editor.toolDesc.templates"),
      media: tipMedia("templates"),
      icon: <LayoutTemplate size={18} />,
    },
    {
      id: "text",
      label: t("editor.toolText"),
      description: t("editor.toolDesc.text"),
      media: tipMedia("text"),
      icon: <Type size={18} />,
    },
    {
      id: "motion",
      label: t("motion.title"),
      description: t("motion.hint"),
      icon: <Clapperboard size={18} />,
    },
    {
      id: "music",
      label: t("editor.toolMusic"),
      description: t("editor.toolDesc.music"),
      media: tipMedia("music"),
      icon: <Music2 size={18} />,
    },
    {
      id: "images",
      label: t("editor.toolImages"),
      description: t("editor.toolDesc.images"),
      media: tipMedia("images"),
      icon: <ImagePlus size={18} />,
    },
    {
      id: "transitions",
      label: t("editor.toolTransitions"),
      description: t("editor.toolDesc.transitions"),
      media: tipMedia("transitions"),
      icon: <Blend size={18} />,
    },
    {
      id: "subtitles",
      label: t("editor.toolSubtitles"),
      description: t("editor.toolDesc.subtitles"),
      media: tipMedia("subtitles"),
      icon: <Captions size={18} />,
    },
    {
      id: "autocut",
      label: t("editor.toolAutoCut"),
      description: t("editor.toolDesc.autocut"),
      media: tipMedia("autocut"),
      icon: <ScissorsLineDashed size={18} />,
    },
    {
      id: "blur",
      label: t("editor.toolBlur"),
      description: t("editor.toolDesc.blur"),
      media: tipMedia("blur"),
      icon: <EyeOff size={18} />,
    },
    {
      id: "presets",
      label: t("editor.toolPresets"),
      description: t("editor.toolDesc.presets"),
      media: tipMedia("presets"),
      icon: <Bookmark size={18} />,
    },
  ];
  // Basit modda yalnızca en çok kullanılan araçlar görünür.
  return mode === "simple" ? all.filter((i) => SIMPLE_ADD_TOOLS.includes(i.id)) : all;
}

function useEditItems(): RailItem<EditTool>[] {
  const { t } = useTranslation();
  const mode = useEditorMode((s) => s.mode);
  const all: RailItem<EditTool>[] = [
    {
      id: "clip",
      label: t("editor.toolClip"),
      description: t("editor.toolDesc.clip"),
      media: tipMedia("clip"),
      icon: <SlidersHorizontal size={18} />,
    },
    {
      id: "filters",
      label: t("editor.toolFilters"),
      description: t("editor.toolDesc.filters"),
      media: tipMedia("filters"),
      icon: <Sparkles size={18} />,
    },
    {
      id: "color",
      label: t("editor.toolColor"),
      description: t("editor.toolDesc.color"),
      media: tipMedia("color"),
      icon: <SunMedium size={18} />,
    },
    {
      id: "effects",
      label: t("editor.toolEffects"),
      description: t("editor.toolDesc.effects"),
      media: tipMedia("effects"),
      icon: <Wand2 size={18} />,
    },
  ];
  return mode === "simple" ? all.filter((i) => SIMPLE_EDIT_TOOLS.includes(i.id)) : all;
}

const Scroll = ({ children }: { children: ReactNode }) => (
  <div className="dk-scroll min-h-0 min-w-0 flex-1 overflow-y-auto p-3">{children}</div>
);

/** Araçlar: simge şeridi + seçilen aracın içeriği. Araç kapatılınca panel şeride daralır. */
export function ToolsPanel({ api }: IDockviewPanelProps) {
  const items = useAddItems();
  const tool = useAddTool((s) => s.tool);
  const setTool = useAddTool((s) => s.setTool);
  const lastWidth = useRef(320);
  useEffect(() => {
    // Yalnız tek panelli grupta daralır (sekmeli grupta öbür paneli gizlemesin).
    if (api.group.panels.length !== 1) return;
    if (!tool) {
      if (api.width > RAIL_WIDTH + 20) lastWidth.current = api.width;
      api.group.api.setSize({ width: RAIL_WIDTH });
    } else if (api.width < 180) {
      api.group.api.setSize({ width: Math.max(260, lastWidth.current) });
    }
  }, [tool, api]);
  return (
    <div className="flex h-full overflow-hidden" data-tour="editor-add">
      <ToolRail
        side="left"
        items={items}
        value={tool}
        onChange={(id) => setTool(tool === id ? null : id)}
      />
      {tool ? (
        <Scroll>
          {tool === "media" ? <MediaPanel /> : null}
          {tool === "templates" ? <TemplatesPanel /> : null}
          {tool === "text" ? <TextTemplatesPanel /> : null}
          {tool === "motion" ? <MotionPanel /> : null}
          {tool === "music" ? <MusicPanel /> : null}
          {tool === "images" ? <ImagesPanel /> : null}
          {tool === "transitions" ? <TransitionsPanel /> : null}
          {tool === "subtitles" ? <SubtitlesPanel /> : null}
          {tool === "autocut" ? <AutoCutPanel /> : null}
          {tool === "blur" ? <BlurPanel /> : null}
          {tool === "presets" ? <PresetsPanel /> : null}
        </Scroll>
      ) : null}
    </div>
  );
}

/** Özellikler: seçili klibin ayarları + sağdaki araç şeridi. */
export function InspectorPanel() {
  const items = useEditItems();
  const tool = useEditTool((s) => s.tool);
  const setTool = useEditTool((s) => s.setTool);
  return (
    <div className="flex h-full overflow-hidden" data-tour="editor-panel">
      <Scroll>
        {tool === "clip" ? <ClipPanel /> : null}
        {tool === "filters" ? <FiltersPanel /> : null}
        {tool === "color" ? <ColorPanel /> : null}
        {tool === "effects" ? <EffectsPanel /> : null}
      </Scroll>
      <ToolRail side="right" tour="editor-tools" items={items} value={tool} onChange={setTool} />
    </div>
  );
}

export function ViewerPanel() {
  const stream = useEditorStore((s) => s.stream);
  return (
    <section className="relative flex h-full flex-col overflow-hidden" data-tour="editor-player">
      <PlayerArea key={stream?.token ?? "none"} />
      <PlayerBar />
    </section>
  );
}

export function TimelinePanel() {
  return <Timeline />;
}

export function PhoneDockPanel() {
  return <PhonePanel />;
}

/** Transkript ayrı panel: metinden kurgu videonun yanında yapılabilsin. */
export function TranscriptPanel() {
  const { t } = useTranslation();
  const has = useEditorStore((s) => s.texts.some((x) => x.auto));
  return (
    <Scroll>
      {has ? (
        <TranscriptEditor />
      ) : (
        <div className="space-y-2 p-1 text-xs text-[var(--dk-text-muted)]">
          <p>{t("workspace.transcriptEmpty")}</p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => useAddTool.getState().setTool("subtitles")}
          >
            {t("workspace.openSubtitles")}
          </Button>
        </div>
      )}
    </Scroll>
  );
}
