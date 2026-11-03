/**
 * Cmd/Ctrl+Q reaches a focused window before the menu does, so the guarded quit
 * (a hint, then a second press) is decided here; the menu's own "Quit" item exits at once.
 *
 * @module quit-key
 */
export interface KeyInput {
  type: string;
  key: string;
  meta?: boolean;
  control?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/** Cmd+Q on macOS, Ctrl+Q elsewhere; no other modifiers. */
export function isQuitKey(input: KeyInput, platform: string = process.platform): boolean {
  if (input.type !== 'keyDown' || input.key.toLowerCase() !== 'q') return false;
  if (input.shift || input.alt) return false;
  return platform === 'darwin' ? Boolean(input.meta) && !input.control : Boolean(input.control);
}

export interface InputSource {
  on: (
    event: 'before-input-event',
    cb: (event: { preventDefault: () => void }, input: KeyInput) => void
  ) => unknown;
}

/** Route the quit shortcut of a window's page to `onQuitKey` (and keep it from the menu). */
export function attachQuitKey(contents: InputSource, onQuitKey: () => void): void {
  contents.on('before-input-event', (event, input) => {
    if (!isQuitKey(input)) return;
    event.preventDefault();
    onQuitKey();
  });
}
