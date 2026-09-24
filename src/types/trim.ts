/** Rust `commands::trim::TrimRequest` ile eşleşir. */
export interface TrimRequest {
  inputPath: string;
  destinationDir: string;
  startSeconds: number;
  endSeconds: number;
  precise: boolean;
}
