/**
 * Cmd/Ctrl+Q must not kill the app (and its sync) by accident: the first press only
 * shows a hint, a second press within `windowMs` really quits. Explicit exits (tray
 * "Quit", system shutdown) call `force()`.
 *
 * @module quit-guard
 */
export interface QuitGuardOptions {
  now?: () => number;
  /** How long the second press counts as "again". */
  windowMs?: number;
  showHint: () => void;
  /** Called by `confirm` helpers; not used by `shouldQuit`. */
  quit?: () => void;
}

export interface QuitGuard {
  /** Call from `before-quit`: true = let the quit happen, false = cancel it (hint shown). */
  shouldQuit: () => boolean;
  /** Quit for real, no hint (tray menu, system shutdown). */
  force: () => void;
}

export function createQuitGuard(o: QuitGuardOptions): QuitGuard {
  const now = o.now ?? Date.now;
  const windowMs = o.windowMs ?? 3000;
  let lastPress = -Infinity;
  let confirmed = false;
  return {
    shouldQuit() {
      if (confirmed) return true;
      const t = now();
      if (t - lastPress <= windowMs) {
        confirmed = true;
        return true;
      }
      lastPress = t;
      o.showHint();
      return false;
    },
    force() {
      confirmed = true;
    },
  };
}
