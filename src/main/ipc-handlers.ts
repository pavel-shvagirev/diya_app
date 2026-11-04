/**
 * IPC handlers: the only bridge between the sandboxed renderer and the
 * main process. Every argument is validated here.
 *
 * @module ipc-handlers
 */
import { lstat, readdir, stat } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';

import { CH, EVENTS } from '../shared/channels.js';
import { FEATURES } from '../shared/features.js';
import {
  resolveSafePath,
  validateLocalPath,
  validateRemotePath,
  validateResourceName,
  validateUrl,
} from '../shared/validation.js';
import { errorStatus } from './api-error.js';
import { menuStrings } from './menu-strings.js';
import { trusted } from './security.js';
import { setSyncEnabled } from './sync-control.js';
import { assertSafeSyncFolder } from './sync-folder.js';
import { downloadFile, uploadFile } from './transfer.js';
import type { AuthService } from './auth-service.js';
import type { SyncDB } from './sync-db.js';
import type { SyncEngine } from './sync-engine.js';
import type { YandexDiskClient } from './yandex-api.js';
import type { FileMetadata, SyncConfig, SyncState, TransferEvent } from '../shared/types.js';

export { CH };
export type IpcChannel = string;

const PROGRESS_THROTTLE_MS = 100;
let transferSeq = 0;
let unsubscribeSync: (() => void) | null = null;

type Handler = (e: IpcMainInvokeEvent, ...args: any[]) => unknown; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Register a handler, replacing an earlier one (windows can be re-created on macOS). */
function handle(channel: string, fn: Handler): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, trusted(fn));
}

