import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CH, EVENTS } from '../../src/shared/channels.js';

const invoke = vi.fn().mockResolvedValue('result');
const on = vi.fn();
const removeListener = vi.fn();
let api: Record<string, (...a: unknown[]) => unknown> = {};

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_k: string, a: typeof api) => {
      api = a;
    },
  },
  webUtils: { getPathForFile: (f: { path: string }) => `native:${f.path}` },
  ipcRenderer: { invoke, on, removeListener },
}));

const CHANNELS = new Set<string>(Object.values(CH));
const EVENT_NAMES = new Set<string>(Object.values(EVENTS));

describe('every window.api method', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    await import('../../src/preload/preload.js');
  });

  it('request methods call exactly one known IPC channel and return its response', async () => {
    const names = Object.keys(api).filter(n => !n.startsWith('on') && n !== 'pathForFile');
    expect(names.length).toBeGreaterThan(30);
    for (const name of names) {
      invoke.mockClear();
      expect(await api[name]!('a', 'b', 'c')).toBe('result');
      expect(invoke, name).toHaveBeenCalledTimes(1);
      expect(CHANNELS.has(invoke.mock.calls[0]![0] as string), `${name} → unknown channel`).toBe(
        true
      );
    }
  });

  it('push methods subscribe to a known event, pass the payload on, and unsubscribe', () => {
    const names = Object.keys(api).filter(n => n.startsWith('on'));
    expect(names.length).toBeGreaterThan(5);
    for (const name of names) {
      on.mockClear();
      removeListener.mockClear();
      const received: unknown[] = [];
      const off = api[name]!((p: unknown) => received.push(p)) as () => void;
      const [event, listener] = on.mock.calls[0] as [string, (e: unknown, p: unknown) => void];
      expect(EVENT_NAMES.has(event), `${name} → unknown event`).toBe(true);
      listener({}, 'payload');
      expect(received).toEqual(['payload']);
      off();
      expect(removeListener).toHaveBeenCalledWith(event, listener);
    }
  });

  it('pathForFile asks Electron for the real path of a dropped file', () => {
    expect(api.pathForFile!({ path: '/x' } as never)).toBe('native:/x');
  });
});
