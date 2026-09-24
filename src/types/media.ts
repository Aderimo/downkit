export type SupportedPlatform =
  | "youtube"
  | "tiktok"
  | "instagram"
  | "x"
  | "reddit"
  | "facebook"
  | "twitch"
  | "kick"
  | "vimeo"
  | "dailymotion"
  | "pinterest";

export interface FormatOption {
  formatId: string;
  container: string;
  height: number | null;
  isAudioOnly: boolean;
  codecLabel: string | null;
  bitrateKbps: number | null;
  estimatedSizeBytes: number | null;
}

export interface QualityOption {
  height: number;
  container: string;
  estimatedSizeBytes: number | null;
}

export interface AudioOption {
  container: string;
  bitrateKbps: number | null;
  estimatedSizeBytes: number | null;
}

export interface MediaMetadata {
  platform: SupportedPlatform;
  title: string;
  uploader: string | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  sourceWidth: number | null;
  sourceHeight: number | null;
  fps: number | null;
  description: string | null;
  viewCount: number | null;
  /** yt-dlp biçimi: YYYYMMDD */
  uploadDate: string | null;
  previewUrl: string | null;
  qualityOptions: QualityOption[];
  audioOption: AudioOption | null;
  formats: FormatOption[];
  flacEligible: boolean;
}

export interface PlaylistEntry {
  url: string;
  title: string;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
}

export interface PlaylistInfo {
  platform: SupportedPlatform;
  title: string;
  uploader: string | null;
  entries: PlaylistEntry[];
  /** Platformun bildirdiği toplam; `entries` ilk 500 ile sınırlı olabilir. */
  totalCount: number | null;
}

/** Rust `AnalyzeResult`: `kind` alanıyla tek video ya da oynatma listesi. */
export type AnalyzeResult =
  ({ kind: "video" } & MediaMetadata) | ({ kind: "playlist" } & PlaylistInfo);

export const VIDEO_FORMATS = ["mp4", "webm", "mkv", "mov", "avi"] as const;
export const AUDIO_FORMATS = ["mp3", "m4a", "wav", "aac", "flac"] as const;
export type VideoFormat = (typeof VIDEO_FORMATS)[number];
export type AudioFormat = (typeof AUDIO_FORMATS)[number];
export type OutputFormat = VideoFormat | AudioFormat;

export function isAudioFormat(format: OutputFormat): format is AudioFormat {
  return (AUDIO_FORMATS as readonly string[]).includes(format);
}

/** Rust `commands::download::DownloadRequest` ile eşleşir. */
export interface DownloadRequest {
  url: string;
  destinationDir: string;
  filenameTemplate: string;
  maxHeight: number | null;
  formatId: string | null;
  outputFormat: OutputFormat;
  audioBitrateKbps: number | null;
  subtitles: boolean;
  subtitleLangs: string[];
  autoSubtitles: boolean;
  rateLimitKbps: number | null;
  sectionStart: number | null;
  sectionEnd: number | null;
}
