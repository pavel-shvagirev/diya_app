# Security policy

[English](SECURITY.en.md) · [Русский](SECURITY.md)

## Reporting a vulnerability

Please **do not** open a public issue. Use GitHub's private vulnerability reporting
("Security" tab → "Report a vulnerability") on this repository. Include the version, the
operating system, and steps to reproduce.

## Supported versions

Only the latest release gets fixes. Reports are handled on a best-effort basis; no response time
is promised.

## Scope and design

- The renderer runs sandboxed with context isolation and no Node access; it talks to the main
  process only through the typed `window.api` bridge, and every IPC handler validates its input.
- The OAuth session is stored encrypted with the operating-system keystore (Electron
  `safeStorage`); tokens, signed links and credentials written into a message are redacted from
  logs, and the log folder and file are readable by the user only. Log lines still hold file names
  and paths (always at the `trace` level: whole Disk answers), so do not post a log unread.
- The access token is sent only to `https://cloud-api.yandex.net`; the application's client
  secret and the refresh token only to `https://oauth.yandex.ru` / `.com`. The secret and the
  session are stored encrypted (`client-secret.bin`, `token.bin`). Nothing is sent anywhere else:
  no telemetry, no other servers.
- External links open only for an allow-list of Yandex domains over HTTPS.
- Every IPC handler checks that the sender is one of the app's own pages and validates its input.
- The sync folder cannot be the whole disk, the home folder, a system folder or the app's data
  folder; symbolic links are not followed; transfer links must be https; downloads are verified
  against the size and md5 the Disk reports.
- Creating public links is currently disabled (`FEATURES.publicLinks`) and refused in the main process.
- "Show in folder" opens only paths inside the sync folder or the app data folder.
