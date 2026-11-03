/**
 * Which folders may be chosen as the local side of a sync pair. Sync deletes and overwrites, so
 * pointing it at the wrong folder (the home folder, the whole disk, the app's own data) is a
 * data-loss mistake the app refuses instead of carrying out.
 *
 * @module sync-folder
 */
import { realpathSync, statSync } from 'fs';
import * as path from 'path';

export interface SyncFolderRules {
  /** The user's home folder: neither it nor any folder above it may be synced. */
  home: string;
  /** Folders that must stay outside the sync folder and must not contain it (app data). */
  protectedPaths?: string[];
  /** Overridable for tests. */
  platform?: string;
}

/** Top-level system folders, by platform. A folder equal to or inside one is refused. */
const SYSTEM_FOLDERS: Record<string, string[]> = {
  posix: ['/bin', '/sbin', '/usr', '/etc', '/boot', '/dev', '/proc', '/sys', '/System', '/Library'],
  win32: ['windows', 'program files', 'program files (x86)', 'programdata'],
};

const same = (a: string, b: string, win: boolean): boolean =>
  win ? a.toLowerCase() === b.toLowerCase() : a === b;

/** True when `inner` is `outer` or lies inside it. */
const within = (inner: string, outer: string, win: boolean): boolean => {
  const i = win ? inner.toLowerCase() : inner;
  const o = win ? outer.toLowerCase() : outer;
  return i === o || i.startsWith(o.endsWith(path.sep) ? o : o + path.sep);
};

/** Throws a user-readable error for a folder that must not be synced; returns its real path. */
export function assertSafeSyncFolder(local: string, rules: SyncFolderRules): string {
  const win = (rules.platform ?? process.platform) === 'win32';
  let real: string;
  try {
    real = realpathSync(local);
    if (!statSync(real).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new Error('Choose an existing folder for synchronisation');
  }

  if (same(path.parse(real).root, real, win)) {
    throw new Error('The whole disk cannot be synchronised: choose a dedicated folder');
  }

  let home = rules.home;
  try {
    home = realpathSync(rules.home);
  } catch {
    // keep the path as given
  }
  if (within(home, real, win)) {
    throw new Error('Your home folder (or a folder containing it) cannot be synchronised');
  }

  for (const guarded of rules.protectedPaths ?? []) {
    let g = guarded;
    try {
      g = realpathSync(guarded);
    } catch {
      // not created yet: compare as given
    }
    if (within(real, g, win) || within(g, real, win)) {
      throw new Error("This folder overlaps the application's own data folder");
    }
  }

  // Checked on the path as chosen and on its real path (/etc is a link to /private/etc on macOS).
  const systems = win ? SYSTEM_FOLDERS.win32! : SYSTEM_FOLDERS.posix!;
  const topOf = (p: string): string =>
    win
      ? (path.relative(path.parse(p).root, p).split(path.sep)[0] ?? '').toLowerCase()
      : '/' + (p.split('/')[1] ?? '');
  if ([path.resolve(local), real].some(p => systems.includes(topOf(p)))) {
    throw new Error('System folders cannot be synchronised');
  }
  return real;
}
