# Third-party notices

DownKit itself is © 2026 aderimo, released under the [MIT License](LICENSE).
It is built on the open-source work listed below.

## Downloaded on first use (not bundled in DownKit.exe)

| Component                                  | License                                | Used for                                           |
| ------------------------------------------ | -------------------------------------- | -------------------------------------------------- |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Unlicense                              | Downloading video and audio from links             |
| [FFmpeg](https://ffmpeg.org)               | LGPL-2.1+ / GPL (depends on the build) | Converting, cutting, merging, screen recording     |
| [Deno](https://deno.com)                   | MIT                                    | The JavaScript runtime YouTube requires for yt-dlp |

These programs are fetched from their official release pages the first time they
are needed and run as separate processes. Their source code and licenses are
available on those pages.

## Compiled into DownKit

- **Rust crates** (Tauri, windows-rs, tokio, serde, image and others; about 380 in
  total): all under permissive licenses (MIT, Apache-2.0, BSD, ISC, Zlib,
  Unicode-3.0, BSL-1.0, CC0). Five crates Tauri depends on (`cssparser`,
  `cssparser-macros`, `selectors`, `dtoa-short`, `option-ext`) are under MPL-2.0;
  they are used unmodified and their source is available on
  [crates.io](https://crates.io). The exact versions are listed in
  `src-tauri/Cargo.lock`.
- **JavaScript packages** (React, i18next, Zustand, hls.js, lucide and others):
  MIT, Apache-2.0 or ISC. The exact versions are listed in `pnpm-lock.yaml`.
- **Font** [Nunito](https://fonts.google.com/specimen/Nunito) via `@fontsource/nunito`:
  SIL Open Font License 1.1.
- **Platform icons** from [Simple Icons](https://simpleicons.org/): CC0-1.0. The
  logos themselves are trademarks of their owners and only mark the supported sites.

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
