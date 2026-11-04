import { describe, it, expect, vi, beforeEach } from 'vitest';

// State that vi.mock factory can access
let _trayDestroy = vi.fn();
let _traySetContextMenu = vi.fn();
let _traySetToolTip = vi.fn();
let _trayOn = vi.fn();
let _notificationIsSupported = true;
let _notificationShowCalls: Array<{ title: string; body: string }> = [];
const _notificationShow = vi.fn();

vi.mock('electron', () => ({
  Tray: vi.fn().mockImplementation(function () {
    return {
      destroy: _trayDestroy,
      setContextMenu: _traySetContextMenu,
      setToolTip: _traySetToolTip,
      on: _trayOn,
    };
  }),
  Menu: {
    buildFromTemplate: vi.fn((template: Array<{ label: string; click?: () => void }>) => ({
      template,
    })),
  },
  Notification: Object.assign(
    vi.fn().mockImplementation(function (options: { title: string; body: string }) {
      _notificationShowCalls.push({ title: options.title, body: options.body });
      return { show: _notificationShow };
    }),
    { isSupported: () => _notificationIsSupported }
  ),
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
}));

import {
  setupTrayMenu,
  updateTrayIcon,
  showNotification,
  getTrayState,
  destroyTray,
} from '../../src/main/tray.js';
import { menuStrings } from '../../src/main/menu-strings.js';

const S = menuStrings('en'); // the electron mock has no app.getLocale(), so labels are English

const mockWin = {
  isMinimized: () => false,
  restore: vi.fn(),
  show: vi.fn(),
  focus: vi.fn(),
  close: vi.fn(),
  webContents: { send: vi.fn() },
} as unknown as Electron.BrowserWindow;

type Item = { label?: string; type?: string; click?: () => void };
const lastMenu = (): Item[] => _traySetContextMenu.mock.calls.at(-1)![0].template;
const labels = (): string[] =>
  lastMenu()
    .filter(i => i.label)
    .map(i => i.label!);
const click = (label: string): void => lastMenu().find(i => i.label === label)!.click!();

describe('setupTrayMenu', () => {
  beforeEach(() => {
    destroyTray();
    _trayDestroy = vi.fn();
    _traySetContextMenu = vi.fn();
    _traySetToolTip = vi.fn();
    _trayOn = vi.fn();
  });

  it('creates a tray with tooltip, menu and double-click', () => {
    const tray = setupTrayMenu('/icon.png', mockWin);
    expect(tray).toBeDefined();
    expect(_traySetToolTip).toHaveBeenCalledWith(S.tipIdle);
    expect(_trayOn).toHaveBeenCalledWith('double-click', expect.any(Function));
  });

  it('offers only real items: Open, a sync item, Settings, Quit', () => {
    setupTrayMenu('/icon.png', mockWin);
    expect(labels()).toEqual([S.open, S.setupSync, S.settings, S.quit]);
  });

  it('every item calls its action', () => {
    const actions = {
      showWindow: vi.fn(),
      toggleSync: vi.fn(),
      openSettings: vi.fn(),
      quit: vi.fn(),
    };
    const tray = setupTrayMenu('/icon.png', mockWin, actions);
    click(S.open);
    expect(actions.showWindow).toHaveBeenCalled();
    click(S.settings);
    click(S.quit);
    expect(actions.quit).toHaveBeenCalled();

    // not configured: the sync item leads to Settings, not to a no-op
    click(S.setupSync);
    expect(actions.openSettings).toHaveBeenCalledTimes(2);
    expect(actions.toggleSync).not.toHaveBeenCalled();

    updateTrayIcon(tray, 'idle', { configured: true, enabled: true });
    expect(labels()).toContain(S.pauseSync);
    click(S.pauseSync);
    expect(actions.toggleSync).toHaveBeenCalledTimes(1);

    updateTrayIcon(tray, 'paused', { configured: true, enabled: false });
    expect(labels()).toContain(S.resumeSync);
    click(S.resumeSync);
    expect(actions.toggleSync).toHaveBeenCalledTimes(2);
  });

  it('calling setup again replaces the tray instead of leaving two icons', () => {
    setupTrayMenu('/icon.png', mockWin);
    setupTrayMenu('/icon.png', mockWin);
    expect(_trayDestroy).toHaveBeenCalledTimes(1);
  });
});

describe('updateTrayIcon', () => {
  beforeEach(() => {
    _traySetToolTip = vi.fn();
  });

  it('updates tooltip based on state', () => {
    const mockTray = {
      setToolTip: _traySetToolTip,
      setContextMenu: vi.fn(),
    } as unknown as Electron.Tray;
    updateTrayIcon(mockTray, 'syncing');
    expect(_traySetToolTip).toHaveBeenCalledWith(S.tipSyncing);
    updateTrayIcon(mockTray, 'error');
    expect(_traySetToolTip).toHaveBeenCalledWith(S.tipError);
    updateTrayIcon(mockTray, 'paused');
    expect(_traySetToolTip).toHaveBeenCalledWith(S.tipPaused);
    updateTrayIcon(mockTray, 'idle');
    expect(_traySetToolTip).toHaveBeenCalledWith(S.tipIdle);
  });

  it('updates tray state', () => {
    const mockTray = {
      setToolTip: _traySetToolTip,
      setContextMenu: vi.fn(),
    } as unknown as Electron.Tray;
    updateTrayIcon(mockTray, 'syncing');
    expect(getTrayState()).toBe('syncing');
  });
});

describe('showNotification', () => {
  beforeEach(() => {
    _notificationIsSupported = true;
    _notificationShowCalls = [];
  });

  it('does not throw when notification is shown', () => {
    expect(() => showNotification('Title', 'Body')).not.toThrow();
  });

  it('respects silent option', () => {
    // Should not throw either way
    expect(() => showNotification('Title', 'Body', { silent: true })).not.toThrow();
    expect(() => showNotification('Title', 'Body', { silent: false })).not.toThrow();
  });
});

describe('destroyTray', () => {
  it('resets internal state', () => {
    destroyTray();
    expect(getTrayState()).toBe('idle');
  });
});
