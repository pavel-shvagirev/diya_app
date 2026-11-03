/**
 * Owns "the main window" so nothing else keeps a reference to a destroyed one.
 * Closing the window (Cmd/Ctrl+W) leaves the app in the tray; the tray, the menu
 * and a second launch then ask the holder, which re-creates the window on demand.
 *
 * @module window-holder
 */
export interface HoldableWindow {
  isDestroyed: () => boolean;
  isMinimized: () => boolean;
  restore: () => void;
  show: () => void;
  focus: () => void;
  on: (event: 'closed', cb: () => void) => unknown;
  webContents: {
    isLoading: () => boolean;
    once: (event: 'did-finish-load', cb: () => void) => unknown;
    send: (channel: string, ...args: unknown[]) => void;
  };
}

export interface WindowHolderOptions<W extends HoldableWindow> {
  create: () => W;
  /** Wire IPC handlers / tray to a new window. */
  onCreated?: (win: W) => void;
}

export interface WindowHolder<W extends HoldableWindow> {
  /** The live window or null (never a destroyed one). */
  get: () => W | null;
  /** Create if needed, then restore / show / focus. */
  show: () => W;
  /** Send to the window if there is one; never throws. */
  send: (channel: string, ...args: unknown[]) => void;
  /** Show (creating if needed) and deliver the event once the page is loaded. */
  showAndSend: (channel: string, ...args: unknown[]) => void;
}

export function createWindowHolder<W extends HoldableWindow>(
  o: WindowHolderOptions<W>
): WindowHolder<W> {
  let win: W | null = null;

  const get = (): W | null => (win && !win.isDestroyed() ? win : null);

  const ensure = (): { win: W; created: boolean } => {
    const existing = get();
    if (existing) return { win: existing, created: false };
    const created = o.create();
    win = created;
    created.on('closed', () => {
      if (win === created) win = null;
    });
    o.onCreated?.(created);
    return { win: created, created: true };
  };

  const safeSend = (w: W, channel: string, args: unknown[]): void => {
    if (!w.isDestroyed()) w.webContents.send(channel, ...args);
  };

  const show = (): W => {
    const { win: w } = ensure();
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
    return w;
  };

  return {
    get,
    show,
    send(channel, ...args) {
      const w = get();
      if (w) safeSend(w, channel, args);
    },
    showAndSend(channel, ...args) {
      const w = show();
      if (w.webContents.isLoading())
        w.webContents.once('did-finish-load', () => safeSend(w, channel, args));
      else safeSend(w, channel, args);
    },
  };
}
