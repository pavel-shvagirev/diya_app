/**
 * The About dialog: version, who it is by, the repository link. No personal data.
 *
 * @module about
 */
import type { MenuStrings } from './menu-strings.js';
import type { MessageBoxOptions } from 'electron';

/** The project's public repository (a fixed address, never taken from user input). */
export const REPO_URL = 'https://github.com/pavel-shvagirev/diya_app';

export interface AboutDeps {
  strings: MenuStrings;
  version: string;
  showMessageBox: (options: MessageBoxOptions) => Promise<{ response: number }>;
  openExternal: (url: string) => Promise<void>;
}

export async function showAbout(d: AboutDeps): Promise<void> {
  const { strings: s } = d;
  const { response } = await d.showMessageBox({
    type: 'info',
    title: s.about,
    message: s.appName,
    detail: [
      s.aboutVersion(d.version),
      s.aboutAuthors,
      '',
      s.aboutNotAffiliated,
      '',
      REPO_URL,
    ].join('\n'),
    buttons: [s.aboutOpenRepo, s.ok],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  if (response === 0) await d.openExternal(REPO_URL);
}
