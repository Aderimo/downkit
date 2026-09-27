import { create } from "zustand";
import type {
  EncoderInfo,
  RecorderSources,
  RecorderStatus,
  RecordingFile,
  SavedRecording,
} from "../types/recorder";
import type { LocalizedError } from "../lib/errors";
import type { RecorderHotkey } from "../lib/recorderSettings";

export type RecorderPending = "record" | "replay" | "save" | null;

interface RecorderStore {
  status: RecorderStatus;
  sources: RecorderSources | null;
  encoder: EncoderInfo | null;
  /** O an sürmekte olan istek (düğme "Başlatılıyor…" göstersin). */
  pending: RecorderPending;
  error: LocalizedError | null;
  /** Hata olmayan kısa bilgi (ör. anlık tekrar kapalıyken kaydet'e basıldı). */
  notice: string | null;
  lastSaved: SavedRecording | null;
  /** Çözülmüş kayıt klasörü. */
  outputDir: string | null;
  recordings: RecordingFile[];
  recordingsLoaded: boolean;
  /** Küçük resimler: yol → data URL (null: üretilemedi). */
  thumbs: Record<string, string | null>;
  /** Kaydedilemeyen kısayollar (başka program kullanıyor). */
  hotkeyErrors: Partial<Record<RecorderHotkey, string>>;
  /** Windows'a kaydedilmiş, çalışan kısayollar. */
  activeHotkeys: RecorderHotkey[];
  /** Son basılan kısayol (sayfada "Algılandı" göstermek için). */
  lastHotkey: { key: RecorderHotkey; at: number } | null;
  patch: (patch: Partial<RecorderStore>) => void;
}

export const EMPTY_STATUS: RecorderStatus = { recording: null, replay: null };

export const useRecorderStore = create<RecorderStore>((set) => ({
  status: EMPTY_STATUS,
  sources: null,
  encoder: null,
  pending: null,
  error: null,
  notice: null,
  lastSaved: null,
  outputDir: null,
  recordings: [],
  recordingsLoaded: false,
  thumbs: {},
  hotkeyErrors: {},
  activeHotkeys: [],
  lastHotkey: null,
  patch: (patch) => set(patch),
}));

/** Kayıt ya da anlık tekrar sürüyor mu (pencere kapatılınca tepsiye inmek için). */
export function isRecorderActive(): boolean {
  const { status } = useRecorderStore.getState();
  return status.recording !== null || status.replay !== null;
}
