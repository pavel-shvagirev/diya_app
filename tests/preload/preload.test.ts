import { beforeEach, describe, it, expect, vi } from 'vitest';

// Mock electron's contextBridge and ipcRenderer
const mockInvoke = vi.fn();
const mockExposeInMainWorld = vi.fn();
const mockOn = vi.fn();
const mockOff = vi.fn();

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, api: unknown) => {
      mockExposeInMainWorld(key, api);
    },
  },
  webUtils: { getPathForFile: (f: { path: string }) => f.path },
  ipcRenderer: {
    on: (...a: unknown[]) => mockOn(...a),
    removeListener: (...a: unknown[]) => mockOff(...a),
    invoke: (channel: string, ...args: unknown[]) => {
      mockInvoke(channel, ...args);
      return Promise.resolve({});
    },
  },
}));

describe('preload', () => {
  // Mock calls are cleared between tests, so every test loads the module afresh.
  beforeEach(() => {
    vi.resetModules();
  });

  it('exposes window.api with all expected methods', async () => {
    // Force reload the module
    await import('../../src/preload/preload.js');

    expect(mockExposeInMainWorld).toHaveBeenCalledWith(
      'api',
      expect.objectContaining({
        authLogin: expect.any(Function),
        authLoginCancel: expect.any(Function),
        authConfig: expect.any(Function),
        authSetClientId: expect.any(Function),
        onAuthLoginFailed: expect.any(Function),
        authLogout: expect.any(Function),
        authStatus: expect.any(Function),
        getDiskInfo: expect.any(Function),
        listFiles: expect.any(Function),
        uploadFiles: expect.any(Function),
        downloadFiles: expect.any(Function),
        selectFolder: expect.any(Function),
        getSyncConfig: expect.any(Function),
        syncNow: expect.any(Function),
        onSyncProgress: expect.any(Function),
        onTransferProgress: expect.any(Function),
        pathForFile: expect.any(Function),
        deleteFromTrash: expect.any(Function),
        showInFolder: expect.any(Function),
        deleteFile: expect.any(Function),
        copyFile: expect.any(Function),
        moveFile: expect.any(Function),
        mkdir: expect.any(Function),
        publish: expect.any(Function),
        unpublish: expect.any(Function),
        getQuota: expect.any(Function),
        getTrashList: expect.any(Function),
        restoreFromTrash: expect.any(Function),
        emptyTrash: expect.any(Function),
        configureSync: expect.any(Function),
        startSync: expect.any(Function),
        pauseSync: expect.any(Function),
        getSyncStatus: expect.any(Function),
        showWindow: expect.any(Function),
        quit: expect.any(Function),
        openExternal: expect.any(Function),
      })
    );

    const callCount = mockExposeInMainWorld.mock.calls.length;
    expect(callCount).toBe(1);
  });

  it('listFiles invokes the correct channel', async () => {
    await import('../../src/preload/preload.js');

    const api = mockExposeInMainWorld.mock.calls[0][1] as Record<string, unknown>;
    await (api.listFiles as Function)('/Folder');

    expect(mockInvoke).toHaveBeenCalledWith('files:list', '/Folder');
  });

  it('uploadFiles invokes with the folder and optional paths', async () => {
    await import('../../src/preload/preload.js');

    const api = mockExposeInMainWorld.mock.calls[0][1] as Record<string, unknown>;
    await (api.uploadFiles as Function)('/Docs', ['/local/a.txt']);

    expect(mockInvoke).toHaveBeenCalledWith('files:upload', '/Docs', ['/local/a.txt']);
  });

  it('push-event subscriptions can be cancelled', async () => {
    await import('../../src/preload/preload.js');

    const api = mockExposeInMainWorld.mock.calls[0][1] as Record<string, unknown>;
    const off = (api.onSyncProgress as Function)(() => {});
    expect(mockOn).toHaveBeenCalledWith('sync:progress', expect.any(Function));
    off();
    expect(mockOff).toHaveBeenCalledWith('sync:progress', mockOn.mock.calls[0][1]);
  });

  it('deleteFile invokes with permanent flag', async () => {
    await import('../../src/preload/preload.js');

    const api = mockExposeInMainWorld.mock.calls[0][1] as Record<string, unknown>;
    await (api.deleteFile as Function)('/path', true);

    expect(mockInvoke).toHaveBeenCalledWith('files:delete', '/path', true);
  });

  it('openExternal validates and invokes system channel', async () => {
    await import('../../src/preload/preload.js');

    const api = mockExposeInMainWorld.mock.calls[0][1] as Record<string, unknown>;
    await (api.openExternal as Function)('https://example.com');

    expect(mockInvoke).toHaveBeenCalledWith('system:openExternal', 'https://example.com');
  });
});
