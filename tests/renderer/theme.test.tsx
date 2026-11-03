import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock window.matchMedia
const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(), // deprecated
      removeListener: vi.fn(), // deprecated
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    value: originalMatchMedia,
  });
});

describe('themeStore', () => {
  it('toggles between light and dark', async () => {
    const { useThemeStore } = await import('../../src/renderer/store/themeStore.js');
    useThemeStore.getState().setTheme('light');
    expect(useThemeStore.getState().theme).toBe('light');

    useThemeStore.getState().setTheme('dark');
    expect(useThemeStore.getState().theme).toBe('dark');

    useThemeStore.getState().setTheme('light');
    expect(useThemeStore.getState().theme).toBe('light');
  });

  it('toggleTheme switches to the opposite theme', async () => {
    const { useThemeStore } = await import('../../src/renderer/store/themeStore.js');
    useThemeStore.getState().setTheme('light');
    expect(useThemeStore.getState().theme).toBe('light');

    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe('dark');

    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe('light');
  });

  it('detectSystemTheme respects prefers-color-scheme', async () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: true,
        media: '(prefers-color-scheme: dark)',
      })),
    });

    const { useThemeStore } = await import('../../src/renderer/store/themeStore.js');
    useThemeStore.getState().detectSystemTheme();
    expect(useThemeStore.getState().isSystemDark).toBe(true);
  });
});

describe('system theme default', () => {
  it('starts from the system preference, not a hardcoded light', async () => {
    vi.resetModules();
    window.matchMedia = vi.fn().mockImplementation(q => ({
      matches: true,
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as never;
    const { useThemeStore } = await import('../../src/renderer/store/themeStore.js');
    expect(useThemeStore.getState().theme).toBe('dark');
  });

  it('initTheme re-detects when the OS theme changes', async () => {
    vi.resetModules();
    let onChange: () => void = () => {};
    const mm = { matches: false };
    window.matchMedia = vi.fn().mockImplementation(q => ({
      get matches() {
        return mm.matches;
      },
      media: q,
      addEventListener: (_: string, cb: () => void) => {
        onChange = cb;
      },
      removeEventListener: vi.fn(),
    })) as never;
    const { useThemeStore, initTheme } = await import('../../src/renderer/store/themeStore.js');
    initTheme();
    expect(useThemeStore.getState().theme).toBe('light');
    mm.matches = true;
    onChange();
    expect(useThemeStore.getState().theme).toBe('dark');
  });
});
