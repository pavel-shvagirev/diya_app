import { describe, expect, it, vi } from 'vitest';

import {
  createDockVisibility,
  launchInfo,
  secondLaunchNotice,
  shouldStartInTray,
} from '../../src/main/startup.js';

describe('shouldStartInTray', () => {
  const ready = { configured: true, signedIn: true, trayReady: true };

  it('starts in the tray when sync is set up, the session is saved and the tray exists', () => {
    expect(shouldStartInTray(ready)).toBe(true);
  });

  it.each([
    ['no sync pair yet: the window is how it gets set up', { configured: false }],
    ['no saved session: the window is how the user signs in', { signedIn: false }],
    ['no tray icon: a hidden app could not be brought back', { trayReady: false }],
  ])('opens the window when there is %s', (_why, change) => {
    expect(shouldStartInTray({ ...ready, ...change })).toBe(false);
  });
});

describe('createDockVisibility', () => {
  const dock = () => ({ hide: vi.fn(), show: vi.fn().mockResolvedValue(undefined) });

  it('on macOS hides the Dock icon while no window is open and shows it with a window', () => {
    const d = dock();
    const v = createDockVisibility('darwin', d);
    v.hide();
    expect(d.hide).toHaveBeenCalledTimes(1);
    v.show();
    expect(d.show).toHaveBeenCalledTimes(1);
  });

  it('does nothing on other platforms, where a closed window has no taskbar entry', () => {
    for (const platform of ['win32', 'linux']) {
      const d = dock();
      const v = createDockVisibility(platform, d);
      v.hide();
      v.show();
      expect(d.hide).not.toHaveBeenCalled();
      expect(d.show).not.toHaveBeenCalled();
    }
  });

  it('copes with a missing Dock and with a Dock call that fails', async () => {
    expect(() => createDockVisibility('darwin', undefined).hide()).not.toThrow();
    const d = { hide: vi.fn(), show: vi.fn().mockRejectedValue(new Error('no')) };
    expect(() => createDockVisibility('darwin', d).show()).not.toThrow();
    await Promise.resolve();
  });
});

describe('a second launch of the app', () => {
  it('tells the running copy which version was started', () => {
    expect(launchInfo('0.2.5')).toEqual({ version: '0.2.5' });
  });

  it('is silent when it is the same version: the window just comes forward', () => {
    expect(secondLaunchNotice('0.2.5', launchInfo('0.2.5'))).toBeNull();
  });

  it('is reported when the version differs (e.g. the .deb is running, the AppImage is started)', () => {
    expect(secondLaunchNotice('0.2.1', launchInfo('0.2.5'))).toEqual({
      running: '0.2.1',
      started: '0.2.5',
    });
  });

  it.each([
    ['nothing (an older copy sends no data)', undefined],
    ['a string', '0.2.5'],
    ['no version', {}],
    ['a version that is not a string', { version: 5 }],
    ['an empty version', { version: '' }],
    ['a version with markup or spaces', { version: '<b>1</b> x' }],
    ['a very long version', { version: '1'.repeat(40) }],
  ])('ignores what is not a plain version: %s', (_why, data) => {
    expect(secondLaunchNotice('0.2.1', data)).toBeNull();
  });
});
