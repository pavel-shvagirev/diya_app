# Changelog

[Русский](CHANGELOG.md) · Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versions: [SemVer](https://semver.org/).

## [Unreleased]

### Added

- File-manager UI: folder tree, table, toolbar, context menu, trash, status bar with quota and
  live sync/transfer progress. Light/dark by system theme, Russian and English.
- Sign-in with the user's own Yandex application: Client ID and Client secret (device flow), or a
  pasted token or redirect address. The secret and the session are stored encrypted; no
  application ID, secret or token ships with the app. Links to Yandex OAuth follow the interface
  language (.ru / .com); a rejection shows Yandex's error code. Guide: `docs/SIGN_IN.en.md`.
- Interface language: English or Russian; system language by default, Settings → Language fixes
  one (menus, tray, windows and the conflict-copy label follow at once).
- Two-way folder sync with conflict copies, deletion safeguards and a persistent sync state.
- Log window (`Ctrl/Cmd+Shift+L`): categories, verbosity, search; tokens and signed links redacted.
- Tray; closing the window keeps sync running (`Ctrl/Cmd+W`); `Ctrl/Cmd+Q` needs a second press,
  the menu item "Quit" exits at once.
- Application icon from the project's own icon set: Dock/window icon, tray icon, installers.
- Downloads are verified against the size, md5 and announced length reported by the Disk before
  they replace anything.
- Contract tests against the official API response examples (`tests/contract`); end-to-end run
  against an in-memory Disk (`npm run e2e`); `AGENTS.md`; issue and pull-request templates.
- Packaging for macOS (dmg, zip), Windows (installer, portable) and Linux (AppImage, deb, rpm)
  through GitHub Actions; CI with lint, typecheck, tests with coverage, CodeQL, dependency audit.
- README: launch-at-login instructions for macOS, Windows and Linux.

### Changed

- Electron 45; better-sqlite3 13; electron-builder 26.
- Creating public links is disabled (existing links can be revoked).
- API client: a timeout on every request; reads are retried after network failures, writes are
  not; `Retry-After` is honoured (at most one minute); errors are typed (`YandexApiError`).
- Transfers: limits on connecting, on silence and on the Disk's answer; uploads are repeated
  after 500/503 and failed connections; 413, 507 and 412 are reported in words; 202 counts as
  accepted; files above 50 GB are refused before any request.
- Operation links are recognised in both forms the reference shows
  (`/operations?id=` and `/operations/<id>`); only operation links are polled.

### Security

- IPC: every handler refuses messages from frames that are not the app's own pages; all web
  permission requests are denied.
- Sync folder: the whole disk, the home folder, system folders and the app's data folder are
  refused; symbolic links are not followed on upload or in sync; transfer links must be https.
- Linux: tokens are not stored when only the plain-text keyring fallback is available.
- Packaged builds: Electron fuses (no `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`, `--inspect`;
  asar-only with integrity check); macOS builds are ad-hoc signed; workflows do not keep the
  checkout token.

### Fixed

- Uploads sent an empty body for small files, which produced chains of conflict copies.
- Deleting files locally was refused as a "mass deletion"; it is carried to the Disk trash.
- The OAuth token could be sent to a non-API address while polling an operation.
- Tray "Open" crashed after the window was closed.
- A file or folder replaced by a symbolic link is no longer deleted from the Disk.
- A hung connection no longer freezes sync.
