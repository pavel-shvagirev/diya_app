import { describe, expect, it, vi } from 'vitest';

import { REPO_URL, showAbout } from '../../src/main/about.js';
import { menuStrings } from '../../src/main/menu-strings.js';

const run = async (response: number, locale = 'en') => {
  const showMessageBox = vi.fn().mockResolvedValue({ response });
  const openExternal = vi.fn().mockResolvedValue(undefined);
  await showAbout({
    strings: menuStrings(locale),
    version: '1.2.3',
    showMessageBox,
    openExternal,
  });
  return { showMessageBox, openExternal, options: showMessageBox.mock.calls[0]![0] };
};

describe('About dialog', () => {
  it('shows the version, the repository link and who it is by, and no personal data', async () => {
    const { options } = await run(1);
    const text = `${options.message}\n${options.detail}`;
    expect(options.message).toContain('Diya');
    expect(text).toContain('1.2.3');
    expect(text).toContain(REPO_URL);
    expect(text).toContain('Diya contributors');
    expect(text).toMatch(/not affiliated/i);
    expect(text).not.toMatch(/@|\/Users\//);
  });

  it('opens the repository from the first button only', async () => {
    const a = await run(0);
    expect(a.openExternal).toHaveBeenCalledWith(REPO_URL);
    const b = await run(1);
    expect(b.openExternal).not.toHaveBeenCalled();
  });

  it('follows the interface language', async () => {
    const { options } = await run(1, 'ru-RU');
    expect(options.detail).toContain('Версия 1.2.3');
    expect(options.detail).toMatch(/не связан/i);
  });

  it('the repository link is a plain https address of GitHub', () => {
    expect(REPO_URL).toMatch(/^https:\/\/github\.com\/[\w-]+\/[\w-]+$/);
  });
});
