/**
 * The application menu: only items that do something. Edit is required for
 * Cut/Copy/Paste to work in text fields on macOS.
 *
 * @module app-menu
 */
import type { MenuStrings } from './menu-strings.js';
import type { MenuItemConstructorOptions } from 'electron';

export interface AppMenuOptions {
  isMac: boolean;
  /** Development builds get Reload and DevTools. */
  isDev: boolean;
  strings: MenuStrings;
  openSettings: () => void;
  openLog: () => void;
  /** The "About" item: version and repository link. */
  openAbout: () => void;
  /** The "Quit" item: leaves at once, no hint. */
  quit: () => void;
  /** Cmd/Ctrl+Q: the guarded quit (first press shows a hint). */
  quitKey: () => void;
}

export function buildAppMenuTemplate(o: AppMenuOptions): MenuItemConstructorOptions[] {
  const { strings: s } = o;
  const settings: MenuItemConstructorOptions = {
    label: s.settings,
    accelerator: 'CmdOrCtrl+,',
    click: o.openSettings,
  };

  const log: MenuItemConstructorOptions = {
    label: s.showLog,
    accelerator: 'CmdOrCtrl+Shift+L',
    click: o.openLog,
  };

  const about: MenuItemConstructorOptions = { label: s.about, click: o.openAbout };

  // The visible item quits immediately. The shortcut is a hidden twin, so Cmd/Ctrl+Q keeps
  // its "press again" guard even when no window has focus (the app lives in the tray).
  const quit: MenuItemConstructorOptions[] = [
    { label: s.quit, click: o.quit },
    { label: s.quit, accelerator: 'CmdOrCtrl+Q', visible: false, click: o.quitKey },
  ];

  const edit: MenuItemConstructorOptions = {
    label: s.edit,
    submenu: [
      { role: 'undo', label: s.undo },
      { role: 'redo', label: s.redo },
      { type: 'separator' },
      { role: 'cut', label: s.cut },
      { role: 'copy', label: s.copy },
      { role: 'paste', label: s.paste },
      { role: 'selectAll', label: s.selectAll },
    ],
  };

  const view: MenuItemConstructorOptions = {
    label: s.view,
    submenu: [
      ...(o.isDev
        ? ([
            { role: 'reload' },
            { role: 'toggleDevTools' },
            { type: 'separator' },
          ] as MenuItemConstructorOptions[])
        : []),
      { role: 'togglefullscreen', label: s.fullscreen },
    ],
  };

  if (o.isMac) {
    return [
      {
        label: s.appName,
        submenu: [
          about,
          { type: 'separator' },
          settings,
          log,
          { type: 'separator' },
          { role: 'hide', label: s.hide },
          { role: 'hideOthers', label: s.hideOthers },
          { role: 'unhide', label: s.unhide },
          { type: 'separator' },
          ...quit,
        ],
      },
      edit,
      view,
      {
        label: s.window,
        submenu: [
          { role: 'close', label: s.close, accelerator: 'CmdOrCtrl+W' },
          { role: 'minimize', label: s.minimize },
          { role: 'zoom', label: s.zoom },
          { type: 'separator' },
          { role: 'front', label: s.front },
        ],
      },
    ];
  }

  return [
    {
      label: s.file,
      submenu: [settings, log, { type: 'separator' }, ...quit],
    },
    edit,
    view,
    {
      label: s.window,
      submenu: [
        { role: 'minimize', label: s.minimize },
        { role: 'close', label: s.close, accelerator: 'CmdOrCtrl+W' },
      ],
    },
    { label: s.help, submenu: [about] },
  ];
}