/** True when `target` is `base` itself or lies beneath it (no `..` escape, same drive). */
function isInside(base: string, target: string): boolean {
  const rel = path.relative(path.resolve(base), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

const joinRemote = (dir: string, name: string): string => `${dir === '/' ? '' : dir}/${name}`;

/** A local file or folder tree as remote folders to create plus files to upload. */
async function expandLocal(
  local: string,
  remoteDir: string
): Promise<{ dirs: string[]; files: Array<{ local: string; remote: string }> }> {
  const remote = joinRemote(remoteDir, path.basename(local));
  // A link could point outside the chosen folder (or back into it, forever): never followed.
  if ((await lstat(local)).isSymbolicLink()) throw new Error('Symbolic links are not uploaded');
  if (!(await stat(local)).isDirectory()) return { dirs: [], files: [{ local, remote }] };
  const dirs = [remote];
  const files: Array<{ local: string; remote: string }> = [];
  for (const ent of await readdir(local, { withFileTypes: true })) {
    if (ent.name.startsWith('.') || ent.isSymbolicLink()) continue;
    const sub = await expandLocal(path.join(local, ent.name), remote);
    dirs.push(...sub.dirs);
    files.push(...sub.files);
  }
  return { dirs, files };
}

/** Every file under a remote path as [remotePath, relativeLocalPath] pairs. */
async function collectRemoteFiles(
  client: YandexDiskClient,
  remotePath: string,
  relBase: string
): Promise<Array<{ remote: string; rel: string; size?: number; modified?: string; md5?: string }>> {
  const meta: FileMetadata = await client.getMeta(remotePath);
  if (meta.type !== 'dir') {
    return [
      {
        remote: remotePath,
        rel: relBase,
        size: meta.size,
        modified: meta.modified,
        md5: meta.md5,
      },
    ];
  }
  const out: Array<{
    remote: string;
    rel: string;
    size?: number;
    modified?: string;
    md5?: string;
  }> = [];
  for (const child of (await client.listFiles(remotePath)).items) {
    out.push(...(await collectRemoteFiles(client, child.path, path.join(relBase, child.name))));
  }
  return out;
}

export function registerIpcHandlers(
  win: BrowserWindow,
  apiClient?: YandexDiskClient,
  syncDb?: SyncDB,
  syncEngine?: SyncEngine,
  auth?: AuthService,
  /** Folders the sync folder must not overlap (the app's own data). */
  protectedPaths: string[] = []
): void {
  const channels: string[] = [];
  const reg = (channel: string, fn: Handler): void => {
    handle(channel, fn);
    channels.push(channel);
  };
  const push = (event: string, payload: unknown): void => {
    if (!win.isDestroyed()) win.webContents.send(event, payload);
  };
  const needAuth = (): AuthService => {
    if (!auth) throw new Error('Sign-in is not available');
    return auth;
  };
  const needClient = (): YandexDiskClient => {
    if (!apiClient) throw new Error('Not signed in');
    return apiClient;
  };

  /**
   * The file manager changed the Disk behind the sync engine's back: its picture of the folder
   * tree is out of date, so the next run reads the whole tree. Also after a failed call: the Disk
   * may have changed before the error.
   */
  const changesDisk = <T>(work: Promise<T>): Promise<T> =>
    work.finally(() => syncEngine?.invalidateRemote());

  // ── Auth ───────────────────────────────────────────────────

  reg(CH.AUTH_LOGIN, async () => await needAuth().start());
  reg(CH.AUTH_LOGIN_CANCEL, () => {
    auth?.cancel();
    return Promise.resolve();
  });
  reg(CH.AUTH_CONFIG, async () => await Promise.resolve(needAuth().config()));
  reg(CH.AUTH_SET_CLIENT_ID, async (_e, id: unknown, secret?: unknown) => {
    if (typeof id !== 'string' || id.length > 128) throw new Error('Invalid Client ID');
    if (secret !== undefined && (typeof secret !== 'string' || secret.length > 128)) {
      throw new Error('Invalid Client secret');
    }
    const service = needAuth();
    service.setCredentials(id, secret);
    return await Promise.resolve(service.config());
  });
  reg(CH.AUTH_SET_TOKEN, async (_e, token: unknown) => {
    if (typeof token !== 'string' || !token.trim() || token.length > 4096) {
      throw new Error('Invalid token');
    }
    const client = needClient();
    auth?.cancel();
    auth?.useManualToken();
    client.setAccessToken(token.trim());
    try {
      await client.getDiskInfo(); // verify against the real API
    } catch (err) {
      client.setAccessToken('');
      throw new Error(
        errorStatus(err) === 401
          ? 'Token rejected by Yandex.Disk'
          : `Could not verify token: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  });
  reg(CH.AUTH_LOGOUT, () => {
    syncEngine?.stop();
    auth?.cancel();
    auth?.useManualToken();
    apiClient?.setAccessToken('');
    push(EVENTS.AUTH_CHANGED, false);
    return Promise.resolve();
  });
  reg(CH.AUTH_STATUS, () =>
    Promise.resolve({ isAuthenticated: Boolean(apiClient?.getAccessToken()) })
  );

  // ── Files ──────────────────────────────────────────────────

  reg(CH.FILES_LIST, (_e, p: string) => {
    validateRemotePath(p);
    return needClient().listFiles(p);
  });
  reg(CH.FILES_DELETE, (_e, p: string, permanently?: boolean) => {
    validateRemotePath(p);
    return changesDisk(needClient().deleteFile(p, permanently ?? false));
  });
  reg(CH.FILES_COPY, (_e, s: string, t: string) => {
    validateRemotePath(s);
    validateRemotePath(t);
    return changesDisk(needClient().copyFile(s, t));
  });
  reg(CH.FILES_MOVE, (_e, s: string, t: string) => {
    validateRemotePath(s);
    validateRemotePath(t);
    return changesDisk(needClient().moveFile(s, t));
  });
  reg(CH.FILES_MKDIR, (_e, p: string) => {
    validateRemotePath(p);
    return changesDisk(needClient().mkdir(p));
  });
  reg(CH.FILES_PUBLISH, async (_e, p: string) => {
    // Switched off until Task 24; refuse here too so a compromised renderer cannot publish.
    if (!FEATURES.publicLinks) throw new Error('Public links are disabled');
    validateRemotePath(p);
    return (await needClient().publish(p)).public_url;
  });
  reg(CH.FILES_UNPUBLISH, (_e, p: string) => {
    validateRemotePath(p);
    return needClient().unpublish(p);
  });
  reg(CH.FILES_QUOTA, () => needClient().getDiskInfo());

  // Run `fn` with throttled progress events; report the outcome either way.
  async function tracked(
    name: string,
    direction: TransferEvent['direction'],
    fn: (onProgress: (done: number, total: number) => void) => Promise<void>
  ): Promise<void> {
    const id = `t${++transferSeq}`;
    let last = 0;
    const emit = (e: Partial<TransferEvent>): void =>
      push(EVENTS.TRANSFER_PROGRESS, {
        id,
        name,
        direction,
        done: 0,
        total: 0,
        status: 'active',
        ...e,
      });
    emit({});
    try {
      await fn((done, total) => {
        const now = Date.now();
        if (now - last >= PROGRESS_THROTTLE_MS) {
          last = now;
          emit({ done, total });
        }
      });
      emit({ status: 'done', done: 1, total: 1 });
    } catch (err) {
      emit({ status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  }

  reg(CH.FILES_UPLOAD, async (_e, remoteDir: string, localPaths?: string[]) => {
    validateRemotePath(remoteDir);
    const client = needClient();
    // Uploading creates files and folders on the Disk, also when it fails halfway.
    try {
      let files = localPaths;
      if (!files) {
        const picked = await dialog.showOpenDialog(win, {
          properties: ['openFile', 'multiSelections'],
        });
        if (picked.canceled) return;
        files = picked.filePaths;
      }
      for (const local of files) {
        validateLocalPath(local);
        let plan;
        try {
          plan = await expandLocal(local, remoteDir);
          for (const dir of plan.dirs) {
            // An existing folder (409) is fine: its contents are still uploaded.
            await client.mkdir(dir).catch((e: unknown) => {
              if (errorStatus(e) !== 409) throw e;
            });
          }
        } catch (err) {
          await tracked(path.basename(local), 'upload', () => Promise.reject(err));
          continue;
        }
        for (const file of plan.files) {
          await tracked(path.relative(path.dirname(local), file.local), 'upload', cb =>
            uploadFile(client, file.local, file.remote, false, cb).then(() => undefined)
          );
        }
      }
    } finally {
      syncEngine?.invalidateRemote();
    }
  });

  reg(CH.FILES_DOWNLOAD, async (_e, remotePaths: string[]) => {
    const client = needClient();
    for (const rp of remotePaths) validateRemotePath(rp);
    const picked = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: menuStrings().saveTo,
    });
    if (picked.canceled || !picked.filePaths[0]) return false;
    const dest = picked.filePaths[0];
    for (const rp of remotePaths) {
      let items;
      try {
        items = await collectRemoteFiles(client, rp, path.posix.basename(rp));
      } catch (err) {
        await tracked(path.posix.basename(rp), 'download', () => Promise.reject(err));
        continue;
      }
      for (const item of items) {
        await tracked(item.rel, 'download', async cb => {
          const target = resolveSafePath(dest, item.rel);
          await (await import('fs/promises')).mkdir(path.dirname(target), { recursive: true });
          await downloadFile(
            client,
            item.remote,
            target,
            cb,
            item.modified ? new Date(item.modified) : undefined,
            { size: item.size, md5: item.md5 }
          );
        });
      }
    }
    return true;
  });

  // ── Trash ──────────────────────────────────────────────────

  reg(CH.FILES_TRASH, (_e, p?: string) => {
    // A folder inside the trash, by its path relative to the trash root; none means the root.
    if (p !== undefined) validateRemotePath(p);
    return needClient().getTrashResources(p);
  });
  reg(CH.TRASH_RESTORE, (_e, p: string, name?: unknown) => {
    validateRemotePath(p);
    if (name === undefined) return changesDisk(needClient().restoreFromTrash(p));
    return changesDisk(needClient().restoreFromTrash(p, validateResourceName(name)));
  });
  reg(CH.TRASH_DELETE, (_e, p: string) => {
    validateRemotePath(p);
    return needClient().emptyTrash(p);
  });
  reg(CH.TRASH_EMPTY, () => needClient().emptyTrash());

  // ── Dialogs ────────────────────────────────────────────────

  reg(CH.DIALOG_SELECT_FOLDER, async (_e, title?: string) => {
    const picked = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: typeof title === 'string' ? title : undefined,
    });
    return picked.canceled ? null : (picked.filePaths[0] ?? null);
  });

  // ── Sync ───────────────────────────────────────────────────
  // One sync pair is supported. It is persisted in SyncDB so it survives restarts.

  const currentPair = (): (SyncConfig & { id: string }) | null => {
    const pair = syncDb?.getPairs()[0];
    return pair
      ? {
          id: pair.id,
          localPath: pair.localPath,
          remotePath: pair.remotePath,
          enabled: pair.isActive,
        }
      : null;
  };
  unsubscribeSync?.();
  unsubscribeSync = syncEngine?.onProgress(p => push(EVENTS.SYNC_PROGRESS, p)) ?? null;

  reg(CH.SYNC_GET_CONFIG, () => {
    const pair = currentPair();
    return Promise.resolve(
      pair
        ? { localPath: pair.localPath, remotePath: pair.remotePath, enabled: pair.enabled }
        : null
    );
  });
  reg(CH.SYNC_CONFIGURE, (_e, localPath: string, remotePath: string) => {
    validateLocalPath(localPath);
    validateRemotePath(remotePath);
    if (!syncDb || !syncEngine) throw new Error('Sync is unavailable');
    assertSafeSyncFolder(localPath, { home: os.homedir(), protectedPaths });
    for (const old of syncDb.getPairs()) {
      syncDb.clearSyncState(old.id);
      syncDb.removePair(old.id);
    }
    const id = syncDb.addSyncPair(localPath, remotePath);
    syncEngine.configure({ id, localPath, remotePath });
    syncEngine.start();
    return Promise.resolve();
  });
  reg(CH.SYNC_START, () => {
    if (!syncDb || !syncEngine || !setSyncEnabled(syncDb, syncEngine, true)) {
      throw new Error('Choose a sync folder first');
    }
    return Promise.resolve();
  });
  reg(CH.SYNC_PAUSE, () => {
    if (syncDb && syncEngine) setSyncEnabled(syncDb, syncEngine, false);
    return Promise.resolve();
  });
  // Fire and forget: a run can take minutes; progress arrives as events.
  reg(CH.SYNC_NOW, () => {
    void syncEngine?.syncNow({ immediate: true });
    return Promise.resolve();
  });
  reg(CH.SYNC_STATUS, (): Promise<SyncState> => {
    const pair = currentPair();
    const progress = syncEngine?.getProgress();
    return Promise.resolve({
      phase: 'idle',
      totalFiles: 0,
      doneFiles: 0,
      totalBytes: 0,
      doneBytes: 0,
      current: null,
      lastSync: pair ? (syncDb?.getPair(pair.id)?.lastSync ?? null) : null,
      error: null,
      failures: [],
      conflicts: 0,
      ...progress,
      configured: Boolean(pair),
      enabled: pair?.enabled ?? false,
    });
  });

  // ── System ─────────────────────────────────────────────────
  // tray:show / tray:quit are owned by tray.ts.

  reg(CH.SYSTEM_OPEN_EXTERNAL, async (_e, url: string) => {
    validateUrl(url);
    await shell.openExternal(url);
  });
  reg(CH.SYSTEM_SHOW_IN_FOLDER, (_e, p: string) => {
    validateLocalPath(p);
    // A compromised renderer must not be able to point the file manager at arbitrary paths.
    const allowed = [...(syncDb?.getPairs().map(x => x.localPath) ?? []), ...protectedPaths];
    if (!allowed.some(base => isInside(base, p))) {
      throw new Error('Only the sync folder and the app data folder can be shown');
    }
    shell.showItemInFolder(p);
    return Promise.resolve();
  });
}

/** Number of channels this module owns (tray, log and language channels live elsewhere). */
export function getHandlerCount(): number {
  return Object.keys(CH).filter(k => !/^(TRAY|LOG|LANGUAGE)_/.test(k)).length;
}
