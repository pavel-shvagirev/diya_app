/**
 * The log window: a second, separate window that shows the application log and
 * lets the user filter it. IPC handlers are registered once for the whole app.
 *
 * @module log-window
 */
import * as path from 'path';
import { fileURLToPath } from 'url';

import { ipcMain, shell } from 'electron';

import { CH, EVENTS } from '../shared/channels.js';
import { LOG_LEVELS, type LogLevel } from '../shared/log.js';
import { appIconFile } from './app-icon.js';
import { loadRenderer } from './language.js';
import { logger } from './logger.js';
import { menuStrings } from './menu-strings.js';
import { createSecureWindow, trusted } from './security.js';
import type { BrowserWindow } from 'electron';

const here = path.dirname(fileURLToPath(import.meta.url));
let win: BrowserWindow | null = null;
let unsubscribe: (() => void) | null = null;

export function registerLogIpc(): void {
  ipcMain.handle(
    CH.LOG_GET,
    trusted(() => ({
      entries: logger.getEntries(),
      recordLevel: logger.getRecordLevel(),
      file: logger.getFilePath(),
    }))
  );
  ipcMain.handle(
    CH.LOG_CLEAR,
    trusted(() => logger.clear())
  );
  ipcMain.handle(
    CH.LOG_SET_LEVEL,
    trusted((_e, level: LogLevel) => {
      if (!LOG_LEVELS.includes(level)) throw new Error(`Unknown log level: ${String(level)}`);
      logger.setRecordLevel(level);
      logger.info('app', `recording level set to ${level}`);
    })
  );
  ipcMain.handle(
    CH.LOG_REVEAL,
    trusted(() => {
      const file = logger.getFilePath();
      if (file) shell.showItemInFolder(file);
    })
  );
}

/** Open the log window, or bring the existing one to the front. */
export function openLogWindow(): void {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return;
  }
  win = createSecureWindow({
    width: 1000,
    height: 640,
    minWidth: 600,
    minHeight: 360,
    title: menuStrings().logTitle,
    icon: appIconFile(here),
    webPreferences: {
      preload: path.join(here, '..', 'preload', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  const w = win;
  unsubscribe = logger.onEntry(e => {
    if (!w.isDestroyed()) w.webContents.send(EVENTS.LOG_ENTRY, e);
  });
  w.on('closed', () => {
    unsubscribe?.();
    unsubscribe = null;
    win = null;
  });
  loadRenderer(w, 'log.html', path.join(here, '..', 'renderer'));
}

/** The language changed: new title, and the page is loaded again in the new language. */
export function relocalizeLogWindow(): void {
  if (!win || win.isDestroyed()) return;
  win.setTitle(menuStrings().logTitle);
  loadRenderer(win, 'log.html', path.join(here, '..', 'renderer'));
}
