import { afterEach, describe, expect, it, vi } from 'vitest';

const locale = vi.hoisted(() => ({ value: 'ru-RU' as string | Error }));
vi.mock('electron', () => ({
  app: {
    getLocale: () => {
      if (locale.value instanceof Error) throw locale.value;
      return locale.value;
    },
  },
}));

import { menuStrings } from '../../src/main/menu-strings.js';
import { createQuitGuard } from '../../src/main/quit-guard.js';
import { SyncDB } from '../../src/main/sync-db.js';
import { createWindowHolder } from '../../src/main/window-holder.js';

describe('menuStrings', () => {
  it('follows the system language, falling back to English', () => {
    locale.value = 'ru-RU';
    expect(menuStrings().settings).toBe('Настройки…');
    locale.value = 'de-DE';
    expect(menuStrings().settings).toBe('Settings…');
    locale.value = new Error('app not ready');
    expect(menuStrings().settings).toBe('Settings…');
    expect(menuStrings('RU').quit).toBe('Завершить');
  });

  it('the quit hint names the key in both languages', () => {
    expect(menuStrings('ru').quitHint('⌘Q')).toContain('⌘Q');
    expect(menuStrings('en').quitHint('Ctrl+Q')).toBe('Press Ctrl+Q again to quit');
  });
});

describe('quit guard defaults', () => {
  afterEach(() => vi.useRealTimers());
  it('uses the real clock and a 3 s window when none is given', () => {
    vi.useFakeTimers();
    const hint = vi.fn();
    const guard = createQuitGuard({ showHint: hint });
    expect(guard.shouldQuit()).toBe(false);
    vi.advanceTimersByTime(2900);
    expect(guard.shouldQuit()).toBe(true);
    const late = createQuitGuard({ showHint: hint });
    late.shouldQuit();
    vi.advanceTimersByTime(3100);
    expect(late.shouldQuit()).toBe(false);
  });
});

describe('window holder without a window', () => {
  it('send is dropped when the window was never created', () => {
    const holder = createWindowHolder({
      create: () => {
        throw new Error('unused');
      },
    } as never);
    expect(() => holder.send('x')).not.toThrow();
    expect(holder.get()).toBeNull();
  });
});

describe('SyncDB state helpers', () => {
  it('removes one state row and clears all rows of a pair', () => {
    const db = new SyncDB(':memory:');
    const id = db.addSyncPair('/l', '/r');
    const row = (relPath: string) => ({
      relPath,
      isDir: false,
      localSize: 1,
      localMtimeMs: 1,
      remoteSize: 1,
      remoteModified: 'm',
    });
    db.setSyncState(id, row('a'));
    db.setSyncState(id, row('b'));
    db.setSyncState(id, { ...row('d'), isDir: true });
    expect([...db.getSyncStates(id).keys()].sort()).toEqual(['a', 'b', 'd']);
    expect(db.getSyncStates(id).get('d')!.isDir).toBe(true);
    db.removeSyncState(id, 'a');
    expect([...db.getSyncStates(id).keys()].sort()).toEqual(['b', 'd']);
    db.clearSyncState(id);
    expect(db.getSyncStates(id).size).toBe(0);
    db.close();
  });
});
