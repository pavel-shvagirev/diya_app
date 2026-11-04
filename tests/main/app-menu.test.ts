import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { buildAppMenuTemplate } from '../../src/main/app-menu.js';
import { menuStrings } from '../../src/main/menu-strings.js';

const strings = menuStrings('en');
const build = (o: { isMac?: boolean; isDev?: boolean } = {}, openSettings = vi.fn()) =>
  buildAppMenuTemplate({
    isMac: false,
    isDev: false,
    strings,
    openSettings,
    openLog: vi.fn(),
    openAbout: vi.fn(),
    quit: vi.fn(),
    quitKey: vi.fn(),
    ...o,
  });

const flat = (t: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] =>
  t.flatMap(i => [i, ...(Array.isArray(i.submenu) ? flat(i.submenu) : [])]);

describe('application menu', () => {
  it('has a working Settings item with Cmd/Ctrl+, on every platform', () => {
    for (const isMac of [true, false]) {
      const open = vi.fn();
      const item = flat(build({ isMac }, open)).find(i => i.label === strings.settings)!;
      expect(item.accelerator).toBe('CmdOrCtrl+,');
      (item.click as () => void)();
      expect(open).toHaveBeenCalled();
    }
  });

  it('has a Log item that opens the log window', () => {
    const openLog = vi.fn();
    const item = flat(
      buildAppMenuTemplate({
        isMac: false,
        isDev: false,
        strings,
        openSettings: vi.fn(),
        openLog,
        openAbout: vi.fn(),
        quit: vi.fn(),
        quitKey: vi.fn(),
      })
    ).find(i => i.label === strings.showLog)!;
    (item.click as () => void)();
    expect(openLog).toHaveBeenCalled();
    expect(item.accelerator).toBe('CmdOrCtrl+Shift+L');
  });

  it('has an About item on every platform that opens the About dialog', () => {
    for (const isMac of [true, false]) {
      const openAbout = vi.fn();
      const template = buildAppMenuTemplate({
        isMac,
        isDev: false,
        strings,
        openSettings: vi.fn(),
        openLog: vi.fn(),
        openAbout,
        quit: vi.fn(),
        quitKey: vi.fn(),
      });
      const item = flat(template).find(i => i.label === strings.about)!;
      expect(item).toBeDefined();
      (item.click as () => void)();
      expect(openAbout).toHaveBeenCalledTimes(1);
      // on Windows and Linux it sits in a Help menu, on macOS at the top of the app menu
      if (isMac) expect((template[0]!.submenu as MenuItemConstructorOptions[])[0]).toBe(item);
      else expect(template.at(-1)!.label).toBe(strings.help);
    }
  });

  it('keeps Edit so Cut / Copy / Paste work in text fields', () => {
    const roles = flat(build({ isMac: true })).map(i => i.role);
    expect(roles).toEqual(expect.arrayContaining(['undo', 'cut', 'copy', 'paste', 'selectAll']));
  });

  it('hides Reload and DevTools outside development', () => {
    const roles = (isDev: boolean) => flat(build({ isDev })).map(i => i.role);
    expect(roles(false)).not.toContain('toggleDevTools');
    expect(roles(false)).not.toContain('reload');
    expect(roles(true)).toContain('toggleDevTools');
  });

  it('every item has an action: no placeholder entries', () => {
    for (const i of flat(build({ isMac: true }))) {
      if (i.type === 'separator' || i.submenu) continue;
      expect(Boolean(i.role) || typeof i.click === 'function').toBe(true);
    }
  });

  it('localises labels from the OS language', () => {
    expect(menuStrings('ru-RU').settings).toBe('Настройки…');
    expect(menuStrings('de').settings).toBe('Settings…');
  });

  it('Close window is Cmd/Ctrl+W on every platform', () => {
    for (const isMac of [true, false]) {
      const item = flat(build({ isMac })).find(i => i.role === 'close')!;
      expect(item.accelerator).toBe('CmdOrCtrl+W');
    }
  });

  it('the visible Quit item exits at once and shows no shortcut', () => {
    for (const isMac of [true, false]) {
      const quit = vi.fn();
      const quitKey = vi.fn();
      const items = flat(build({ isMac, quit, quitKey })).filter(i => i.label === strings.quit);
      const visible = items.find(i => i.visible !== false)!;
      expect(visible.accelerator).toBeUndefined();
      (visible.click as () => void)();
      expect(quit).toHaveBeenCalledTimes(1);
      expect(quitKey).not.toHaveBeenCalled();
    }
  });

  it('Cmd/Ctrl+Q stays on a hidden twin that takes the guarded way', () => {
    for (const isMac of [true, false]) {
      const quit = vi.fn();
      const quitKey = vi.fn();
      const hidden = flat(build({ isMac, quit, quitKey })).find(
        i => i.accelerator === 'CmdOrCtrl+Q'
      )!;
      expect(hidden.visible).toBe(false);
      (hidden.click as () => void)();
      expect(quitKey).toHaveBeenCalledTimes(1);
      expect(quit).not.toHaveBeenCalled();
    }
  });

  it('the Quit label is \"Завершить\" in Russian', () => {
    expect(menuStrings('ru').quit).toBe('Завершить');
  });
});
