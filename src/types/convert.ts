import type { Chapter } from "./media";

export interface LocalMediaInfo {
  fileName: string;
  filePath: string;
  fileSizeBytes: number;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  /** Ortalama kare hızı (ör. 29.97, 60). */
  fps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  container: string;
  /** MKV/MP4 bölüm işaretleri; yoksa boş. */
  chapters: Chapter[];
}

export interface ConvertRequest {
  inputPath: string;
  destinationDir: string;
  targetContainer: string;
}
