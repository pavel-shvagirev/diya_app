/**
 * The application icon at run time. Packaged builds carry it in the bundle (electron-builder
 * makes .icns/.ico from build/icon.png); this covers the window icon on Windows and Linux and
 * the Dock icon when running from a source checkout on macOS, where the stock Electron icon
 * would show otherwise.
 *
 * @module app-icon
 */
import path from 'path';

/** `assets/icon.png`, relative to the compiled main process (dist/main). */
export const appIconFile = (mainDir: string): string =>
  path.join(mainDir, '..', '..', 'assets', 'icon.png');

export interface DockLike<I> {
  setIcon: (image: I) => void;
}

/** Dock icon for a development run on macOS; no-op elsewhere and in packaged builds. */
export function applyDockIcon<I extends { isEmpty: () => boolean }>(o: {
  platform: string;
  isPackaged: boolean;
  dock: DockLike<I> | undefined;
  createImage: (file: string) => I;
  file: string;
}): boolean {
  if (o.platform !== 'darwin' || o.isPackaged || !o.dock) return false;
  const image = o.createImage(o.file);
  if (image.isEmpty()) return false;
  o.dock.setIcon(image);
  return true;
}
