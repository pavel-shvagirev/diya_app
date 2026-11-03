/**
 * The interface language chosen in Settings (system / ru / en), kept in settings.json.
 * Native menus read it directly; the pages get it as a `?lang=` query when they are loaded,
 * so changing it reloads the windows (sync and everything else in this process keep running).
 *
 * @module language
 */
import { app, ipcMain } from 'electron';

import { CH } from '../shared/channels.js';
import {
  isLanguagePref,
  resolveLanguage,
  type Lang,
  type LanguagePref,
} from '../shared/language.js';
import { trusted } from './security.js';

let pref: LanguagePref = 'system';

export const getLanguagePref = (): LanguagePref => pref;
export const setLanguagePref = (next: LanguagePref): void => {
  pref = next;
};

function systemLocale(): string {
  try {
    return app.getLocale();
  } catch {
    return 'en';
  }
}

/** The language in effect now. */
export const effectiveLanguage = (): Lang => resolveLanguage(pref, systemLocale());

/** Load a renderer page with the language in its query. */
export function loadRenderer(
  win: {
    loadURL: (url: string) => Promise<void>;
    loadFile: (file: string, o?: { query: Record<string, string> }) => Promise<void>;
  },
  page: 'index.html' | 'log.html',
  rendererDir: string
): void {
  const lang = effectiveLanguage();
  const dev = process.env.VITE_DEV_SERVER_URL;
  if (dev) void win.loadURL(`${dev}/${page === 'index.html' ? '' : page}?lang=${lang}`);
  else void win.loadFile(`${rendererDir}/${page}`, { query: { lang } });
}

export interface LanguageStorage {
  get: () => LanguagePref;
  set: (pref: LanguagePref) => void;
}

/** IPC: read the preference; change it (saved, then `onChange` re-applies it everywhere). */
export function registerLanguageIpc(store: LanguageStorage, onChange: () => void): void {
  ipcMain.removeHandler(CH.LANGUAGE_GET);
  ipcMain.removeHandler(CH.LANGUAGE_SET);
  ipcMain.handle(
    CH.LANGUAGE_GET,
    trusted(() => getLanguagePref())
  );
  ipcMain.handle(
    CH.LANGUAGE_SET,
    trusted((_e, next: unknown) => {
      if (!isLanguagePref(next)) throw new Error(`Unknown language: ${String(next)}`);
      store.set(next);
      setLanguagePref(next);
      onChange();
    })
  );
}
