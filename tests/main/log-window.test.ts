import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...a: unknown[]) => unknown>(),
  wins: [] as Array<Record<string, unknown>>,
  showItemInFolder: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (c: string, f: (...a: unknown[]) => unknown) => h.handlers.set(c, f) },
  shell: { showItemInFolder: h.showItemInFolder },
}));
vi.mock('../../src/main/security.js', async () => ({
  ...(await vi.importActual<object>('../../src/main/security.js')),
  createSecureWindow: (options: Record<string, unknown>) => {
    const listeners: Record<string, () => void> = {};
    const win = {
      options,
      destroyed: false,
      minimized: false,
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      loadFile: vi.fn(),
      loadURL: vi.fn(),
      isDestroyed: () => win.destroyed,
      isMinimized: () => win.minimized,
      on: (ev: string, cb: () => void) => (listeners[ev] = cb),
      emit: (ev: string) => listeners[ev]?.(),
      webContents: { send: vi.fn() },
    };
    h.wins.push(win);
    return win;
  },
}));

import { openLogWindow, registerLogIpc } from '../../src/main/log-window.js';
import { logger } from '../../src/main/logger.js';
import { CH, EVENTS } from '../../src/shared/channels.js';

const call = (c: string, ...a: unknown[]) =>
  h.handlers.get(c)!({ senderFrame: { url: 'file:///app/dist/renderer/index.html' } }, ...a);

describe('log window IPC: untrusted senders', () => {
  it('refuses every channel when the message does not come from our own page', () => {
    registerLogIpc();
    for (const c of [CH.LOG_GET, CH.LOG_CLEAR, CH.LOG_SET_LEVEL, CH.LOG_REVEAL]) {
      expect(() => h.handlers.get(c)!({ senderFrame: { url: 'https://evil.example/' } })).toThrow(
        'Untrusted IPC sender'
      );
      expect(() => h.handlers.get(c)!({})).toThrow('Untrusted IPC sender');
    }
  });
});

describe('log window IPC', () => {
  beforeEach(() => {
    h.handlers.clear();
    logger.clear();
    logger.setRecordLevel('debug');
    registerLogIpc();
  });

  it('returns the entries, the recording level and the file', () => {
    logger.info('app', 'hello');
    const r = call(CH.LOG_GET) as { entries: Array<{ msg: string }>; recordLevel: string };
    expect(r.entries.map(e => e.msg)).toContain('hello');
    expect(r.recordLevel).toBe('debug');
  });

  it('clears and changes the level; an unknown level is rejected', () => {
    logger.info('app', 'x');
    call(CH.LOG_CLEAR);
    expect(logger.getEntries()).toHaveLength(0);
    call(CH.LOG_SET_LEVEL, 'trace');
    expect(logger.getRecordLevel()).toBe('trace');
    expect(() => call(CH.LOG_SET_LEVEL, 'loud')).toThrow('Unknown log level');
  });

  it('turning trace on leaves a warning in the log itself, so a shared file carries it', () => {
    logger.setRecordLevel('debug');
    call(CH.LOG_SET_LEVEL, 'trace');
    const warn = logger.getEntries().find(e => e.level === 'warn' && /trace/.test(e.msg));
    expect(warn?.msg).toMatch(/do not share/i);
    call(CH.LOG_SET_LEVEL, 'debug');
    expect(logger.getEntries().filter(e => e.level === 'warn' && /trace/.test(e.msg))).toHaveLength(
      1
    );
  });

  it('reveal opens the file manager only when a file exists', () => {
    call(CH.LOG_REVEAL);
    const file = logger.getFilePath();
    expect(h.showItemInFolder).toHaveBeenCalledTimes(file ? 1 : 0);
  });
});

describe('openLogWindow', () => {
  beforeEach(() => {
    for (const w of h.wins) (w as { emit: (e: string) => void }).emit('closed');
    h.wins.length = 0;
    delete process.env.VITE_DEV_SERVER_URL;
  });

  it('creates one window and streams new entries to it until it is closed', () => {
    openLogWindow();
    const w = h.wins[0] as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(w.loadFile).toHaveBeenCalledWith(expect.stringContaining('log.html'), {
      query: { lang: expect.stringMatching(/^(ru|en)$/) },
    });
    logger.info('app', 'streamed');
    expect(w.webContents.send).toHaveBeenCalledWith(
      EVENTS.LOG_ENTRY,
      expect.objectContaining({ msg: 'streamed' })
    );
    w.emit('closed');
    w.webContents.send.mockClear();
    logger.info('app', 'after close');
    expect(w.webContents.send).not.toHaveBeenCalled();
  });

  it('a second call focuses the open window (restoring it if minimized)', () => {
    openLogWindow();
    const w = h.wins[0] as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    w.minimized = true;
    openLogWindow();
    expect(h.wins).toHaveLength(1);
    expect(w.restore).toHaveBeenCalled();
    expect(w.show).toHaveBeenCalled();
    w.emit('closed');
  });

  it('opens a closed window again, and uses the dev server in development', () => {
    openLogWindow();
    (h.wins[0] as any).emit('closed'); // eslint-disable-line @typescript-eslint/no-explicit-any
    process.env.VITE_DEV_SERVER_URL = 'http://localhost:5173';
    openLogWindow();
    expect(h.wins).toHaveLength(2);
    expect((h.wins[1] as any).loadURL).toHaveBeenCalledWith(
      expect.stringMatching(/^http:\/\/localhost:5173\/log\.html\?lang=(ru|en)$/)
    ); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it('does not send to a destroyed window', () => {
    openLogWindow();
    const w = h.wins.at(-1) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    w.destroyed = true;
    logger.info('app', 'ghost');
    expect(w.webContents.send).not.toHaveBeenCalled();
  });
});
