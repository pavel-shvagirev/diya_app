# Third-party notices

## JetBrains Mono

`src/renderer/fonts/JetBrainsMono-Regular.woff2` and `JetBrainsMono-Bold.woff2`.
Copyright 2020 The JetBrains Mono Project Authors (<https://github.com/JetBrains/JetBrainsMono>).
Licensed under the SIL Open Font License, Version 1.1 — <https://openfontlicense.org>.

The font is bundled unmodified. It is not sold on its own.

## Yandex Disk icon

`assets/brand/yandex-disk-icon.png`, `src/renderer/public/yandex-disk.png`. Trademark of Yandex, not
MIT-licensed, used only to mark the integration; see [assets/brand/NOTICE.md](assets/brand/NOTICE.md).

## Application icon

`assets/icon-pack/ios/AppIcon-1024.png` is the project's own master icon; `build/icon.png` and the tray icons are derived
from it by `scripts/make-icons.py`.

## npm dependencies

Runtime dependencies (Electron, React, Zustand, better-sqlite3, chokidar) and their licenses
are listed by `npm ls --omit=dev` and in each package's own `LICENSE` file; Electron's
bundled Chromium licenses ship with the application (`LICENSES.chromium.html`).
