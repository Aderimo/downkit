import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { useConvertFile } from "../store/localFileStore";
import { enqueueLocal } from "../lib/jobEngine";
import { AUDIO_FORMATS, VIDEO_FORMATS, type OutputFormat } from "../types/media";
import { LocalToolShell } from "../components/LocalToolShell";
import { ChoiceCards } from "../components/ui/ChoiceCards";

const DESC_KEYS: Record<OutputFormat, string> = {
  mp4: "presets.mp4Desc",
  webm: "presets.webmDesc",
  mkv: "presets.mkvDesc",
  mov: "presets.movDesc",
  avi: "presets.aviDesc",
  mp3: "presets.mp3Desc",
  m4a: "presets.m4aDesc",
  wav: "presets.wavDesc",
  aac: "presets.aacDesc",
  flac: "presets.flacDesc",
};

export function ConvertScreen() {
  const { t } = useTranslation();
  const [target, setTarget] = useState<OutputFormat>("mp4");
  const choice = (f: OutputFormat) => ({ value: f, title: f.toUpperCase(), desc: t(DESC_KEYS[f]) });

  return (
    <LocalToolShell
      title={t("convert.title")}
      subtitle={t("convert.subtitle")}
      icon={<RefreshCw size={24} />}
      useFile={useConvertFile}
      startLabel={t("convert.convertButton")}
      startIcon={<RefreshCw size={18} />}
      summary={(info) =>
        t("convert.summary", { from: info.container.toUpperCase(), to: target.toUpperCase() })
      }
      renderOptions={(info) => (
        <>
          {info.width !== null ? (
            <ChoiceCards
              label={t("convert.videoFormats")}
              value={target}
              choices={VIDEO_FORMATS.map(choice)}
              onChange={setTarget}
              columns={5}
            />
          ) : null}
          <ChoiceCards
            label={t("convert.audioFormats")}
            value={target}
            choices={AUDIO_FORMATS.map(choice)}
            onChange={setTarget}
            columns={5}
          />
        </>
      )}
      onStart={(info, destinationDir) =>
        enqueueLocal(
          { kind: "convert", inputPath: info.filePath, destinationDir, targetContainer: target },
          info,
        )
      }
    />
  );
}
