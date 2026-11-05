import { safeStorage as electronSafeStorage, BrowserWindow, type app } from 'electron';

import { ELECTRON_SECURITY, CSP_HEADERS } from '../shared/constants.js';

/**
 * Encrypt/decrypt wrapper around Electron safeStorage. On Linux without a keyring Chromium falls
 * back to a hard-coded key ("basic_text"): that is obfuscation, not encryption, so it counts as
 * unavailable and nothing is stored (the user signs in again on the next start).
 */
function assertStrongEncryption(): void {
  if (!electronSafeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption not available');
  }
  const backend = electronSafeStorage.getSelectedStorageBackend?.();
  if (backend === 'basic_text' || backend === 'unknown') {
    throw new Error('Encryption not available');
  }
}

export const safeStorage = {
  encrypt(token: string): string {
    assertStrongEncryption();
    const buffer = electronSafeStorage.encryptString(token);
    return buffer.toString('base64');
  },
  decrypt(encrypted: string): string {
    assertStrongEncryption();
    const buffer = Buffer.from(encrypted, 'base64');
    return electronSafeStorage.decryptString(buffer);
  },
};

/** The only two pages the app loads from its own files (`dist/renderer/`). */
const APP_PAGE = /\/renderer\/(?:index|log)\.html$/;

/**
 * Pages the app itself may show: its own two pages, and the dev server while developing. A
 * `file:` address counts only if it is one of those pages, so a frame that somehow got to another
 * local file is neither allowed to navigate there nor trusted by the IPC handlers.
 */
export function isAllowedNavigation(
  url: string,
  devServerUrl = process.env.VITE_DEV_SERVER_URL
): boolean {
  try {
    const target = new URL(url);
    if (target.protocol === 'file:') return APP_PAGE.test(target.pathname);
    return Boolean(devServerUrl) && target.origin === new URL(devServerUrl as string).origin;
  } catch {
    return false;
  }
}

/**
 * True when an IPC message comes from one of our own pages (the app's files, or the dev server).
 * Every handler checks it: a frame that somehow loaded other content must not reach the main
 * process (Electron security checklist, "validate the sender of all IPC messages").
 */
export function isTrustedSender(event: { senderFrame?: { url: string } | null }): boolean {
  return isAllowedNavigation(event.senderFrame?.url ?? '');
}

/** Wrap an IPC handler so that it refuses messages from untrusted frames. */
export function trusted<A extends unknown[], R>(
  fn: (event: never, ...args: A) => R
): (event: { senderFrame?: { url: string } | null }, ...args: A) => R {
  return (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted IPC sender');
    return fn(event as never, ...args);
  };
}

/** App-wide guards for every web contents: no foreign navigation, no new windows, no webviews. */
export function initAppSecurity(appObj: typeof app): void {
  appObj.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (!isAllowedNavigation(url)) event.preventDefault();
    });
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
}

/** BrowserWindow with the hardened defaults and the CSP header applied. */
export function createSecureWindow(
  options: Electron.BrowserWindowConstructorOptions
): BrowserWindow {
  const win = new BrowserWindow({
    ...options,
    webPreferences: {
      ...options.webPreferences,
      nodeIntegration: ELECTRON_SECURITY.nodeIntegration,
      contextIsolation: ELECTRON_SECURITY.contextIsolation,
      sandbox: ELECTRON_SECURITY.sandbox,
      webSecurity: ELECTRON_SECURITY.webSecurity,
      allowRunningInsecureContent: ELECTRON_SECURITY.allowRunningInsecureContent,
    },
  });

  // The app never needs camera, microphone, notifications, geolocation …: deny every request.
  win.webContents.session.setPermissionRequestHandler?.((_contents, _permission, callback) =>
    callback(false)
  );
  win.webContents.session.setPermissionCheckHandler?.(() => false);

  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, ...CSP_HEADERS } });
  });

  return win;
}
