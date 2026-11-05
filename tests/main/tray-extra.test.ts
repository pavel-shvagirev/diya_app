import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  handlers: new Map<string, () => unknown>(),
  supported: true,
  notifications: [] as unknown[],
  clicks: [] as Array<() => void>,
}));

vi.mock('electron', () => ({
  Tray: vi.fn().mockImplementation(function () {
    return { destroy: vi.fn(), setContextMenu: vi.fn(), setToolTip: vi.fn(), on: vi.fn() };
  }),
  Menu: { buildFromTemplate: (t: unknown) => ({ t }) },
  Notification: Object.assign(
    vi.fn().mockImplementation(function (o: unknown) {
      h.notifications.push(o);
      return {
        show: vi.fn(),
        on: (_e: string, cb: () => void) => h.clicks.push(cb),
      };
    }),
    { isSupported: () => h.supported }
  ),
  ipcMain: {
    handle: (c: string, f: () => unknown) => h.handlers.set(c, f),
    removeHandler: (c: string) => h.handlers.delete(c),
  },
  app: { getLocale: () => 'en' },
}));

import { CH } from '../../src/shared/channels.js';
import {
  destroyTray,
  getTrayState,
  hasTray,
  refreshTray,
  registerTrayIpcHandlers,
  setupTrayMenu,
  showNotification,
} from '../../src/main/tray.js';

const foreignEvent = { senderFrame: { url: 'https://evil.example/' } };
const trustedEvent = { senderFrame: { url: 'file:///app/dist/renderer/index.html' } };

describe('tray helpers', () => {
  beforeEach(() => {
    destroyTray();
    h.handlers.clear();
    h.notifications.length = 0;
    h.clicks.length = 0;
    h.supported = true;
  });

  it('hasTray follows the tray lifetime', () => {
    expect(hasTray()).toBe(false);
    setupTrayMenu('/i.png');
    expect(hasTray()).toBe(true);
    destroyTray();
    expect(hasTray()).toBe(false);
  });

  it('refreshTray before a tray exists only remembers the state', () => {
    refreshTray('syncing', { configured: true, enabled: true });
    expect(getTrayState()).toBe('syncing');
    setupTrayMenu('/i.png');
    refreshTray('paused', { configured: true, enabled: false });
    expect(getTrayState()).toBe('paused');
  });

  it('a foreign frame cannot show the window or quit', () => {
    const showWindow = vi.fn();
    const quit = vi.fn();
    setupTrayMenu('/i.png', { showWindow, quit });
    registerTrayIpcHandlers({} as never);
    expect(() => h.handlers.get(CH.TRAY_SHOW)!(foreignEvent)).toThrow('Untrusted IPC sender');
    expect(() => h.handlers.get(CH.TRAY_QUIT)!(foreignEvent)).toThrow('Untrusted IPC sender');
    expect(showWindow).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
  });

  it('the renderer can ask to show the window or quit, through the current actions', async () => {
    const showWindow = vi.fn();
    const quit = vi.fn();
    setupTrayMenu('/i.png', { showWindow, quit });
    registerTrayIpcHandlers({} as never);
    expect(await h.handlers.get(CH.TRAY_SHOW)!(trustedEvent)).toEqual({ success: true });
    expect(await h.handlers.get(CH.TRAY_QUIT)!(trustedEvent)).toEqual({ success: true });
    expect(showWindow).toHaveBeenCalled();
    expect(quit).toHaveBeenCalled();
    registerTrayIpcHandlers({} as never); // registering again replaces the handlers
    expect(h.handlers.size).toBe(2);
  });

  it('a click on the notification runs the given action', () => {
    const open = vi.fn();
    showNotification('t', 'b', { onClick: open });
    h.clicks[0]!();
    expect(open).toHaveBeenCalledTimes(1);
    showNotification('t', 'b');
    expect(h.clicks).toHaveLength(1); // no action given: no listener
  });

  it('notifications respect platform support and options', () => {
    showNotification('t', 'b', { silent: true, icon: '/x.png' });
    expect(h.notifications[0]).toMatchObject({
      title: 't',
      body: 'b',
      silent: true,
      icon: '/x.png',
    });
    showNotification('t2', 'b2');
    expect(h.notifications[1]).toMatchObject({ silent: false });
    h.supported = false;
    showNotification('t3', 'b3');
    expect(h.notifications).toHaveLength(2);
  });
});
