// Rust `recorder` modülüyle eşleşen tipler (camelCase).

export interface MonitorInfo {
  hmonitor: number;
  /** ddagrab çıkış sırası; monitör başka ekran kartındaysa yok. */
  ddaIndex: number | null;
  /** Masaüstü koordinatı (sanal ekranın sol üstü); çoklu ekran dizilimi bununla yapılır. */
  x: number;
  y: number;
  width: number;
  height: number;
  primary: boolean;
  /** Soldan sağa sıra (1'den): "2. ekran". */
  number: number;
}

export interface WindowInfo {
  hwnd: number;
  title: string;
  exe: string;
  width: number;
  height: number;
  minimized: boolean;
  /** DownKit'in kendi penceresi. */
  own: boolean;
}

export interface AudioDevice {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface RecorderSources {
  monitors: MonitorInfo[];
  windows: WindowInfo[];
  microphones: AudioDevice[];
  /** Çıkış aygıtları (hoparlör, kulaklık): sistem sesi bunlardan birinden alınır. */
  speakers: AudioDevice[];
}

export type RecorderEncoder = "nvenc" | "amf" | "qsv" | "x264";

export interface EncoderInfo {
  encoder: RecorderEncoder;
  label: string;
  hardware: boolean;
}

/** Çoklu ekran kaydında tek ekranın bölgesi (Rust `MonitorRegion`). */
export interface MonitorRegion {
  hmonitor: number;
  ddaIndex: number | null;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CaptureTarget =
  | { kind: "monitor"; hmonitor: number; ddaIndex: number | null; width: number; height: number }
  | { kind: "monitors"; monitors: MonitorRegion[] }
  | { kind: "window"; hwnd: number; width: number; height: number };

export type RecordQuality = "high" | "balanced" | "small";

/** Rust `recorder::CaptureOptions`. */
export interface CaptureOptions {
  target: CaptureTarget;
  video: {
    fps: number;
    maxHeight: number | null;
    quality: RecordQuality;
    cursor: boolean;
    bitrateKbps: number | null;
  };
  systemAudio: boolean;
  systemAudioId: string | null;
  systemVolume: number;
  microphone: boolean;
  microphoneId: string | null;
  microphoneVolume: number;
  noiseSuppression: boolean;
}

export interface RecorderStatus {
  recording: { seconds: number; bytes: number; path: string; hasAudio: boolean } | null;
  replay: { bufferedSeconds: number; seconds: number; encoder: string } | null;
}

export interface SavedRecording {
  path: string;
  kind: "recording" | "replay";
  seconds: number;
  bytes: number;
}

export interface RecorderErrorPayload {
  kind: "recording" | "replay";
  message: string;
  detail: string | null;
}

export interface RecordingFile {
  path: string;
  name: string;
  extension: string;
  sizeBytes: number;
  modifiedMs: number;
  /** Oluşturulma zamanı: kütüphane buna göre gruplar ve sıralar. */
  createdMs: number;
  /** Oyun / uygulama alt klasörü; kayıt klasörünün kendisindeyse null. */
  folder: string | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  /** Program kapanırken yarım kalmış MKV: MP4'e aktarılabilir. */
  needsRepair: boolean;
}
