# Changelog

[Русский](CHANGELOG.md) · Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versions: [SemVer](https://semver.org/).

## [Unreleased]

## [0.2.1] - 2026-11-04

First public release.

### Added

- File manager: folder tree, table, toolbar, context menu, trash (folders inside it, "Restore
  as…"), status bar with quota and live progress. Light/dark theme, Russian and English.
- Sign-in with your own Yandex application (device flow, or a pasted token); the secret and the
  session are stored encrypted. Guide: `docs/SIGN_IN.en.md`.
- Two-way folder sync with conflict copies, deletion safeguards and a persistent state. Folders
  follow deletions like files do (an empty one is checked by its own request, so it goes within
  a minute); the Disk is read as one flat list of files, and a file is
  deleted locally only after the Disk confirms it is gone.
- Free space is checked before an upload of 64 MB or more.
- Log window (`Ctrl/Cmd+Shift+L`) with a red warning while `trace` is recorded; `diya.log` is
  moved to `diya.log.1` at 5 MB. Tokens and signed links are redacted.
- Tray; closing the window keeps sync running.
- Installers: macOS (dmg, zip), Windows x64/arm64 (installer, portable), Linux x64/arm64
  (AppImage, deb, rpm). CI with lint, typecheck, tests, CodeQL, dependency audit.

### Changed

- Sync runs are at least 5 s apart ("Sync now" starts at once); a file the Disk answers with
  5xx/429 is retried after 1, 2, 4 … 30 min instead of on every run.
- Pausing or quitting cancels the run in flight, including requests and transfers.
- Creating public links is disabled (existing links can be revoked).
- Electron 45, better-sqlite3 13, electron-builder 26; requests go through undici 8.

### Security

- IPC refuses foreign frames and validates all input; web permission requests are denied.
- The sync folder cannot be the whole disk, the home or a system folder; symbolic links are not
  followed; "Show in folder" accepts only the sync and app data folders.
- Packaged builds: Electron fuses, asar integrity; Linux: no tokens in a plain-text keyring.

### Fixed

- A download could crash the app (`assert(!this.paused)`, nodejs/undici#5360).
- Small files were uploaded empty, which produced chains of conflict copies.
- A hung connection no longer freezes sync.
