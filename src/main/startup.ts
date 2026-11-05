/**
 * Start-up decisions kept out of `main.ts` so they can be tested: whether the app opens in the
 * tray, and whether the macOS Dock icon is shown.
 *
 * @module startup
 */

/**
 * Open straight into the tray only when nothing needs the user: sync is set up, the saved session
 * lets it run, and the tray icon exists to bring the window back. Otherwise show the window.
 */
export function shouldStartInTray(o: {
  configured: boolean;
  signedIn: boolean;
  trayReady: boolean;
}): boolean {
  return o.configured && o.signedIn && o.trayReady;
}

/** The part of Electron's `app.dock` that is used. */
export interface DockLike {
  hide: () => void;
  show: () => Promise<void> | void;
}

/**
 * The Dock icon follows the windows: shown while one is open, gone when the last is closed (the
 * app lives on in the tray). Only macOS has a Dock; elsewhere a closed window is already gone
 * from the taskbar, so both calls do nothing.
 */
export function createDockVisibility(
  platform: string,
  dock: DockLike | undefined
): { show: () => void; hide: () => void } {
  const active = platform === 'darwin' && dock !== undefined;
  return {
    show() {
      if (!active) return;
      try {
        void Promise.resolve(dock.show()).catch(() => undefined);
      } catch {
        // the Dock is cosmetic: never let it break opening a window
      }
    },
    hide() {
      if (!active) return;
      try {
        dock.hide();
      } catch {
        // see above
      }
    },
  };
}
