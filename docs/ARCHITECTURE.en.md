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
  pagination, the flat list of all files, upload/download links, copy/move/delete/mkdir,
  publish/unpublish, trash with its folders and restore under a new name, operations). Retries
  429/5xx with backoff, polls 202 operations (only on the API origin), on 401 tries the refresh
  token once and otherwise signs out. Calls take an optional `AbortSignal`.
- **`network.ts`** — makes every `fetch` of the main process go through undici 8 (HTTP/1.1), because
  the client bundled with Electron 45 can crash the process while a download is being written
  (nodejs/undici#5360). Called first in `main.ts`.
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
- **`ipc-handlers.ts`** — every `window.api` call; validates paths and arguments ("show in
  folder" only for the sync folder and the app data folder).
- **`logger.ts`, `log-window.ts`** — ring buffer (5000 entries) + file (over 5 MB it moves to `diya.log.1`, at start and while running), redaction, the log window. The recording level is `debug` by default and is not stored in settings; turning on `trace` writes a warning into the log and the window shows a red banner.
- **Windows and menus:** `window-holder.ts` (re-creates the main window on demand),
  `quit-guard.ts` + `hint-window.ts` (double Cmd/Ctrl+Q), `tray.ts`, `app-menu.ts`,
  `quit-key.ts` (the guarded Cmd/Ctrl+Q inside windows), `app-icon.ts` (window and Dock icon),
  `menu-strings.ts`, `security.ts` (navigation guard, CSP, `safeStorage` wrapper).

## Sync

One pair (local folder ⇄ Disk folder). Every run (60 s timer, local file events, "sync now"):

1. Scan both trees and read the last agreed state from `sync_state` (SQLite). The Disk side is
   read folder by folder, or, when the whole Disk is synced, mostly from the flat list of files
   (see below).
2. For each path decide from _(local, Disk, last state)_: upload, download, conflict, delete on
   one side, or nothing; the reason is logged at debug level.
3. Execute: folders first, then files, deletions last. After an upload the Disk size is checked;
   a damaged copy is removed and reported.

Runs are kept at least 5 s apart ("sync now" is exempt and starts at once), and a timer tick during a run queues nothing. A file the Disk
answers with 5xx or 429 is not requested again for 1 min, then 2, 4 … up to 30 min (still reported
as failed meanwhile).
A pause (`stop()`) cancels the run in flight: every request and transfer of a run carries one
`AbortSignal` (`RemoteStorage` takes it as the last argument), so a listing or a transfer stops
at once, a half-downloaded `*.part` is removed, and the run ends as paused: not recorded as
finished, not an error. Pausing during the 5 s gap cancels the run waiting there, and quitting
the app pauses too. A "sync now" click during a run queues no repeat.

**Reading the Disk.** The API has no change feed, and a folder listing costs one request per
folder. When the sync root is `/` (the whole Disk) and the remote supports it
(`RemoteStorage.listAllFiles`, `GET /v1/disk/resources/files`), only the first run, "sync now",
a run after 30 minutes (`fullScanMs`) and a run after the Disk refused the flat list (HTTP 400,
remembered for the session) walk the folders; the others read the flat list: one request per
1000 files, only the fields the engine uses (`fields`). The flat list has no folders, so they
come from the paths of the files; empty ones are remembered from the last full scan, but only as a
guess: a flat run never creates a folder because of it. Each such folder is asked for by itself
(`stat`, at most 25 per run, one request each): a 404 means it was deleted on the Disk, and a
folder deleted locally is deleted on the Disk (it holds no file, or the flat list would show it).
An empty folder created on the Disk in between is seen at the next full scan. Changes made through the file
manager (delete, copy, move, new folder, upload, restore from the trash) call
`SyncEngine.invalidateRemote()`, so the next run reads the whole tree. The list is read page by page while the Disk
changes, so a file can slip through: a file that is only _missing_ from a flat list is deleted
locally only after a `stat` answers 404. Any other failure of the flat list ends the run.
A sync folder other than `/` always walks its folders.

**Folders.** A folder seen on both sides at a run is recorded in `sync_state`. A recorded folder
that is missing on one side was deleted there, and the deletion is carried to the other side (the
Disk trash, or the system trash), deepest folder last, but only if nothing is left inside that was
not deleted too. If the other side holds a file that was not deleted (added meanwhile, changed,
or hidden), the folder is made again on the side that lost it and the content decides; a local
folder that still holds hidden files of the user is kept. A folder never seen on both sides is
new and is created on the other side. Folder deletions are decided only after a full scan, never
from the absence of a folder in the flat list.

Safety rules: a file changed on both sides keeps both versions; a file whose size/md5 cannot be
compared yet waits for the next run; files modified in the last 2 s are deferred; a run whose
deletions exceed 50 % of the known files (and at least 10) is refused when the Disk listing looks
emptied, or when the local folder vanished; local deletions are carried to the Disk trash.

### Why sync is a periodic comparison, not a change journal

Chosen for reliability while the project is young; it is a decision about the current stage,
not a claim that it is the best design.

- **State is derived, not replayed.** Every run compares three things read afresh: the local
  tree, the Disk tree and the last agreed state. A missed event, a crash, a network failure, a
  restart or a changed clock cannot leave the sides permanently different: the next run sees
  the difference again. An event stream (file-system watcher, Disk change feed) needs a cursor
  that survives all of these; a lost or stale cursor means silent divergence or data loss.
- **Each decision is local to one path** and is explained by one log line, so a wrong decision
  can be reproduced from a log and covered by a test (`tests/main/sync-engine.test.ts`).
- **The Disk API offers no cheap change feed** for a whole Disk: the nearest things are the
  list of recently changed files and the flat list. The flat list is the cheapest complete read
  (1 request per 1000 files) and is what the engine uses; a full folder walk is kept as the
  reference and runs every 30 minutes.
- **Deletions are the dangerous part**, and a comparison makes them checkable: a deletion needs
  the file to be in the last agreed state, gone on one side and unchanged on the other; it is
  confirmed by an extra request (`stat`) when the list could be incomplete; a run that would
  delete over half of the known files is refused.

Costs, accepted for now: a change is noticed at the next run, so up to a minute (the 60 s timer;
local file events shorten it for local changes) plus the length of the run; a folder deleted on
the Disk that is empty is noticed by its own `stat`, one that held files by the files vanishing
from the list; a run reads the whole flat list even if little changed. Moving to a change
feed with a persistent cursor and file-system events is possible later, behind the same plan
step, once the comparison has been proven on real data; the comparison would stay as the
periodic check that repairs a lost cursor.

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
  Every call takes an `AbortSignal` (pause, quit): nothing is sent after it fires and an upload
  or download in flight is cut off, not repeated.
- An upload of 64 MB or more (not an overwrite, whose old size is unknown) first reads the free
  space (`GET /v1/disk/`) and fails at once with 507 and the numbers if the file cannot fit; if
  the quota cannot be read the upload goes on and the Disk decides. A 507 is not held back by the
  sync engine: the next run tries again.

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
