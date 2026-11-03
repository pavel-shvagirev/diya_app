# Architecture

Electron app, three processes of code:

| Layer    | Where          | Role                                                                                                                               |
| -------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Main     | `src/main`     | Yandex Disk API, sync, tokens, windows, tray, menus. Node.js.                                                                      |
| Preload  | `src/preload`  | Exposes a typed `window.api` (`contextBridge`); bundled to CommonJS by esbuild because a sandboxed preload cannot load ES modules. |
| Renderer | `src/renderer` | React + Zustand UI. Sandboxed, no Node access.                                                                                     |
| Shared   | `src/shared`   | IPC channel names, types, path/URL validation, feature switches.                                                                   |

## Main process

- **`main.ts`** — start-up and lifecycle: creates the services below, wires IPC, tray and menus,
  single-instance lock, quit handling. Excluded from unit coverage; the e2e run covers it.
- **`yandex-api.ts`** — REST client for `https://cloud-api.yandex.net/v1/disk` (list with
  pagination, upload/download links, copy/move/delete/mkdir, publish/unpublish, trash,
  operations). Retries 429/5xx with backoff, polls 202 operations (only on the API origin),
  on 401 tries the refresh token once and otherwise signs out.
- **`oauth.ts`, `auth-service.ts`, `app-config.ts`, `token-store.ts`** — sign-in by the Yandex
  OAuth _device flow_ (code shown in the app, confirmed in a browser; no redirect URI; the user's own application ID
  and secret), token refresh, Client ID resolution (typed → `YADISK_CLIENT_ID`;
  builds carry no ID), encrypted session file.
- **`language.ts`** — the interface language (system / ru / en, kept in `settings.json`): native menus
  read it, pages get it as `?lang=` when loaded, so a change reloads the windows. Strings live in
  `src/renderer/lib/strings.ts` (pages) and `menu-strings.ts` (menus, tray).
- **`transfer.ts`** — streaming upload/download with byte progress; downloads go to `*.part`
  and are renamed on success.
- **`sync-engine.ts`, `sync-db.ts`, `fs-watcher.ts`, `remote-storage.ts`, `sync-control.ts`** —
  see below.
- **`ipc-handlers.ts`** — every `window.api` call; validates paths and arguments.
- **`logger.ts`, `log-window.ts`** — ring buffer + rotating file, redaction, the log window.
- **Windows and menus:** `window-holder.ts` (re-creates the main window on demand),
  `quit-guard.ts` + `hint-window.ts` (double Cmd/Ctrl+Q), `tray.ts`, `app-menu.ts`,
  `quit-key.ts` (the guarded Cmd/Ctrl+Q inside windows), `app-icon.ts` (window and Dock icon),
  `menu-strings.ts`, `security.ts` (navigation guard, CSP, `safeStorage` wrapper).

## Sync

One pair (local folder ⇄ Disk folder). Every run (60 s timer, local file events, "sync now"):

1. Scan both trees (the Disk side folder by folder) and read the last agreed state from
   `sync_state` (SQLite).
2. For each path decide from _(local, Disk, last state)_: upload, download, conflict, delete on
   one side, or nothing; the reason is logged at debug level.
3. Execute: folders first, then files, deletions last. After an upload the Disk size is checked;
   a damaged copy is removed and reported.

Safety rules: a file changed on both sides keeps both versions; a file whose size/md5 cannot be
compared yet waits for the next run; files modified in the last 2 s are deferred; a run whose
deletions exceed 50 % of the known files (and at least 10) is refused when the Disk listing looks
emptied, or when the local folder vanished; local deletions are carried to the Disk trash.

## Reliability of the API layer

- Every API request has a timeout (30 s, body included). Only reads (GET) are repeated after a
  network failure; a lost answer to a write may hide a write that happened. 429 and 5xx are
  repeated with backoff, the server's `Retry-After` (seconds or a date, at most a minute) wins.
- Errors are `YandexApiError` (`api-error.ts`): `status`, the API `error` id and `description`.
  Code branches on `errorStatus()`, never on message text.
- A 202 is polled only when its link is an operation status link on the API origin
  (`/v1/disk/operations?id=…` or `/operations/<id>`).
- Transfers (`transfer.ts`): a limit on connecting, on silence while bytes flow and on the Disk's
  answer after an upload; an upload is repeated after 500/503 or a failed connection with a fresh
  link; downloads are verified (size, md5, announced length) before they replace anything.

## Security model

Sandboxed renderer with context isolation; strict CSP; IPC input validation; the access token only
to the API host (`cloud-api.yandex.net`), the client secret and refresh token only to the OAuth
host (`oauth.yandex.ru` / `.com`); HTTPS-only allow-listed external links; session encrypted with
the OS keystore; a function with a known problem is switched off in `src/shared/features.ts` and
refused in the main process, not just hidden in the UI.

Also: every IPC handler checks that the message comes from one of our own pages
(`isTrustedSender`); all permission requests are denied; the sync folder is refused when it is the
whole disk, the home folder, a system folder or overlaps the app data (`sync-folder.ts`);
symbolic links are never followed (upload, sync scan); upload/download links must be https; without a real
OS keyring (Linux `basic_text`) nothing is stored; packaged builds flip the Electron fuses
(`runAsNode`, `NODE_OPTIONS`, `--inspect` off, asar-only, asar integrity).

## Tests

`tests/contract` runs the client against the response examples of the official reference
(`official-examples.ts` cites the page of each); add an example there before relying on a new
shape.

`npm test` (Vitest, happy-dom). Main-process modules are tested with injected dependencies; the
transfer layer additionally against a real local HTTP server; renderer stores and components with
Testing Library. API response shapes in tests come from the official documentation.

`npm run e2e` (`e2e/smoke.cjs`) starts the real app against an in-memory Disk
(`e2e/fake-disk.cjs`) with a throw-away profile and checks sign-in, browsing, create/delete/restore,
sync and the language switch; it needs a display and is not part of CI.
