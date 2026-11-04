import path from 'path';
import { fileURLToPath } from 'url';
import { app, clipboard, Menu, nativeImage, powerMonitor, shell } from 'electron';

import { EVENTS } from '../shared/channels.js';
import { oauthHost } from '../shared/language.js';
import { resolveClientId, SettingsStore } from './app-config.js';
import { appIconFile, applyDockIcon } from './app-icon.js';
import { buildAppMenuTemplate } from './app-menu.js';
import { AuthService } from './auth-service.js';
import { hideHint, showHint } from './hint-window.js';
import { registerIpcHandlers } from './ipc-handlers.js';
import {
  effectiveLanguage,
  loadRenderer,
  registerLanguageIpc,
  setLanguagePref,
} from './language.js';
import { openLogWindow, registerLogIpc, relocalizeLogWindow } from './log-window.js';
import { logger } from './logger.js';
import { menuStrings } from './menu-strings.js';
import { configureNetwork } from './network.js';
import { createQuitGuard } from './quit-guard.js';
import { attachQuitKey } from './quit-key.js';
import { YandexRemote } from './remote-storage.js';
import { createSecureWindow, initAppSecurity, safeStorage } from './security.js';
import { setSyncEnabled } from './sync-control.js';
import { SyncDB } from './sync-db.js';
import { SyncEngine } from './sync-engine.js';
import { SecretFile, TokenStore } from './token-store.js';
import {
  hasTray,
  refreshTray,
  registerTrayIpcHandlers,
  setupTrayMenu,
  type TrayState,
} from './tray.js';
import { createWindowHolder } from './window-holder.js';
import { YandexDiskClient } from './yandex-api.js';
import type { BrowserWindow } from 'electron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

configureNetwork();

// The window may be closed (Cmd/Ctrl+W) while the app lives on in the tray, so nobody
// keeps a BrowserWindow reference: everything goes through the holder, which re-creates it.
const windows = createWindowHolder<BrowserWindow>({
  create: () => createMainWindow(),
  onCreated: win => wireWindowModules(win),
});

const quitKey = process.platform === 'darwin' ? '⌘Q' : 'Ctrl+Q';
const quitGuard = createQuitGuard({
  showHint: () => showHint(menuStrings().quitHint(quitKey)),
});
/** Explicit exit (tray menu): no confirmation. */
function quitNow(): void {
  quitGuard.force();
  app.quit();
}

// Shared API client instance. Starts unauthenticated (empty token); the sign-in
// (device flow, see auth-service.ts) or a saved session fills in the access token.
const apiClient = new YandexDiskClient('');

// Sync DB/engine are constructed once app.getPath() is available
// (inside app.whenReady()) and shared across every window.
let syncDb: SyncDB | null = null;
let syncEngine: SyncEngine | null = null;
let authService: AuthService | null = null;

/** Resume syncing the saved pair (if it was left enabled) once we have a token. */
function startSyncIfConfigured(): void {
  const pair = syncDb?.getPairs()[0];
  if (pair?.isActive && apiClient.getAccessToken()) syncEngine?.start();
}

function createMainWindow(): BrowserWindow {
  const win = createSecureWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Diya',
    icon: appIconFile(__dirname),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  loadRenderer(win, 'index.html', path.join(__dirname, '..', 'renderer'));
  if (process.env.VITE_DEV_SERVER_URL) win.webContents.openDevTools();

  return win;
}

function applyAppMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildAppMenuTemplate({
        isMac: process.platform === 'darwin',
        isDev: Boolean(process.env.VITE_DEV_SERVER_URL),
        strings: menuStrings(),
        openSettings,
        openLog: openLogWindow,
        quit: quitNow,
        quitKey: () => app.quit(),
      })
    )
  );
}

/** The interface language changed: native menus, tray and both windows follow at once. */
function applyLanguage(): void {
  applyAppMenu();
  lastTrayKey = '';
  updateTray();
  const win = windows.get();
  if (win) loadRenderer(win, 'index.html', path.join(__dirname, '..', 'renderer'));
  relocalizeLogWindow();
}

