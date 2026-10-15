<div align="center">

<img src="branding/icon.svg" width="120" alt="DownKit">

# DownKit

Download, convert, edit, record and capture — one free, open-source app for Windows 10 / 11.

**English** · [Türkçe](README.tr.md)

### [⬇ Download DownKit.exe](https://github.com/Aderimo/downkit/releases/latest)

[Releases](https://github.com/Aderimo/downkit/releases) ·
[Report a bug](https://github.com/Aderimo/downkit/issues/new) ·
[Discord](https://discord.gg/z72EaBazJG)

</div>

## Install

Get the latest release from the
[Releases page](https://github.com/Aderimo/downkit/releases/latest):

- **`DownKit-X.Y.Z.exe`** — just download and double-click, no install.
- **`DownKit-X.Y.Z-kurulum.exe`** — installer (Start menu shortcut, uninstaller).
- **`DownKit-X.Y.Z-tasinabilir.zip`** — the same `DownKit.exe` in a zip, right at the top.

Each release lists SHA-256 checksums in `SHA256SUMS.txt`.

Requirements: Windows 10 / 11 (64-bit) and Microsoft Edge WebView2 (built into Windows 11).
If Windows shows "unknown publisher": **More info → Run anyway**.

On first launch DownKit downloads FFmpeg, yt-dlp and Deno once. Automatic captions download
whisper.cpp and a speech model the first time you use them. Settings live in
`%APPDATA%\com.aderimo.downkit`. Settings and projects from ClipKit or DownKit 0.3 move over
automatically.

## What it does

- **Download** from YouTube, TikTok, Instagram, X and hundreds of other sites: paste a link,
  pick MP4 / MP3 / WebM… and quality; playlists, a section of a video only, subtitles,
  SponsorBlock, speed limit, download history. Open the result in the editor with one click.
- **Convert**: change format (video, audio, image), compress to a target size, resize for
  social media (9:16, 1:1, 4:5…), and run the same job on many files at once.
- **Clip editor**: multi-track timeline, split / ripple delete / close gaps, J/L cuts,
  keyframes with easing, timed zoom, 47 transitions, look effects, colour correction, text,
  logos and stickers, undo/redo.
- **Motion titles**: animated lower thirds, title cards, logo reveals and more, drawn by the
  [EffectCraft](https://github.com/storytold/effectcraft) engine; Lottie (`.json`) animations
  too.
- **Audio**: repair assistant (noise, wind, echo), bass/mid/treble equaliser, compressor,
  limiter, social media loudness, volume envelope, cut to the beat, voiceover.
- **Vertical video**: layout gallery (camera + game, circle camera, podcast split), face
  tracking crop, live phone preview with safe areas, one project exported to 9:16 / 1:1 /
  4:5 / 16:9.
- **Captions**: on-device automatic captions, style gallery, active-word highlight,
  transcript editor, SRT / VTT import and export.
- **Screen recording**: a screen, a window or several monitors, desktop audio and a separate
  microphone track, instant replay with a shortcut.
- **Screenshots**: area / window / full screen on a frozen frame, annotate, copy, save, OCR.

Everything is free. There is no account, no Pro tier and no paywall.

## Privacy

No telemetry and no account. Editing, recording and captions run on your computer; your
files are never uploaded. DownKit only talks to the internet to download the links you paste,
to fetch its tools (FFmpeg, yt-dlp, Deno, whisper.cpp) from their official release pages and
to check GitHub for a new version.

## Feedback

Every error in the app has a **Report** button: it copies a short report (version, error and
technical details, without your user name) and opens a pre-filled
[GitHub issue](https://github.com/Aderimo/downkit/issues/new) — you see it before sending. You
can also ask on [Discord](https://discord.gg/z72EaBazJG). See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Requirements: Node.js 22, pnpm, Rust (stable) and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for Windows.

```bash
pnpm install
pnpm tauri dev
```

Checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format:check`, `pnpm test:e2e`
(browser demo scenes, e.g. `?demo=editor`), and `cargo test --lib`, `cargo clippy` in
`src-tauri`. Packaging: `paketle.bat` (see [docs/RELEASING.md](docs/RELEASING.md)).

## Support the project

DownKit is free and stays free. If it saves you time, you can
[buy the author a coffee](https://donate.bynogame.com/aderimo) — entirely optional.

## License

[MIT](LICENSE) © 2026 aderimo. The name and duck logo: [TRADEMARKS.md](TRADEMARKS.md).
Open-source components: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
