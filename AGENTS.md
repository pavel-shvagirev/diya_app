# AGENTS.md

Instructions for AI coding agents (and a quick map for people). English on purpose: this is a
machine-facing document. Human docs come in English and Russian pairs, see "Documentation".

## What this is

Diya: an unofficial desktop client for Yandex Disk. Electron + React + TypeScript, SQLite
(better-sqlite3) for sync state. Windows, macOS, Linux. MIT, no warranty.

## Layout

| Path              | What                                                                          |
| ----------------- | ----------------------------------------------------------------------------- |
| `src/main`        | Main process: API client, OAuth, sync engine, IPC, tray, menus, windows       |
| `src/preload`     | `window.api` bridge (bundled to CommonJS by esbuild)                          |
| `src/renderer`    | React + Zustand UI, plain CSS tokens (`styles/themes.css`), strings in `lib/` |
| `src/shared`      | IPC channel names, types, validation, feature switches, language helpers      |
| `tests`           | Vitest; mirrors `src/`; `tests/contract` = client vs official API examples    |
| `e2e`             | Smoke run of the real app against an in-memory Disk (`npm run e2e`)           |
| `scripts`         | `make-icons.py` (icons from `assets/icon-pack`), `brand-dev-electron.cjs`     |
| `docs`            | Architecture, design system, sign-in guide, releasing                         |
| `assets`, `build` | Icons (`icon-pack` holds the master), Yandex brand notice, entitlements       |

Read `docs/ARCHITECTURE.en.md` before changing the main process and `docs/DESIGN.md` before
touching UI.

## Commands

```sh
npm ci
npm start                 # build + run (rebuilds better-sqlite3 for Electron)
npm run check             # THE gate: lint (code, md, yaml) + types + prettier + tests
npm test                  # vitest (pretest rebuilds better-sqlite3 for Node)
npm run e2e               # real app vs fake Disk; needs a display; E2E_SHOTS=dir saves screenshots
npm run dist              # installers for this OS into release/
npm run icons             # regenerate build/icon.png, build/icons/ (Linux sizes), tray/window icons
```

Done means `npm run check` passes **and** the change was exercised, not just compiled (run the
relevant test, `npm run e2e` for UI/lifecycle changes).

## Rules

- **Tests first for bugs:** reproduce with a failing test, then fix. New behaviour comes with
  tests; coverage thresholds live in `vitest.config.ts` and are never lowered to pass.
- **Do not invent API shapes** in tests or code. Yandex Disk shapes (`_embedded.items`,
  `disk:/` paths, `href` links, error ids) come from the official docs; cite the page.
- **Two languages:** every user-visible string goes into both dictionaries
  (`src/renderer/lib/strings.ts`, `src/main/menu-strings.ts`); `en: typeof ru` fails the build
  when a key is missing. Conflict-copy labels follow the language too.
- **UI:** tokens only (`var(--ui-*)`), no hex in `.tsx`, a `title` on every action button, a
  disabled one says what is missing.
- **Security:** the renderer has no Node access; every IPC handler validates input
  (`src/shared/validation.ts`). The OAuth token goes only to `cloud-api.yandex.net`; the
  secret and refresh token only to `oauth.yandex.*`. A function with a known problem is switched
  off in `src/shared/features.ts` and refused in the main process, not just hidden.
- **Secrets and personal data never enter the repo:** no tokens, client secrets, real client IDs,
  user names, absolute home paths. Test fixtures use obviously fake values. Logs redact tokens.
- **Yandex branding:** never name the app or style its icon like Yandex Disk. The Disk icon marks
  the integration only (`assets/brand/NOTICE.md`). Keep the "not affiliated" notices.
- **Sync is the dangerous part:** never weaken the deletion guard, the settle delay or the
  upload size check without a test that reproduces the loss it prevents.
- Match the surrounding style; touch only what the task needs. Prettier and ESLint run on commit
  (husky + lint-staged) and in CI.

## Pitfalls

- **better-sqlite3 ABI flips:** `npm test` builds it for Node, `npm start`/`npm run e2e` for
  Electron. If Electron says "NODE_MODULE_VERSION", run `npm run native:rebuild:electron`; if
  Vitest does, `npm run native:rebuild:node`.
- **Never point a dev or e2e run at a real profile or sync folder.** Set `YADISK_USER_DATA` to a
  temp folder (`e2e/smoke.cjs` does). A second running copy holds the single-instance lock.
- Hotkeys are not simulated in e2e; window close/quit paths are driven through the API.
- macOS dev runs show the stock Electron name until `scripts/brand-dev-electron.cjs` ran
  (`npm start` does it).

## Documentation

Russian/English pairs, kept in step: `README`, `CHANGELOG`, `CONTRIBUTING`, `SECURITY`,
`CODE_OF_CONDUCT`, `docs/ARCHITECTURE`, `docs/RELEASING`, `docs/SIGN_IN`. The Russian file has the
plain name (`README.md`, shown first on GitHub), the English one the `.en.md` suffix. English only:
`docs/DESIGN.md`, this file.

- Open work and quality plans: `plans/` (git-ignored, local to a checkout, may be absent;
  `plans/TODO.en.md` has priorities P1–P3). User-visible changes: `CHANGELOG.en.md`. Do not add
  status files to tracked paths.
- When behaviour, a data file, a command or a hotkey changes, update the docs in the same change.

## Git

Conventional commit messages (`feat:`, `fix:`, `docs:` …, lines at most 80 columns). Do not push,
tag or rewrite published history unless asked.
