import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { handlers, dialogMock, shellMock, uploadFile, downloadFile } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  dialogMock: { showOpenDialog: vi.fn() },
  shellMock: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
  uploadFile: vi.fn(),
  downloadFile: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((c: string, fn: (...a: unknown[]) => unknown) => {
      if (handlers.has(c)) throw new Error(`second handler for ${c}`);
      handlers.set(c, fn);
    }),
    removeHandler: vi.fn((c: string) => handlers.delete(c)),
  },
  dialog: dialogMock,
  shell: shellMock,
  app: { getPath: vi.fn(() => '/home/u') },
}));

vi.mock('../../src/main/transfer.js', () => ({ uploadFile, downloadFile }));

import { CH, EVENTS } from '../../src/shared/channels.js';
import { FEATURES } from '../../src/shared/features.js';
import { getHandlerCount, registerIpcHandlers } from '../../src/main/ipc-handlers.js';

function makeClient() {
  let token = 'tok';
  return {
    getAccessToken: vi.fn(() => token),
    setAccessToken: vi.fn((t: string) => {
      token = t;
    }),
    listFiles: vi.fn().mockResolvedValue({ total: 1, items: [{ path: '/a' }] }),
    getMeta: vi.fn().mockResolvedValue({
      type: 'file',
      size: 3,
      md5: 'abc123',
      modified: '2026-01-01T00:00:00Z',
    }),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    copyFile: vi.fn().mockResolvedValue(undefined),
    moveFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockResolvedValue({ public_url: 'https://yadi.sk/d/1' }),
    unpublish: vi.fn().mockResolvedValue(undefined),
    getTrashResources: vi.fn().mockResolvedValue({ total: 0, items: [] }),
    getDiskInfo: vi.fn().mockResolvedValue({ total_space: 5, used_space: 1, trash_size: 0 }),
    restoreFromTrash: vi.fn().mockResolvedValue(undefined),
    emptyTrash: vi.fn().mockResolvedValue(undefined),
  };
}

function makeDb() {
  const pairs: Array<{ id: string; localPath: string; remotePath: string; isActive: boolean }> = [];
  return {
    pairs,
    getPairs: vi.fn(() => pairs),
    getPair: vi.fn(() => ({ lastSync: '2026-01-02T00:00:00Z' })),
    addSyncPair: vi.fn((l: string, r: string) => {
      pairs.push({ id: 'p1', localPath: l, remotePath: r, isActive: true });
      return 'p1';
    }),
    removePair: vi.fn((id: string) =>
      pairs.splice(0, pairs.length, ...pairs.filter(p => p.id !== id))
    ),
    clearSyncState: vi.fn(),
    togglePairActive: vi.fn((id: string, a: boolean) => {
      const p = pairs.find(x => x.id === id);
      if (p) p.isActive = a;
    }),
  };
}

function makeEngine() {
  let cb: (p: unknown) => void = () => {};
  return {
    configure: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    syncNow: vi.fn().mockResolvedValue(undefined),
    invalidateRemote: vi.fn(),
    getProgress: vi.fn(() => ({ phase: 'idle', doneFiles: 2, totalFiles: 5 })),
    onProgress: vi.fn((f: (p: unknown) => void) => {
      cb = f;
      return vi.fn();
    }),
    emit: (p: unknown) => cb(p),
  };
}

const send = vi.fn();

let tmpRoot: string;
const tmpFile = (name: string, text = 'x'): string => {
  const p = `${tmpRoot}/${name}`;
  fs.writeFileSync(p, text);
  return p;
};
const win = { isDestroyed: () => false, webContents: { send } } as never;
const call = (ch: string, ...args: unknown[]) =>
  handlers.get(ch)!({ senderFrame: { url: 'file:///app/dist/renderer/index.html' } }, ...args);