function showWindow(): void {
  windows.show();
}

function openSettings(): void {
  windows.showAndSend(EVENTS.OPEN_SETTINGS);
}

function toggleSync(): void {
  if (!syncDb || !syncEngine) return;
  setSyncEnabled(syncDb, syncEngine, !syncEngine.isEnabled());
  windows.send(EVENTS.SYNC_CONFIG_CHANGED);
}

let lastTrayKey = '';

/** Keep the tray tooltip / sync item in step with the engine (only when something visible changed). */
function updateTray(): void {
  const configured = Boolean(syncDb?.getPairs()[0]);
  const enabled = syncEngine?.isEnabled() ?? false;
  const phase = syncEngine?.getProgress().phase ?? 'idle';
  const state: TrayState =
    phase === 'error'
      ? 'error'
      : phase === 'scanning' || phase === 'syncing'
        ? 'syncing'
        : configured && !enabled
          ? 'paused'
          : 'idle';
  const key = `${state}|${configured}|${enabled}`;
  if (key === lastTrayKey) return;
  lastTrayKey = key;
  refreshTray(state, { configured, enabled });
}

function wireWindowModules(win: BrowserWindow): void {
  registerIpcHandlers(
    win,
    apiClient,
    syncDb ?? undefined,
    syncEngine ?? undefined,
    authService ?? undefined,
    [app.getPath('userData')]
  );
  registerTrayIpcHandlers(win);
  try {
    const iconPath = path.join(__dirname, '..', '..', 'assets', 'tray-icon.png');
    setupTrayMenu(iconPath, win, { showWindow, toggleSync, openSettings, quit: quitNow });
    lastTrayKey = '';
    updateTray();
  } catch (err) {
    // Tray creation can fail in headless/CI environments; the app still
    // works without a tray icon.
    logger.warn('app', 'tray setup failed', err);
  }
}

// One fixed data folder in dev and in packaged builds (the default depends on productName);
// YADISK_USER_DATA relocates it (tests, portable use).
app.setPath('userData', process.env.YADISK_USER_DATA || path.join(app.getPath('appData'), 'diya'));

// Two instances would run two sync engines over the same folder and database and
// fight each other (duplicates, conflicts). The second launch just focuses the first.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

