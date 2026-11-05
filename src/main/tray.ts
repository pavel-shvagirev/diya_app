/**
 * System tray: icon, tooltip and a context menu whose every item does something.
 *
 * @module tray
 */
import {
  Tray,
  Menu,
  Notification,
  ipcMain,
  type BrowserWindow,
  type Tray as ElectronTrayType,
} from 'electron';

import { CH } from '../shared/channels.js';
import { menuStrings } from './menu-strings.js';
import { trusted } from './security.js';

type ElectronTray = ElectronTrayType;
export type TrayState = 'idle' | 'syncing' | 'error' | 'paused';

/** What the tray menu can do. All optional so the tray works standalone in tests. */
export interface TrayActions {
  /** Restore, show and focus the main window. */
  showWindow?: () => void;
  /** Pause or resume sync of the saved pair. */
  toggleSync?: () => void;
  openSettings?: () => void;
  quit?: () => void;
}

/** What the sync item should offer. */
export interface TraySyncInfo {
  configured: boolean;
  enabled: boolean;
}

let currentTrayState: TrayState = 'idle';
let currentTray: ElectronTray | null = null;
let currentActions: TrayActions = {};
let currentSync: TraySyncInfo = { configured: false, enabled: false };

function buildMenu(): Electron.Menu {
  const s = menuStrings();
  const syncLabel = !currentSync.configured
    ? s.setupSync
    : currentSync.enabled
      ? s.pauseSync
      : s.resumeSync;
  return Menu.buildFromTemplate([
    { label: s.open, click: () => currentActions.showWindow?.() },
    { type: 'separator' },
    {
      label: syncLabel,
      click: () =>
        (currentSync.configured ? currentActions.toggleSync : currentActions.openSettings)?.(),
    },
    { label: s.settings, click: () => currentActions.openSettings?.() },
    { type: 'separator' },
    { label: s.quit, click: () => currentActions.quit?.() },
  ]);
}

function tooltip(state: TrayState): string {
  const s = menuStrings();
  return { idle: s.tipIdle, syncing: s.tipSyncing, error: s.tipError, paused: s.tipPaused }[state];
}

/**
 * Create the tray. Calling it again replaces the previous tray instead of leaving a second
 * icon behind.
 */
export function setupTrayMenu(iconPath: string, actions: TrayActions = {}): ElectronTray {
  currentTray?.destroy();
  currentActions = actions;
  currentTray = new Tray(iconPath);
  currentTray.setToolTip(tooltip(currentTrayState));
  currentTray.setContextMenu(buildMenu());
  currentTray.on('double-click', () => currentActions.showWindow?.());
  return currentTray;
}

/** Refresh tooltip and menu after the sync state changed. */
export function updateTrayIcon(tray: ElectronTray, state: TrayState, sync?: TraySyncInfo): void {
  currentTrayState = state;
  if (sync) currentSync = sync;
  tray.setToolTip(tooltip(state));
  tray.setContextMenu(buildMenu());
}

/** Convenience for callers that only hold the module state. */
export function refreshTray(state: TrayState, sync: TraySyncInfo): void {
  if (currentTray) updateTrayIcon(currentTray, state, sync);
  else {
    currentTrayState = state;
    currentSync = sync;
  }
}

/**
 * Show a native OS notification.
 */
export function showNotification(
  title: string,
  body: string,
  options?: { icon?: string; silent?: boolean; onClick?: () => void }
): void {
  if (Notification.isSupported()) {
    const notif = new Notification({
      title,
      body,
      silent: options?.silent ?? false,
      icon: options?.icon,
    });
    if (options?.onClick) notif.on('click', options.onClick);
    notif.show();
  }
}

/** IPC for the renderer to show the window or quit (safe to call again for a new window). */
export function registerTrayIpcHandlers(_win: BrowserWindow): void {
  ipcMain.removeHandler?.(CH.TRAY_SHOW);
  ipcMain.removeHandler?.(CH.TRAY_QUIT);
  ipcMain.handle(
    CH.TRAY_SHOW,
    trusted(() => {
      currentActions.showWindow?.();
      return { success: true };
    })
  );
  ipcMain.handle(
    CH.TRAY_QUIT,
    trusted(() => {
      currentActions.quit?.();
      return { success: true };
    })
  );
}

/** True while a tray icon exists — the app can then live without windows. */
export function hasTray(): boolean {
  return currentTray !== null;
}

/** The current tray state (for testing). */
export function getTrayState(): TrayState {
  return currentTrayState;
}

/** Destroy the tray (for testing / cleanup). */
export function destroyTray(): void {
  currentTray?.destroy();
  currentTray = null;
  currentActions = {};
  currentSync = { configured: false, enabled: false };
  currentTrayState = 'idle';
}
