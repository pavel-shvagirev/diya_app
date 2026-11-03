import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agoText } from '../../src/renderer/lib/ago.js';
import { dictionaries, t } from '../../src/renderer/lib/strings.js';
import { useDialogStore, dialogs } from '../../src/renderer/store/dialogStore.js';
import { useErrorStore } from '../../src/renderer/store/errorStore.js';
import { useSyncStore } from '../../src/renderer/store/syncStore.js';
import { initTheme, useThemeStore } from '../../src/renderer/store/themeStore.js';
import { useTransferStore } from '../../src/renderer/store/transferStore.js';
import { MAX_TREE, MIN_TREE, useUiStore } from '../../src/renderer/store/uiStore.js';
import { installApi } from './helpers.js';

describe('strings', () => {
  it('Russian and English have exactly the same keys', () => {
    expect(Object.keys(dictionaries.ru).sort()).toEqual(Object.keys(dictionaries.en).sort());
  });

  it('every text function works in both languages and every plain string is non-empty', () => {
    for (const dict of [dictionaries.ru, dictionaries.en] as Array<Record<string, unknown>>) {
      for (const [key, value] of Object.entries(dict)) {
        if (typeof value === 'function') {
          for (const args of [
            [0, 0, 0],
            [1, 1, 1],
            [3, 2, 1],
            [5, 11, 21],
            ['a', 'b', 'c'],
          ]) {
            const out = (value as (...a: unknown[]) => unknown)(...args);
            expect(out, key).not.toBeUndefined();
          }
        } else if (typeof value === 'string') {
          expect(value.length, key).toBeGreaterThan(0);
        }
      }
    }
  });

  it('plural forms follow the Russian rules', () => {
    const ru = dictionaries.ru as unknown as { confirmDelete: (n: number, name: string) => string };
    const forms = [1, 2, 5, 11, 21, 22, 25, 111].map(n => ru.confirmDelete(n, 'f'));
    expect(new Set(forms).size).toBeGreaterThan(1);
  });

  it('the default dictionary follows the test environment language (English)', () => {
    expect(t.signOut).toBe('Sign out');
  });

  it('authClientIdFrom names every source and passes unknown ones through', () => {
    for (const dict of [dictionaries.ru, dictionaries.en]) {
      for (const s of ['custom', 'env', 'none']) expect(dict.authClientIdFrom(s)).not.toBe(s);
      expect(dict.authClientIdFrom('other')).toBe('other');
    }
  });
});

describe('agoText', () => {
  const now = Date.UTC(2026, 0, 10, 12, 0, 0);
  const at = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  it('picks minutes, hours or days; garbage and the future read as "just now"', () => {
    expect(agoText(at(0), now)).toBe(t.justNow);
    expect(agoText(at(5), now)).toBe(t.minAgo(5));
    expect(agoText(at(180), now)).toBe(t.hoursAgo(3));
    expect(agoText(at(60 * 24 * 3), now)).toBe(t.daysAgo(3));
    expect(agoText('not a date', now)).toBe(t.justNow);
    expect(agoText(at(-10), now)).toBe(t.justNow);
    expect(typeof agoText(at(1))).toBe('string');
  });
});

describe('error store', () => {
  beforeEach(() => useErrorStore.getState().clearErrors());
  it('adds, dismisses and clears; ids are unique', () => {
    const s = useErrorStore.getState();
    s.addError('a');
    s.addError('b', false);
    const [a, b] = useErrorStore.getState().errors;
    expect(a!.id).not.toBe(b!.id);
    expect(b!.dismissible).toBe(false);
    useErrorStore.getState().dismissError(a!.id);
    expect(useErrorStore.getState().errors.map(e => e.message)).toEqual(['b']);
    useErrorStore.getState().clearErrors();
    expect(useErrorStore.getState().errors).toEqual([]);
  });
});

