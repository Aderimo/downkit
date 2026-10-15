# Third-party notices

DownKit is © 2026 aderimo and licensed under the MIT License ([LICENSE](LICENSE)). It is built
on the open-source work listed below.

## Downloaded on first use (not bundled in DownKit.exe)

| Component                                              | License                                | Used for                               |
| ------------------------------------------------------ | -------------------------------------- | -------------------------------------- |
| [FFmpeg](https://ffmpeg.org)                           | LGPL-2.1+ / GPL (depends on the build) | Recording, converting, effects, export |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp)             | Unlicense                              | Downloading from links                 |
| [Deno](https://deno.com)                               | MIT                                    | JavaScript runtime yt-dlp uses         |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) | MIT                                    | On-device automatic captions           |
| Whisper speech models                                  | MIT                                    | Speech recognition model files         |

These are fetched from their official release pages the first time they are needed and run as
separate processes. Their source code and licenses are available on those pages.

## Compiled into DownKit

- **Rust crates** (Tauri, windows-rs, tokio, serde, image and others): permissive licenses
  (MIT, Apache-2.0, BSD, ISC, Zlib, Unicode-3.0, BSL-1.0, CC0). A few crates Tauri depends on
  (`cssparser`, `cssparser-macros`, `selectors`, `dtoa-short`, `option-ext`) are under MPL-2.0;
  they are used unmodified and their source is on [crates.io](https://crates.io). Exact versions:
  `src-tauri/Cargo.lock`.
- **JavaScript packages** (React, Zustand, dockview, lucide and others): MIT, Apache-2.0 or ISC.
  Exact versions: `pnpm-lock.yaml`.
- **Fonts** Bricolage Grotesque and Figtree via Fontsource: SIL Open Font License 1.1.
- **Icons** from [Simple Icons](https://simpleicons.org/): CC0-1.0. The logos are trademarks of
  their owners and only mark the platforms an export preset targets.

### EffectCraft (motion titles)

Motion title templates, Lottie import and the frame renderer come from
[EffectCraft](https://github.com/storytold/effectcraft) (crates `effectcraft-*`), pinned to a
fixed commit in `src-tauri/Cargo.toml`:

```
EffectCraft
Copyright (c) 2026 ArtCraft Team and the EffectCraft contributors.
Licensed under the MIT License or the Apache License, Version 2.0, at your option.
```

DownKit uses it under the MIT License. The ArtCraft name, wordmark and logos are trademarks of
the ArtCraft Team and are not used by DownKit. EffectCraft bundles the fonts **Inter**
(The Inter Project Authors), **Noto Serif** (The Noto Project Authors) and **JetBrains Mono**
(The JetBrains Mono Project Authors), all under the SIL Open Font License 1.1.

### nnnoiseless (microphone noise suppression)

DownKit's noise suppression uses [nnnoiseless](https://github.com/jneem/nnnoiseless),
a Rust port of RNNoise. Its license requires this notice in binary distributions:

```
Copyright (c) 2020, Joe Neeman
Copyright (c) 2017, Mozilla
Copyright (c) 2007-2017, Jean-Marc Valin
Copyright (c) 2005-2017, Xiph.Org Foundation
Copyright (c) 2003-2004, Mark Borgerding

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:

- Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.

- Redistributions in binary form must reproduce the above copyright
notice, this list of conditions and the following disclaimer in the
documentation and/or other materials provided with the distribution.

- Neither the name of the Xiph.Org Foundation nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL THE FOUNDATION
OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