void (gotLock ? app.whenReady() : Promise.resolve()).then(() => {
  if (!gotLock) return;
  applyDockIcon<Electron.NativeImage>({
    platform: process.platform,
    isPackaged: app.isPackaged,
    dock: app.dock,
    createImage: file => nativeImage.createFromPath(file),
    file: appIconFile(__dirname),
  });
  const logFile = logger.attachFile(path.join(app.getPath('userData'), 'logs'));
  logger.info('app', `started v${app.getVersion()}`, {
    electron: process.versions.electron,
    platform: process.platform,
    logFile,
    pid: process.pid,
  });
  registerLogIpc();
  initAppSecurity(app);
  const tokenStore = new TokenStore(path.join(app.getPath('userData'), 'token.bin'), safeStorage);
  const settings = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));
  const secretFile = new SecretFile(
    path.join(app.getPath('userData'), 'client-secret.bin'),
    safeStorage
  );
  let memorySecret = '';
  setLanguagePref(settings.getLanguage());
  const auth = new AuthService({
    client: apiClient,
    resolve: () =>
      resolveClientId({
        custom: settings.getClientId(),
        env: process.env.YADISK_CLIENT_ID,
      }),
    saveClientId: id => settings.setClientId(id),
    clientSecret: () => memorySecret || secretFile.get() || process.env.YADISK_CLIENT_SECRET || '',
    saveClientSecret: secret => {
      memorySecret = secret;
      try {
        if (secret) secretFile.set(secret);
        else secretFile.clear();
        memorySecret = ''; // stored encrypted; nothing to keep in memory
      } catch (err) {
        // No OS keystore: the secret lives for this session only.
        logger.warn('app', 'client secret kept in memory only — encryption unavailable', err);
      }
    },
    base: () => oauthHost(effectiveLanguage()),
    deviceId: () => settings.getDeviceId(),
    deviceName: `Diya (${process.platform})`,
    openExternal: url => shell.openExternal(url),
    copyText: text => void clipboard.writeText(text),
    onResult: result => {
      if (result.ok) windows.send(EVENTS.AUTH_CHANGED, true);
      else windows.send(EVENTS.AUTH_LOGIN_FAILED, { kind: result.kind, detail: result.detail });
    },
  });
  authService = auth;
  apiClient.setRefreshHandler(() => auth.refresh());
  const saved = tokenStore.load();
  logger.info('app', saved ? 'saved session found' : 'no saved session — sign-in required');
  if (saved) {
    auth.restore(saved.refreshToken);
    apiClient.setAccessToken(saved.accessToken);
  }
  apiClient.setTokenListener(token => {
    try {
      if (token) tokenStore.save({ accessToken: token, refreshToken: auth.getRefreshToken() });
      else tokenStore.clear();
    } catch (err) {
      logger.warn('app', 'token persistence failed', err);
    }
    if (token) startSyncIfConfigured();
    else syncEngine?.stop();
  });
  apiClient.setUnauthorizedHandler(() => {
    windows.send('auth-changed', false);
  });
  try {
    syncDb = new SyncDB(path.join(app.getPath('userData'), 'sync.db'));
    syncEngine = new SyncEngine(new YandexRemote(apiClient), syncDb, {
      conflictLabel: () => (effectiveLanguage() === 'ru' ? 'конфликтная копия' : 'conflict copy'),
      removeLocal: p => shell.trashItem(p),
    });
    const pair = syncDb.getPairs()[0];
    logger.info('sync', 'database opened', {
      pairs: syncDb.getPairs().length,
      pair: pair && { local: pair.localPath, remote: pair.remotePath, active: pair.isActive },
    });
    if (pair) {
      syncEngine.configure({ id: pair.id, localPath: pair.localPath, remotePath: pair.remotePath });
    }
  } catch (err) {
    // Sync is optional: a broken native module must not stop the app opening.
    logger.error('sync', 'sync disabled — database failed to open', err);
    syncDb = null;
    syncEngine = null;
  }
  registerLanguageIpc(
    { get: () => settings.getLanguage(), set: pref => settings.setLanguage(pref) },
    applyLanguage
  );
  applyAppMenu();
  syncEngine?.onProgress(updateTray);
  windows.show();
  startSyncIfConfigured();
});

// Cmd/Ctrl+Q inside any window (main, log, hint) goes through the quit guard.
app.on('browser-window-created', (_event, win) => {
  attachQuitKey(win.webContents, () => app.quit());
});

app.on('activate', () => {
  windows.show();
});

// Cmd/Ctrl+Q: the first press only shows a hint, the second really quits.
// Covers the menu, the Dock "Quit" and app.quit() alike; the tray uses quitNow().
app.on('before-quit', event => {
  if (!quitGuard.shouldQuit()) {
    event.preventDefault();
    return;
  }
  hideHint();
  syncEngine?.stop(); // cancels the run in flight: no request or transfer is left hanging
  logger.info('app', 'quitting');
  logger.close();
});

// Never block a system shutdown / logout with the confirmation.
powerMonitor?.on?.('shutdown', () => quitGuard.force());

// Closing the last window leaves the app in the tray (sync keeps running). Without a
// tray there would be no way back, so quit then (except on macOS, which keeps the Dock icon).
app.on('window-all-closed', () => {
  if (!hasTray() && process.platform !== 'darwin') quitNow();
});

app.on('second-instance', () => {
  logger.info('app', 'second launch ignored — focusing the running instance');
  showWindow();
});

export { apiClient };
