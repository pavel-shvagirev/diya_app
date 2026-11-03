import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...a: unknown[]) => unknown>(),
  locale: { value: 'ru-RU' as string | Error },
}));

vi.mock('electron', () => ({
  app: {
    getLocale: () => {
      if (h.locale.value instanceof Error) throw h.locale.value;
      return h.locale.value;
    },
  },
  ipcMain: {
    removeHandler: (c: string) => h.handlers.delete(c),
    handle: (c: string, fn: (...a: unknown[]) => unknown) => h.handlers.set(c, fn),
  },
}));

import {
  effectiveLanguage,
  getLanguagePref,
  loadRenderer,
  registerLanguageIpc,
  setLanguagePref,
} from '../../src/main/language.js';
import { menuStrings } from '../../src/main/menu-strings.js';
import { CH } from '../../src/shared/channels.js';

const call = (c: string, ...a: unknown[]) =>
  h.handlers.get(c)!({ senderFrame: { url: 'file:///app/dist/renderer/index.html' } }, ...a);

beforeEach(() => {
  h.handlers.clear();
  h.locale.value = 'ru-RU';
  delete process.env.VITE_DEV_SERVER_URL;
  setLanguagePref('system');
});

describe('effective language', () => {
  it('follows the system until a language is chosen, and the menus follow it', () => {
    expect(effectiveLanguage()).toBe('ru');
    expect(menuStrings().settings).toBe('Настройки…');
    setLanguagePref('en');
    expect(effectiveLanguage()).toBe('en');
    expect(menuStrings().settings).toBe('Settings…');
    h.locale.value = 'en-US';
    setLanguagePref('ru');
    expect(menuStrings().settings).toBe('Настройки…');
  });

  it('falls back to English when the system locale is unavailable', () => {
    h.locale.value = new Error('not ready');
    expect(effectiveLanguage()).toBe('en');
  });
});

describe('language IPC', () => {
  it('reads and saves the choice, then lets the app re-apply it', () => {
    let stored: string = 'system';
    const onChange = vi.fn();
    registerLanguageIpc({ get: () => 'system', set: p => (stored = p) }, onChange);
    expect(call(CH.LANGUAGE_GET)).toBe('system');
    call(CH.LANGUAGE_SET, 'en');
    expect(stored).toBe('en');
    expect(getLanguagePref()).toBe('en');
    expect(call(CH.LANGUAGE_GET)).toBe('en');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown language and changes nothing', () => {
    const onChange = vi.fn();
    registerLanguageIpc({ get: () => 'system', set: vi.fn() }, onChange);
    expect(() => call(CH.LANGUAGE_SET, 'de')).toThrow('Unknown language');
    expect(getLanguagePref()).toBe('system');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('can be registered twice (the window is re-created)', () => {
    expect(() => {
      registerLanguageIpc({ get: () => 'system', set: vi.fn() }, vi.fn());
      registerLanguageIpc({ get: () => 'system', set: vi.fn() }, vi.fn());
    }).not.toThrow();
  });
});

describe('language IPC: untrusted senders', () => {
  it('refuses both channels from a foreign frame and changes nothing', () => {
    const onChange = vi.fn();
    registerLanguageIpc({ get: () => 'system', set: vi.fn() }, onChange);
    const foreign = { senderFrame: { url: 'https://evil.example/' } };
    expect(() => h.handlers.get(CH.LANGUAGE_GET)!(foreign)).toThrow('Untrusted IPC sender');
    expect(() => h.handlers.get(CH.LANGUAGE_SET)!(foreign, 'en')).toThrow('Untrusted IPC sender');
    expect(getLanguagePref()).toBe('system');
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('loadRenderer', () => {
  const win = () => ({
    loadURL: vi.fn().mockResolvedValue(undefined),
    loadFile: vi.fn().mockResolvedValue(undefined),
  });

  it('loads the built page with the language in the query', () => {
    const w = win();
    loadRenderer(w, 'index.html', '/app/dist/renderer');
    expect(w.loadFile).toHaveBeenCalledWith('/app/dist/renderer/index.html', {
      query: { lang: 'ru' },
    });
    setLanguagePref('en');
    loadRenderer(w, 'log.html', '/app/dist/renderer');
    expect(w.loadFile).toHaveBeenLastCalledWith('/app/dist/renderer/log.html', {
      query: { lang: 'en' },
    });
  });

  it('uses the dev server when there is one', () => {
    process.env.VITE_DEV_SERVER_URL = 'http://localhost:5173';
    const w = win();
    loadRenderer(w, 'index.html', '/x');
    expect(w.loadURL).toHaveBeenCalledWith('http://localhost:5173/?lang=ru');
    loadRenderer(w, 'log.html', '/x');
    expect(w.loadURL).toHaveBeenLastCalledWith('http://localhost:5173/log.html?lang=ru');
  });
});
