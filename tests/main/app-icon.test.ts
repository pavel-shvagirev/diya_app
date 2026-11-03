import path from 'path';

import { describe, expect, it, vi } from 'vitest';

import { appIconFile, applyDockIcon } from '../../src/main/app-icon.js';

describe('app icon', () => {
  it('finds assets/icon.png from the compiled main process folder', () => {
    expect(appIconFile(path.join('/app', 'dist', 'main'))).toBe(
      path.join('/app', 'assets', 'icon.png')
    );
  });

  const setup = (over: Partial<Parameters<typeof applyDockIcon>[0]> = {}, empty = false) => {
    const dock = { setIcon: vi.fn() };
    const image = { isEmpty: () => empty };
    const createImage = vi.fn().mockReturnValue(image);
    const done = applyDockIcon({
      platform: 'darwin',
      isPackaged: false,
      dock,
      createImage,
      file: '/x/icon.png',
      ...over,
    });
    return { dock, image, createImage, done };
  };

  it('sets the Dock icon in a development run on macOS', () => {
    const { dock, image, createImage, done } = setup();
    expect(done).toBe(true);
    expect(createImage).toHaveBeenCalledWith('/x/icon.png');
    expect(dock.setIcon).toHaveBeenCalledWith(image);
  });

  it('leaves packaged builds, other systems and a missing Dock alone', () => {
    expect(setup({ isPackaged: true }).dock.setIcon).not.toHaveBeenCalled();
    expect(setup({ platform: 'linux' }).dock.setIcon).not.toHaveBeenCalled();
    expect(setup({ platform: 'win32' }).done).toBe(false);
    expect(setup({ dock: undefined }).done).toBe(false);
  });

  it('does not replace the icon with an unreadable image', () => {
    const { dock, done } = setup({}, true);
    expect(done).toBe(false);
    expect(dock.setIcon).not.toHaveBeenCalled();
  });
});
