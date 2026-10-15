/* global process, console */
// Kaydedilen kareleri ipucu animasyonuna çevirir: public/tips/<araç>.webm
// (VP9, sessiz, 480 px genişlik, döngüde son kare biraz bekler).
// Çalıştırma: node scripts/tips/encode.mjs  (FFmpeg: uygulamanın indirdiği kopya ya da FFMPEG)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const RAW = "scripts/tips/raw";
const OUT = "public/tips";
const ffmpeg =
  process.env.FFMPEG ?? join(process.env.APPDATA ?? "", "com.aderimo.downkit", "bin", "ffmpeg.exe");
if (!existsSync(ffmpeg)) throw new Error(`FFmpeg bulunamadı: ${ffmpeg}`);
mkdirSync(OUT, { recursive: true });

for (const id of readdirSync(RAW)) {
  const dir = join(RAW, id);
  if (!statSync(dir).isDirectory() || !existsSync(join(dir, "meta.json"))) continue;
  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
  const fps = Math.max(5, Math.min(30, meta.frames / meta.seconds));
  const out = join(OUT, `${id}.webm`);
  execFileSync(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-framerate",
      fps.toFixed(2),
      "-i",
      join(dir, "%04d.png"),
      "-vf",
      // Sonda 0,8 sn durur (döngü başa dönmeden sonuç görülsün); 15 kare/sn yeter.
      "scale=480:-2:flags=lanczos,tpad=stop_mode=clone:stop_duration=0.8,fps=15,format=yuv420p",
      "-c:v",
      "libvpx-vp9",
      "-b:v",
      "0",
      "-crf",
      "40",
      "-row-mt",
      "1",
      "-an",
      out,
    ],
    { stdio: "inherit" },
  );
  console.log(`${out}  ${(statSync(out).size / 1024).toFixed(0)} KB`);
}
