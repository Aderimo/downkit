# Changelog

## v0.2.1

**Clip editor**

- Clipchamp-style "My media" panel on the left: every added video/link shows up as a thumbnail card with its duration and source number
- Import many files at once — multi-select in the file dialog or drop several files onto the panel
- Drag a media card onto the timeline to drop the whole source right where you release it, or use the + button to append it at the end; clicking a card previews that source
- The panel opens by default; the old add-source dialog and the source strip above the timeline were merged into it

## v0.2.0

**Clip editor**

- Multiple sources: add more videos — files and links mixed — with "Add video", keep them as chips above the timeline, switch between them, and merge clips from all of them into one export; only the kept parts of each link are downloaded, and sources are normalized to a common size / frame rate / audio format while merging
- Save the frame at the playhead as a PNG (saved to Pictures\DownKit)

**Screen recorder**

- Record several monitors at once: pick more than one screen in the source list and they are stacked side by side in the recording
- Monitors are listed by their position and number ("1. ekran") instead of duplicated names
- If the chosen microphone or desktop audio device can't be opened, the recording falls back to the default device instead of failing
- The stray "Take screenshot" button (and its shortcut) was removed from the recording section — screenshots live in their own section

**Recordings library**

- Trimming no longer sticks while dragging, and the last used range is remembered for the next recording

**Screenshot**

- Quick translate: OCR + translate straight to the clipboard without opening the editor (optional; a switch in settings chooses whether the editor opens)

**Updates**

- The auto-updater is gone: DownKit only checks GitHub for a new version and asks — "update available, do you want it?" with Yes / No, and a second confirmation before the download page opens in your browser. Updating is always your choice

## v0.1.0 — first release

**Download**

- Paste a link from YouTube, TikTok, Instagram, X, Reddit, Facebook, Twitch, Kick, Vimeo, Dailymotion, Pinterest (and anything else yt-dlp supports)
- Video (MP4, WebM, MKV, MOV, AVI) or audio (MP3, M4A, WAV, AAC, FLAC), with an estimated size for every quality
- Download only a section of a video; pick it with handles, time boxes or while watching the preview
- Playlists (up to 500 videos) and batch mode
- Subtitles in chosen languages; a refused subtitle no longer stops the video
- Title, channel and date embedded in the file; cover art for MP3 / M4A / FLAC
- One-click copies for TikTok / Reels / Shorts / YouTube / Instagram, and compressed copies (e.g. under 10 MB for Discord)

**Clip editor**

- Watch a link without downloading it (YouTube HLS, Twitch, Kick and direct files through a local 127.0.0.1 relay)
- Timeline with frames that refill as you zoom (YouTube storyboards or frames from the file), waveform for local files and links, zoom, scroll and an overview map
- Editing like a video editor: split at the playhead (S), delete, trim or extend by dragging an edge, move clips, up to 3 layers
- Speed per clip (0.25×–4×, sound included), undo / redo, a magnet that snaps to the playhead and other clips
- Keyboard shortcuts you can change (add or remove keys per action)
- Export video, audio or a GIF, merged into one file or as separate files; from a link only the kept parts are downloaded, and a paused export resumes without downloading finished parts again
- Volume per clip (mute with M, up to 200%) and fade in / out
- Vertical (9:16), square, 4:5 and 16:9 output with a draggable crop frame in the preview
- Text: titles and captions with size, color, background and position, placed on the timeline
- Chapters on the timeline, a chapter list and "Split by chapters"
- The timeline is saved; the editor offers to continue the last project
- Local files too, with a lightweight preview copy for formats the preview can't play

**Screen recorder**

- Record the screen or a window with system sound and microphone (WASAPI), hardware-encoded (NVENC / AMF / Quick Sync, x264 fallback)
- Instant replay: the last 15 s – 5 min kept on disk, saved with a system-wide shortcut; runs alongside a recording. Like NVIDIA's, the buffer starts again from zero after each save, so the next clip never repeats the previous one
- A small corner notice (never steals focus, hidden from recordings) confirms shortcut actions while you play: recording started / saved, replay on / off / saved
- Shortcuts are read from the lowest keyboard layer while you assign them, so any combination can be set, even one another program (e.g. NVIDIA) currently holds; DownKit then warns and takes the shortcut over as soon as that program lets go. Keys are matched layout-independently (Turkish Q / F), numpad keys work, and combinations that would block typing a character (AltGr) are refused
- Editable global shortcuts, level meters, recordings library with an in-app player, rename, delete to the Recycle Bin and MKV repair
- A recording in progress is finished properly when the app quits

**Screenshot**

- Lightshot-style area selection on a frozen screen (Alt+Shift+S, also from the tray menu), whole-screen capture and an optional 3 / 5 / 10 s delay
- Editor: arrow, rectangle, ellipse, pen, highlighter, text, numbered steps, blur, pixelate and crop, with undo / redo; drawn at full resolution
- Copy, save or save as PNG / JPEG / WebP; "also copy when saving"; what Enter does is configurable
- Offline text recognition (Windows OCR) and quick translate (Alt+Shift+T): English ↔ Turkish, drawn over the original text
- "My screenshots" library with thumbnails: open in editor, copy, show in folder, delete to the Recycle Bin

**Local files**

- Convert (streams are copied instead of re-encoded when the codecs already fit)
- Compress by quality level or target size — fast settings with a resolution cap
- Resize / prepare for platform

**Queue**

- Live percent, speed, size, time left and stage
- Pause / resume, cancel with partial-file cleanup, retry, parallel jobs, speed limit
- A temporary platform error (e.g. YouTube's momentary 403 during section downloads) is retried once automatically
- Survives restarts; minimizes to the tray while busy; running jobs stop when the app quits

**App**

- Welcome tour on first launch (can be turned off, restarted from Settings) and a step-by-step tour for every page
- 16 color themes (12 dark, 4 light): Midnight Blue, Graphite (OBS-style grey), Pitch Black, Twilight, Polar Night, Sakura, Crimson Fire, Amethyst, Emerald Forest, Deep Ocean, Sunset, Turkish Coffee, Snow White, Morning Fog, Seaside Sand, Cotton Candy
- Settings are also kept in a file of their own, so they survive even when WebView2 loses its storage
- Browser shortcuts that make no sense in a desktop app (print, find, caret browsing, back) are disabled
- Collapsible sidebar (icons only)
- Turkish and English interface (more languages can be added as one JSON file), friendly error messages
- "Report this" next to errors copies a report without personal paths, including the last lines of the error log
- Optional SponsorBlock for YouTube downloads
- Automated interface tests (Playwright) in CI
- Send links from the browser with a bookmark (`downkit://`)
- History of files and searches, settings for defaults, subtitles, folders and behavior
- yt-dlp and FFmpeg are fetched on first launch with visible progress; yt-dlp keeps itself up to date; Deno is fetched for YouTube and checksum-verified
- Single window, installer with an optional desktop shortcut
- One-click signed updates for installed copies; the portable exe opens the release page

---

# Değişiklik günlüğü

## v0.1.0 — ilk sürüm

İlk sürümün tüm özellikleri yukarıdaki listede; Türkçe ayrıntılar için [README.tr.md](README.tr.md).