describe('IPC handlers', () => {
  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(`${os.tmpdir()}/ipc-`);
  });
  /** A real folder under the temp root: the sync folder must exist. */
  const dirIn = (name: string): string => {
    const d = `${tmpRoot}/sync-${name}`;
    fs.mkdirSync(d, { recursive: true });
    return d;
  };
  afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
  });

  it('registers every non-tray channel', () => {
    registerIpcHandlers(win);
    expect(handlers.size).toBe(getHandlerCount());
    expect(handlers.has('tray:show')).toBe(false);
  });

  it('every channel refuses a sender that is not one of our own pages', () => {
    const c = makeClient();
    registerIpcHandlers(win, c as never);
    expect(handlers.size).toBeGreaterThan(25);
    for (const [channel, fn] of handlers) {
      for (const sender of [
        {},
        { senderFrame: null },
        { senderFrame: { url: 'https://evil.example/' } },
        { senderFrame: { url: 'http://localhost:5173/' } },
      ]) {
        expect(() => fn(sender), channel).toThrow('Untrusted IPC sender');
      }
    }
    expect(c.deleteFile).not.toHaveBeenCalled();
  });

  it('can be registered again for a re-created window without throwing', () => {
    registerIpcHandlers(win);
    expect(() => registerIpcHandlers(win)).not.toThrow();
  });

  it('files:* calls the client with validated remote paths', async () => {
    const c = makeClient();
    registerIpcHandlers(win, c as never);
    expect(await call(CH.FILES_LIST, '/Docs')).toMatchObject({ total: 1 });
    await call(CH.FILES_DELETE, '/a', true);
    await call(CH.FILES_COPY, '/a', '/b');
    await call(CH.FILES_MOVE, '/a', '/c');
    await call(CH.FILES_MKDIR, '/n');
    // Creating public links is switched off (FEATURES.publicLinks): refused in the main process.
    await expect(call(CH.FILES_PUBLISH, '/a')).rejects.toThrow(/disabled/i);
    expect(c.publish).not.toHaveBeenCalled();
    // With the switch on the handler validates the path and returns the link.
    FEATURES.publicLinks = true;
    try {
      expect(await call(CH.FILES_PUBLISH, '/a')).toBe('https://yadi.sk/d/1');
      await expect(call(CH.FILES_PUBLISH, 'relative')).rejects.toThrow();
    } finally {
      FEATURES.publicLinks = false;
    }
    // …while revoking an existing link keeps working.
    await call(CH.FILES_UNPUBLISH, '/a');
    expect(c.unpublish).toHaveBeenCalledWith('/a');
    expect(c.deleteFile).toHaveBeenCalledWith('/a', true);
    expect(c.copyFile).toHaveBeenCalledWith('/a', '/b');
    expect(c.moveFile).toHaveBeenCalledWith('/a', '/c');
    expect(c.mkdir).toHaveBeenCalledWith('/n');
  });

  it('rejects path traversal in remote paths', () => {
    registerIpcHandlers(win, makeClient() as never);
    expect(() => call(CH.FILES_LIST, '/a/../../etc')).toThrow();
  });

  it('fails clearly when signed out instead of returning fake data', () => {
    registerIpcHandlers(win);
    expect(() => call(CH.FILES_LIST, '/')).toThrow('Not signed in');
    expect(() => call(CH.FILES_QUOTA)).toThrow('Not signed in');
  });

  it('every change the file manager makes on the Disk tells the sync engine to read the whole tree', async () => {
    const c = makeClient();
    const e = makeEngine();
    registerIpcHandlers(win, c as never, makeDb() as never, e as never);
    for (const [channel, args] of [
      [CH.FILES_DELETE, ['/a']],
      [CH.FILES_COPY, ['/a', '/b']],
      [CH.FILES_MOVE, ['/a', '/b']],
      [CH.FILES_MKDIR, ['/a']],
      [CH.TRASH_RESTORE, ['/a_1']],
    ] as Array<[string, unknown[]]>) {
      e.invalidateRemote.mockClear();
      await call(channel, ...args);
      expect(e.invalidateRemote, channel).toHaveBeenCalledTimes(1);
    }
    // also when the call fails: the Disk may have changed before the error
    c.deleteFile.mockRejectedValueOnce(new Error('500: boom'));
    e.invalidateRemote.mockClear();
    await expect(call(CH.FILES_DELETE, '/a')).rejects.toThrow('boom');
    expect(e.invalidateRemote).toHaveBeenCalledTimes(1);
  });

  it('an upload tells the sync engine too', async () => {
    const e = makeEngine();
    registerIpcHandlers(win, makeClient() as never, makeDb() as never, e as never);
    const f = tmpFile('up.txt');
    await call(CH.FILES_UPLOAD, '/', [f]);
    expect(e.invalidateRemote).toHaveBeenCalled();
  });

  it('a folder inside the trash can be listed; its path is validated', async () => {
    const c = makeClient();
    registerIpcHandlers(win, c as never);
    await call(CH.FILES_TRASH);
    await call(CH.FILES_TRASH, '/x_1/sub');
    expect(c.getTrashResources).toHaveBeenNthCalledWith(1, undefined);
    expect(c.getTrashResources).toHaveBeenNthCalledWith(2, '/x_1/sub');
    expect(() => call(CH.FILES_TRASH, '/x_1/../..')).toThrow();
    expect(() => call(CH.FILES_TRASH, 'relative')).toThrow();
  });

  it('restoring from the trash can give a new name, which is validated', async () => {
    const c = makeClient();
    registerIpcHandlers(win, c as never);
    await call(CH.TRASH_RESTORE, '/x_1', '  new.txt ');
    expect(c.restoreFromTrash).toHaveBeenCalledWith('/x_1', 'new.txt');
    for (const bad of ['', 'a/b', '..', 'x'.repeat(256), 7]) {
      expect(() => call(CH.TRASH_RESTORE, '/x_1', bad)).toThrow();
    }
    expect(c.restoreFromTrash).toHaveBeenCalledTimes(1);
  });

  it('trash channels hit the client', async () => {
    const c = makeClient();
    registerIpcHandlers(win, c as never);
    await call(CH.TRASH_RESTORE, '/x_1');
    await call(CH.TRASH_DELETE, '/x_1');
    await call(CH.TRASH_EMPTY);
    expect(c.restoreFromTrash).toHaveBeenCalledWith('/x_1');
    expect(c.emptyTrash).toHaveBeenNthCalledWith(1, '/x_1');
    expect(c.emptyTrash).toHaveBeenNthCalledWith(2);
  });

  describe('auth', () => {
    it('auth:status reflects the token; logout clears it and stops sync', async () => {
      const c = makeClient();
      const e = makeEngine();
      registerIpcHandlers(win, c as never, undefined, e as never);
      expect(await call(CH.AUTH_STATUS)).toEqual({ isAuthenticated: true });
      await call(CH.AUTH_LOGOUT);
      expect(c.setAccessToken).toHaveBeenCalledWith('');
      expect(e.stop).toHaveBeenCalled();
      expect(await call(CH.AUTH_STATUS)).toEqual({ isAuthenticated: false });
      expect(send).toHaveBeenCalledWith(EVENTS.AUTH_CHANGED, false);
    });

    it('setToken verifies against the API and keeps a good token', async () => {
      const c = makeClient();
      registerIpcHandlers(win, c as never);
      await call(CH.AUTH_SET_TOKEN, '  good ');
      expect(c.setAccessToken).toHaveBeenCalledWith('good');
      expect(c.getDiskInfo).toHaveBeenCalled();
    });

    it('setToken clears a rejected token', async () => {
      const c = makeClient();
      c.getDiskInfo.mockRejectedValue(new Error('401: Unauthorized'));
      registerIpcHandlers(win, c as never);
      await expect(call(CH.AUTH_SET_TOKEN, 'bad')).rejects.toThrow('rejected');
      expect(c.setAccessToken).toHaveBeenLastCalledWith('');
    });

    it('setToken rejects empty / non-string input', async () => {
      registerIpcHandlers(win, makeClient() as never);
      await expect(call(CH.AUTH_SET_TOKEN, ' ')).rejects.toThrow('Invalid');
      await expect(call(CH.AUTH_SET_TOKEN, 5)).rejects.toThrow('Invalid');
    });

    const makeAuth = () => ({
      start: vi.fn().mockResolvedValue({
        userCode: 'ABC',
        verificationUrl: 'https://oauth.yandex.com/device',
        expiresIn: 300,
      }),
      cancel: vi.fn(),
      config: vi.fn().mockReturnValue({ source: 'none', clientId: '', hasSecret: false }),
      setCredentials: vi.fn(),
      useManualToken: vi.fn(),
    });
    const register = (auth = makeAuth(), c = makeClient()) => {
      registerIpcHandlers(win, c as never, undefined, undefined, auth as never);
      return { auth, c };
    };

    it('login starts the device flow and returns the code to show', async () => {
      const { auth } = register();
      expect(await call(CH.AUTH_LOGIN)).toMatchObject({ userCode: 'ABC' });
      expect(auth.start).toHaveBeenCalled();
    });

    it('login-cancel, config and client-id go to the auth service', async () => {
      const { auth } = register();
      await call(CH.AUTH_LOGIN_CANCEL);
      expect(auth.cancel).toHaveBeenCalled();
      expect(await call(CH.AUTH_CONFIG)).toEqual({
        source: 'none',
        clientId: '',
        hasSecret: false,
      });
      await call(CH.AUTH_SET_CLIENT_ID, ' x '.padEnd(20, 'y'));
      expect(auth.setCredentials).toHaveBeenLastCalledWith(' x '.padEnd(20, 'y'), undefined);
      await call(CH.AUTH_SET_CLIENT_ID, 'id'.repeat(10), 'secret'.repeat(4));
      expect(auth.setCredentials).toHaveBeenLastCalledWith('id'.repeat(10), 'secret'.repeat(4));
      await expect(call(CH.AUTH_SET_CLIENT_ID, 'id', 7)).rejects.toThrow('Invalid Client secret');
      await expect(call(CH.AUTH_SET_CLIENT_ID, 'id', 's'.repeat(200))).rejects.toThrow(
        'Invalid Client secret'
      );
      await expect(call(CH.AUTH_SET_CLIENT_ID, 5)).rejects.toThrow('Invalid Client ID');
      await expect(call(CH.AUTH_SET_CLIENT_ID, 'x'.repeat(200))).rejects.toThrow('Invalid');
    });

    it('sign-in channels explain themselves when there is no auth service', async () => {
      registerIpcHandlers(win, makeClient() as never);
      await expect(call(CH.AUTH_LOGIN)).rejects.toThrow('not available');
    });

    it('a pasted token cancels a pending login and forgets the refresh token', async () => {
      const { auth } = register();
      await call(CH.AUTH_SET_TOKEN, 'good');
      expect(auth.cancel).toHaveBeenCalled();
      expect(auth.useManualToken).toHaveBeenCalled();
    });

    it('logout also cancels a pending login', async () => {
      const { auth } = register();
      await call(CH.AUTH_LOGOUT);
      expect(auth.cancel).toHaveBeenCalled();
      expect(auth.useManualToken).toHaveBeenCalled();
    });
  });

  describe('transfers', () => {
    it('uploads picked files into the folder and reports progress events', async () => {
      const c = makeClient();
      uploadFile.mockImplementation(async (_c, _l, _r, _o, cb) => cb(5, 10));
      dialogMock.showOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: [tmpFile('a.txt')],
      });
      registerIpcHandlers(win, c as never);
      await call(CH.FILES_UPLOAD, '/Docs');
      expect(uploadFile).toHaveBeenCalledWith(
        c,
        `${tmpRoot}/a.txt`,
        '/Docs/a.txt',
        false,
        expect.any(Function)
      );
      const states = send.mock.calls
        .filter(x => x[0] === EVENTS.TRANSFER_PROGRESS)
        .map(x => x[1].status);
      expect(states[0]).toBe('active');
      expect(states.at(-1)).toBe('done');
    });

    it('uploads dropped paths without opening a dialog; root folder joins cleanly', async () => {
      registerIpcHandlers(win, makeClient() as never);
      await call(CH.FILES_UPLOAD, '/', [tmpFile('b.txt')]);
      expect(dialogMock.showOpenDialog).not.toHaveBeenCalled();
      expect(uploadFile.mock.calls[0][2]).toBe('/b.txt');
    });

    it('never follows symbolic links when uploading: a loop or a link out of the folder', async () => {
      const root = fs.mkdtempSync(`${os.tmpdir()}/uplink-`);
      const outside = fs.mkdtempSync(`${os.tmpdir()}/outside-`);
      fs.writeFileSync(`${outside}/secret.txt`, 'private');
      fs.mkdirSync(`${root}/Docs`);
      fs.writeFileSync(`${root}/Docs/ok.txt`, 'ok');
      fs.symlinkSync(outside, `${root}/Docs/escape`); // a folder link out of the tree
      fs.symlinkSync(`${root}/Docs`, `${root}/Docs/loop`); // a link back into it
      fs.symlinkSync(`${outside}/secret.txt`, `${root}/Docs/secret-link.txt`);
      registerIpcHandlers(win, makeClient() as never);
      await call(CH.FILES_UPLOAD, '/', [`${root}/Docs`]);
      const uploaded = uploadFile.mock.calls.map(x => x[2]);
      expect(uploaded).toEqual(['/Docs/ok.txt']);
      // A link chosen directly is refused with an error event, not followed.
      uploadFile.mockClear();
      send.mockClear();
      await call(CH.FILES_UPLOAD, '/', [`${root}/Docs/secret-link.txt`]);
      expect(uploadFile).not.toHaveBeenCalled();
      expect(send.mock.calls.some(x => x[1]?.status === 'error')).toBe(true);
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    });

    it('uploads a dropped folder recursively, creating remote folders first', async () => {
      const fs = await import('fs');
      const os = await import('os');
      const root = fs.mkdtempSync(`${os.tmpdir()}/updir-`);
      fs.mkdirSync(`${root}/Photos/2026`, { recursive: true });
      fs.writeFileSync(`${root}/Photos/a.jpg`, 'a');
      fs.writeFileSync(`${root}/Photos/2026/b.jpg`, 'b');
      fs.writeFileSync(`${root}/Photos/.hidden`, 'h');
      const c = makeClient();
      c.mkdir.mockRejectedValueOnce(new Error('409: exists')); // top folder already there
      registerIpcHandlers(win, c as never);
      await call(CH.FILES_UPLOAD, '/Docs', [`${root}/Photos`]);
      expect(c.mkdir.mock.calls.map(x => x[0])).toEqual(['/Docs/Photos', '/Docs/Photos/2026']);
      expect(uploadFile.mock.calls.map(x => x[2]).sort()).toEqual([
        '/Docs/Photos/2026/b.jpg',
        '/Docs/Photos/a.jpg',
      ]);
      fs.rmSync(root, { recursive: true, force: true });
    });

    it('cancelled file dialog uploads nothing', async () => {
      dialogMock.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
      registerIpcHandlers(win, makeClient() as never);
      await call(CH.FILES_UPLOAD, '/');
      expect(uploadFile).not.toHaveBeenCalled();
    });

    it('a failing upload is reported as an error event and does not stop the next file', async () => {
      uploadFile.mockRejectedValueOnce(new Error('409: exists')).mockResolvedValueOnce(undefined);
      registerIpcHandlers(win, makeClient() as never);
      await call(CH.FILES_UPLOAD, '/', [tmpFile('u1'), tmpFile('u2')]);
      const evs = send.mock.calls.map(x => x[1]);
      expect(evs.some(e => e.status === 'error' && e.error === '409: exists')).toBe(true);
      expect(uploadFile).toHaveBeenCalledTimes(2);
    });

    it('downloads into the folder chosen in the native dialog; cancel returns false', async () => {
      const c = makeClient();
      registerIpcHandlers(win, c as never);
      dialogMock.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
      expect(await call(CH.FILES_DOWNLOAD, ['/a.txt'])).toBe(false);
      expect(downloadFile).not.toHaveBeenCalled();

      const dest = process.env.TMPDIR ?? '/tmp';
      dialogMock.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [dest] });
      expect(await call(CH.FILES_DOWNLOAD, ['/a.txt'])).toBe(true);
      expect(downloadFile.mock.calls[0][1]).toBe('/a.txt');
      // The size and md5 the Disk reported go along, so the download is verified.
      expect(downloadFile.mock.calls[0][5]).toEqual({ size: 3, md5: 'abc123' });
      expect(downloadFile.mock.calls[0][2]).toBe(path.resolve(dest, 'a.txt'));
    });

    it('downloads a folder recursively keeping its structure', async () => {
      const c = makeClient();
      c.getMeta.mockImplementation(async (p: string) =>
        p === '/Dir' ? { type: 'dir' } : { type: 'file', size: 1 }
      );
      c.listFiles.mockResolvedValue({
        items: [
          { path: '/Dir/x.txt', name: 'x.txt' },
          { path: '/Dir/y.txt', name: 'y.txt' },
        ],
      });
      dialogMock.showOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: [process.env.TMPDIR ?? '/tmp'],
      });
      registerIpcHandlers(win, c as never);
      await call(CH.FILES_DOWNLOAD, ['/Dir']);
      const targets = downloadFile.mock.calls.map(x => String(x[2]).replace(/\\/g, '/'));
      expect(targets.some(t => t.endsWith('/Dir/x.txt'))).toBe(true);
      expect(targets.some(t => t.endsWith('/Dir/y.txt'))).toBe(true);
    });
  });

  describe('sync', () => {
    it('configure persists a single pair, resets the old one and starts the engine', async () => {
      const db = makeDb();
      const e = makeEngine();
      registerIpcHandlers(win, makeClient() as never, db as never, e as never);
      await call(CH.SYNC_CONFIGURE, dirIn('Sync'), '/Backup');
      await call(CH.SYNC_CONFIGURE, dirIn('Other'), '/Docs');
      expect(db.removePair).toHaveBeenCalledWith('p1');
      expect(db.clearSyncState).toHaveBeenCalledWith('p1');
      expect(e.configure).toHaveBeenLastCalledWith({
        id: 'p1',
        localPath: dirIn('Other'),
        remotePath: '/Docs',
      });
      expect(e.start).toHaveBeenCalledTimes(2);
      expect(await call(CH.SYNC_GET_CONFIG)).toEqual({
        localPath: dirIn('Other'),
        remotePath: '/Docs',
        enabled: true,
      });
    });

    it.each([
      ['a folder that does not exist', () => `${tmpRoot}/missing`, 'existing folder'],
      ['the home folder', () => os.homedir(), 'home folder'],
      ['the whole disk', () => path.parse(tmpRoot).root, 'whole disk'],
    ])('configure refuses %s and leaves the pairs alone', (_name, local, message) => {
      const db = makeDb();
      const e = makeEngine();
      registerIpcHandlers(win, makeClient() as never, db as never, e as never);
      expect(() => call(CH.SYNC_CONFIGURE, local(), '/R')).toThrow(message);
      expect(db.addSyncPair).not.toHaveBeenCalled();
      expect(e.start).not.toHaveBeenCalled();
    });

    it('configure refuses a folder overlapping the protected app data', () => {
      const db = makeDb();
      registerIpcHandlers(
        win,
        makeClient() as never,
        db as never,
        makeEngine() as never,
        undefined,
        [dirIn('Data')]
      );
      expect(() => call(CH.SYNC_CONFIGURE, dirIn('Data'), '/R')).toThrow('own data');
    });

    it('configure rejects a relative local path', () => {
      registerIpcHandlers(win, makeClient() as never, makeDb() as never, makeEngine() as never);
      expect(() => call(CH.SYNC_CONFIGURE, 'relative/dir', '/x')).toThrow();
    });

    it('pause persists the disabled flag; start without a pair explains why', async () => {
      const db = makeDb();
      const e = makeEngine();
      registerIpcHandlers(win, makeClient() as never, db as never, e as never);
      expect(() => call(CH.SYNC_START)).toThrow('Choose a sync folder');
      await call(CH.SYNC_CONFIGURE, dirIn('S'), '/R');
      await call(CH.SYNC_PAUSE);
      await call(CH.SYNC_START); // resumes what was paused
      expect(db.togglePairActive).toHaveBeenLastCalledWith('p1', true);
      await call(CH.SYNC_PAUSE);
      expect(db.togglePairActive).toHaveBeenCalledWith('p1', false);
      expect(e.stop).toHaveBeenCalled();
      expect((await call(CH.SYNC_GET_CONFIG)) as { enabled: boolean }).toMatchObject({
        enabled: false,
      });
    });

    it('status merges engine progress with the stored config', async () => {
      const db = makeDb();
      registerIpcHandlers(win, makeClient() as never, db as never, makeEngine() as never);
      expect(await call(CH.SYNC_STATUS)).toMatchObject({ configured: false, enabled: false });
      await call(CH.SYNC_CONFIGURE, dirIn('S'), '/R');
      expect(await call(CH.SYNC_STATUS)).toMatchObject({
        configured: true,
        enabled: true,
        doneFiles: 2,
        totalFiles: 5,
        lastSync: '2026-01-02T00:00:00Z',
      });
    });

    it('forwards engine progress to the window and syncNow triggers a run', async () => {
      const e = makeEngine();
      registerIpcHandlers(win, makeClient() as never, makeDb() as never, e as never);
      e.emit({ phase: 'syncing' });
      expect(send).toHaveBeenCalledWith(EVENTS.SYNC_PROGRESS, { phase: 'syncing' });
      await call(CH.SYNC_NOW);
      expect(e.syncNow).toHaveBeenCalledWith({ immediate: true });
    });
  });

  it('dialog:selectFolder returns the chosen path or null', async () => {
    registerIpcHandlers(win, makeClient() as never);
    dialogMock.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/x'] });
    expect(await call(CH.DIALOG_SELECT_FOLDER, 'Pick')).toBe('/x');
    dialogMock.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(await call(CH.DIALOG_SELECT_FOLDER)).toBeNull();
  });

  it('system:openExternal only accepts valid URLs', async () => {
    registerIpcHandlers(win, makeClient() as never);
    await call(CH.SYSTEM_OPEN_EXTERNAL, 'https://yadi.sk/d/1');
    expect(shellMock.openExternal).toHaveBeenCalledWith('https://yadi.sk/d/1');
    await expect(call(CH.SYSTEM_OPEN_EXTERNAL, 'file:///etc/passwd')).rejects.toThrow();
  });

  describe('edge cases', () => {
    it('a token that cannot be verified because of a non-auth error says why', async () => {
      const c = makeClient();
      c.getDiskInfo.mockRejectedValue(new Error('503: down'));
      registerIpcHandlers(win, c as never);
      await expect(call(CH.AUTH_SET_TOKEN, 't')).rejects.toThrow(
        'Could not verify token: 503: down'
      );
      c.getDiskInfo.mockRejectedValue('weird');
      await expect(call(CH.AUTH_SET_TOKEN, 't')).rejects.toThrow('Could not verify token: weird');
    });

    it('sync:getConfig is null without a pair; sync:start explains what is missing', async () => {
      registerIpcHandlers(win, makeClient() as never, makeDb() as never, makeEngine() as never);
      expect(await call(CH.SYNC_GET_CONFIG)).toBeNull();
      expect(() => call(CH.SYNC_START)).toThrow('Choose a sync folder first');
      registerIpcHandlers(win, makeClient() as never);
      expect(() => call(CH.SYNC_START)).toThrow('Choose a sync folder first');
    });

    it('an unreadable dropped folder is reported as a failed upload, the next item still goes', async () => {
      registerIpcHandlers(win, makeClient() as never);
      await call(CH.FILES_UPLOAD, '/', [`${tmpRoot}/does-not-exist`, tmpFile('after.txt')]);
      const evs = send.mock.calls.map(x => x[1]);
      expect(evs.some(e => e?.status === 'error')).toBe(true);
      expect(uploadFile).toHaveBeenCalledTimes(1);
    });

    it('a folder that cannot be listed on the Disk is reported as a failed download', async () => {
      const c = makeClient();
      c.getMeta.mockRejectedValue(new Error('404: gone'));
      dialogMock.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [tmpRoot] });
      registerIpcHandlers(win, c as never);
      await call(CH.FILES_DOWNLOAD, ['/Gone']);
      expect(send.mock.calls.map(x => x[1]).some(e => e?.status === 'error')).toBe(true);
    });

    it('show-in-folder opens only the sync folder, the app data folder and what is inside them', async () => {
      const sync = dirIn('show');
      const db = makeDb();
      db.addSyncPair(sync, '/');
      registerIpcHandlers(win, makeClient() as never, db as never, undefined, undefined, [
        '/var/app-data',
      ]);
      await call(CH.SYSTEM_SHOW_IN_FOLDER, sync);
      await call(CH.SYSTEM_SHOW_IN_FOLDER, `${sync}/docs/a.txt`);
      await call(CH.SYSTEM_SHOW_IN_FOLDER, '/var/app-data/logs/diya.log');
      expect(shellMock.showItemInFolder.mock.calls.map(c => c[0])).toEqual([
        sync,
        `${sync}/docs/a.txt`,
        '/var/app-data/logs/diya.log',
      ]);
      shellMock.showItemInFolder.mockClear();
      expect(() => call(CH.SYSTEM_SHOW_IN_FOLDER, '/etc/passwd')).toThrow(/sync folder/);
      expect(() => call(CH.SYSTEM_SHOW_IN_FOLDER, `${sync}-other/a.txt`)).toThrow(/sync folder/);
      expect(() => call(CH.SYSTEM_SHOW_IN_FOLDER, `${sync}/../x`)).toThrow();
      expect(() => call(CH.SYSTEM_SHOW_IN_FOLDER, 'relative/path')).toThrow();
      expect(shellMock.showItemInFolder).not.toHaveBeenCalled();
    });

    it('show-in-folder refuses everything when no folder is configured', () => {
      registerIpcHandlers(win, makeClient() as never);
      expect(() => call(CH.SYSTEM_SHOW_IN_FOLDER, '/home/u/file.txt')).toThrow(/sync folder/);
      expect(shellMock.showItemInFolder).not.toHaveBeenCalled();
    });

    it('opens an allowed external link and refuses others', async () => {
      registerIpcHandlers(win, makeClient() as never);
      await call(CH.SYSTEM_OPEN_EXTERNAL, 'https://oauth.yandex.com/device');
      expect(shellMock.openExternal).toHaveBeenCalledWith('https://oauth.yandex.com/device');
      await expect(call(CH.SYSTEM_OPEN_EXTERNAL, 'https://evil.example/')).rejects.toThrow();
    });
  });
});
