/**
 * Zustand store for theme (light/dark) management.
 *
 * @module themeStore
 */

import { create } from 'zustand';

export type Theme = 'light' | 'dark';
/** What the user picked: follow the OS, or force a theme. */
export type ThemeMode = 'system' | Theme;

const MODE_KEY = 'theme-mode';

interface ThemeState {
  theme: Theme;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  isSystemDark: boolean;
  _explicitTheme: boolean;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  detectSystemTheme: () => void;
}

/**
 * Detect whether the system prefers dark mode.
 * Only works in browser/renderer context.
 */
function detectSystemDark(): boolean {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return false;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: detectSystemDark() ? 'dark' : 'light',
  mode: 'system',
  setMode: (mode: ThemeMode) => {
    const root = document.documentElement;
    if (mode === 'system') {
      root.removeAttribute('data-theme');
      set({ mode, _explicitTheme: false, theme: detectSystemDark() ? 'dark' : 'light' });
    } else {
      root.setAttribute('data-theme', mode);
      set({ mode, _explicitTheme: true, theme: mode });
    }
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      // Persistence is best-effort.
    }
  },
  isSystemDark: detectSystemDark(),
  _explicitTheme: false,

  detectSystemTheme: () => {
    const isDark = detectSystemDark();
    set({ isSystemDark: isDark });
    // Auto-switch if user hasn't explicitly set a theme
    if (!get()._explicitTheme) {
      set({ theme: isDark ? 'dark' : 'light' });
    }
  },

  setTheme: (theme: Theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    set({ theme, _explicitTheme: true });
  },

  toggleTheme: () => {
    const next: Theme = get().theme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    set({ theme: next, _explicitTheme: true });
  },
}));

/**
 * Keep the store in sync with the OS theme. Colours themselves follow the OS
 * through CSS (`color-scheme: light dark`); an explicit setTheme() pins
 * `data-theme` on <html> and wins over the system.
 */
export function initTheme(): void {
  if (typeof window === 'undefined' || !window.matchMedia) return;
  try {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved === 'light' || saved === 'dark') useThemeStore.getState().setMode(saved);
  } catch {
    // Storage unavailable: stay on the system theme.
  }
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => useThemeStore.getState().detectSystemTheme());
}