describe('transfer store', () => {
  const ev = (id: string, status: string, done = 0) =>
    ({ id, name: id, direction: 'upload', status, done, total: 10 }) as never;
  beforeEach(() => useTransferStore.setState({ transfers: [] }));

  it('adds new transfers, updates existing ones, and clears finished ones', () => {
    const s = useTransferStore.getState();
    s.apply(ev('a', 'active', 1));
    s.apply(ev('b', 'active'));
    s.apply(ev('a', 'done', 10));
    expect(useTransferStore.getState().transfers.map(t => [t.id, t.status])).toEqual([
      ['a', 'done'],
      ['b', 'active'],
    ]);
    useTransferStore.getState().clearFinished();
    expect(useTransferStore.getState().transfers.map(t => t.id)).toEqual(['b']);
  });

  it('keeps only the last 50', () => {
    for (let i = 0; i < 60; i++) useTransferStore.getState().apply(ev(`t${i}`, 'done'));
    const list = useTransferStore.getState().transfers;
    expect(list).toHaveLength(50);
    expect(list[0]!.id).toBe('t10');
  });
});

describe('ui store', () => {
  it('opens and closes settings; the tree width is clamped and rounded', () => {
    useUiStore.getState().openSettings();
    expect(useUiStore.getState().settingsOpen).toBe(true);
    useUiStore.getState().closeSettings();
    expect(useUiStore.getState().settingsOpen).toBe(false);
    useUiStore.getState().setTreeWidth(10);
    expect(useUiStore.getState().treeWidth).toBe(MIN_TREE);
    useUiStore.getState().setTreeWidth(9999);
    expect(useUiStore.getState().treeWidth).toBe(MAX_TREE);
    useUiStore.getState().setTreeWidth(300.6);
    expect(useUiStore.getState().treeWidth).toBe(301);
  });
});

describe('dialog store', () => {
  beforeEach(() => useDialogStore.setState({ current: null }));
  it('every dialog helper shows its kind and resolves with the answer', async () => {
    const p1 = dialogs.prompt({ title: 't', label: 'l', initial: '', submit: 's' });
    expect(useDialogStore.getState().current?.kind).toBe('prompt');
    (useDialogStore.getState().current as { resolve: (v: string) => void }).resolve('x');
    expect(await p1).toBe('x');
    const p2 = dialogs.confirm({ title: 't', message: 'm', danger: false, submit: 's' });
    (useDialogStore.getState().current as { resolve: (v: boolean) => void }).resolve(true);
    expect(await p2).toBe(true);
    const p3 = dialogs.pickFolder({ title: 't', submit: 's', initial: '/' });
    expect(useDialogStore.getState().current?.kind).toBe('folder');
    (useDialogStore.getState().current as { resolve: (v: string | null) => void }).resolve(null);
    expect(await p3).toBeNull();
    const p4 = dialogs.share({ path: '/a', url: 'https://yadi.sk/d/1' });
    expect(useDialogStore.getState().current?.kind).toBe('share');
    (useDialogStore.getState().current as { resolve: (v: 'unshare') => void }).resolve('unshare');
    expect(await p4).toBe('unshare');
    useDialogStore.getState().close();
    expect(useDialogStore.getState().current).toBeNull();
  });
});

describe('sync store', () => {
  let api: ReturnType<typeof installApi>;
  const status = {
    phase: 'idle',
    totalFiles: 0,
    doneFiles: 0,
    totalBytes: 0,
    doneBytes: 0,
    current: null,
    lastSync: null,
    error: null,
    failures: [],
    conflicts: 0,
  };
  beforeEach(() => {
    api = installApi();
    api.getSyncStatus.mockResolvedValue(status);
    useErrorStore.getState().clearErrors();
  });

  it('refresh loads config and status; applyProgress replaces the progress', async () => {
    api.getSyncConfig.mockResolvedValue({ localPath: '/l', remotePath: '/r', enabled: true });
    await useSyncStore.getState().refresh();
    expect(useSyncStore.getState().config?.localPath).toBe('/l');
    expect(useSyncStore.getState().loaded).toBe(true);
    useSyncStore.getState().applyProgress({ ...status, phase: 'syncing' } as never);
    expect(useSyncStore.getState().progress.phase).toBe('syncing');
  });

  it('configure, start/pause and syncNow call the API; failures become error toasts', async () => {
    await useSyncStore.getState().configure('/l', '/r');
    expect(api.configureSync).toHaveBeenCalledWith('/l', '/r');
    await useSyncStore.getState().setEnabled(true);
    await useSyncStore.getState().setEnabled(false);
    expect(api.startSync).toHaveBeenCalled();
    expect(api.pauseSync).toHaveBeenCalled();
    await useSyncStore.getState().syncNow();
    expect(api.syncNow).toHaveBeenCalled();

    api.configureSync.mockRejectedValue(new Error('bad folder'));
    api.startSync.mockRejectedValue('plain');
    api.syncNow.mockRejectedValue(new Error('offline'));
    api.getSyncConfig.mockRejectedValue(new Error('ipc'));
    await useSyncStore.getState().configure('/x', '/y');
    await useSyncStore.getState().setEnabled(true);
    await useSyncStore.getState().syncNow();
    expect(useErrorStore.getState().errors.map(e => e.message)).toEqual(
      expect.arrayContaining(['bad folder', 'plain', 'offline', 'ipc'])
    );
  });
});

describe('theme store', () => {
  const media = (dark: boolean) => {
    const listeners: Array<() => void> = [];
    window.matchMedia = vi.fn(() => ({
      matches: dark,
      addEventListener: (_: string, cb: () => void) => listeners.push(cb),
    })) as never;
    return listeners;
  };
  let store: Record<string, string>;
  const storage = {
    getItem: vi.fn((k: string) => store[k] ?? null),
    setItem: vi.fn((k: string, v: string) => void (store[k] = v)),
  };
  beforeEach(() => {
    store = {};
    storage.getItem.mockImplementation((k: string) => store[k] ?? null);
    storage.setItem.mockImplementation((k: string, v: string) => void (store[k] = v));
    vi.stubGlobal('localStorage', storage);
    document.documentElement.removeAttribute('data-theme');
    useThemeStore.setState({ mode: 'system', _explicitTheme: false, theme: 'light' });
  });

  it('setMode pins or releases the theme and remembers the choice', () => {
    media(true);
    useThemeStore.getState().setMode('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(store['theme-mode']).toBe('dark');
    useThemeStore.getState().setMode('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(useThemeStore.getState().theme).toBe('dark');
  });

  it('setTheme, toggleTheme and system detection', () => {
    media(false);
    useThemeStore.getState().setTheme('dark');
    expect(useThemeStore.getState()._explicitTheme).toBe(true);
    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe('light');
    useThemeStore.setState({ _explicitTheme: false });
    media(true);
    useThemeStore.getState().detectSystemTheme();
    expect(useThemeStore.getState().theme).toBe('dark');
    useThemeStore.setState({ _explicitTheme: true, theme: 'light' });
    useThemeStore.getState().detectSystemTheme();
    expect(useThemeStore.getState().theme).toBe('light');
  });

  it('initTheme restores a saved mode, follows OS changes, and survives broken storage', () => {
    const listeners = media(true);
    store['theme-mode'] = 'light';
    initTheme();
    expect(useThemeStore.getState().mode).toBe('light');
    listeners.forEach(l => l());
    storage.getItem.mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => initTheme()).not.toThrow();
    storage.setItem.mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => useThemeStore.getState().setMode('dark')).not.toThrow();
    window.matchMedia = undefined as never;
    expect(() => initTheme()).not.toThrow();
  });

  it('without matchMedia the store falls back to light', () => {
    window.matchMedia = undefined as never;
    useThemeStore.getState().detectSystemTheme();
    expect(useThemeStore.getState().isSystemDark).toBe(false);
  });
});

describe('interface language detection', () => {
  const load = async () => {
    vi.resetModules();
    return (await import('../../src/renderer/lib/strings.js')).lang;
  };
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('the ?lang= query from the main process decides', async () => {
    window.history.replaceState(null, '', '/?lang=ru');
    expect(await load()).toBe('ru');
    window.history.replaceState(null, '', '/?lang=en');
    expect(await load()).toBe('en');
  });

  it('without a valid query the browser language decides', async () => {
    window.history.replaceState(null, '', '/?lang=de');
    expect(await load()).toBe('en');
    const spy = vi.spyOn(navigator, 'language', 'get').mockReturnValue('ru-RU');
    window.history.replaceState(null, '', '/');
    expect(await load()).toBe('ru');
    spy.mockRestore();
  });
});
