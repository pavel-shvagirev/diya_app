/**
 * User-level file actions shared by the toolbar, context menu and keyboard.
 * Each one asks for confirmation / input where needed, then calls the store.
 *
 * @module actions
 */
import { FEATURES } from '../../shared/features.js';
import { useBrowserStore } from '../store/browserStore.js';
import { dialogs } from '../store/dialogStore.js';
import { baseName, isDir, nameProblem, type Entry } from './entries.js';
import { t } from './strings.js';

const browser = (): ReturnType<typeof useBrowserStore.getState> => useBrowserStore.getState();

const problemText = (name: string): string | null => {
  const p = nameProblem(name);
  return p === 'empty'
    ? t.nameEmpty
    : p === 'slash'
      ? t.nameSlash
      : p === 'dots'
        ? t.nameDots
        : null;
};

export async function newFolder(): Promise<void> {
  const name = await dialogs.prompt({
    title: t.newFolder,
    label: t.folderName,
    initial: '',
    submit: t.create,
    validate: problemText,
  });
  if (name) await browser().createFolder(name);
}

export async function renameEntry(entry: Entry): Promise<void> {
  const name = await dialogs.prompt({
    title: t.rename,
    label: t.newName,
    initial: entry.name,
    submit: t.save,
    validate: problemText,
  });
  if (name && name.trim() !== entry.name) await browser().renameEntry(entry.path, name);
}

export async function removeEntries(entries: Entry[]): Promise<void> {
  if (entries.length === 0) return;
  const ok = await dialogs.confirm({
    title: t.delete,
    message: t.confirmDelete(entries.length, entries[0]?.name ?? ''),
    danger: true,
    submit: t.delete,
  });
  if (ok) await browser().deleteEntries(entries.map(e => e.path));
}

export async function deleteForever(entries: Entry[]): Promise<void> {
  if (entries.length === 0) return;
  const ok = await dialogs.confirm({
    title: t.deleteForever,
    message: t.confirmDeleteForever(entries.length),
    danger: true,
    submit: t.deleteForever,
  });
  if (!ok) return;
  for (const e of entries) await window.api.deleteFromTrash(e.path).catch(() => undefined);
  await browser().refresh();
  void browser().loadQuota();
}

export async function emptyTrash(): Promise<void> {
  const ok = await dialogs.confirm({
    title: t.emptyTrash,
    message: t.confirmEmptyTrash,
    danger: true,
    submit: t.emptyTrash,
  });
  if (ok) await browser().emptyTrash();
}

export async function moveEntriesTo(entries: Entry[]): Promise<void> {
  const dest = await dialogs.pickFolder({ title: t.moveTo, submit: t.moveHere, initial: '/' });
  if (dest)
    await browser().moveEntries(
      entries.map(e => e.path),
      dest
    );
}

export async function copyEntriesTo(entries: Entry[]): Promise<void> {
  const dest = await dialogs.pickFolder({ title: t.copyTo, submit: t.copyHere, initial: '/' });
  if (dest)
    await browser().copyEntries(
      entries.map(e => e.path),
      dest
    );
}

/** Creating a link is switched off (FEATURES.publicLinks); an existing one can still be shown and revoked. */
export const canShare = (entry: Entry | undefined): boolean =>
  Boolean(entry && (FEATURES.publicLinks || entry.public_url));

export async function shareEntry(entry: Entry): Promise<void> {
  if (!canShare(entry)) return;
  const url = entry.public_url || (await browser().shareEntry(entry.path));
  if (!url) return;
  const action = await dialogs.share({ path: entry.path, url });
  if (action === 'unshare') await browser().unshareEntry(entry.path);
}

/** Double-click / Enter: folders open, files are downloaded. */
export async function openEntry(entry: Entry): Promise<void> {
  if (isDir(entry)) await browser().openFolder(entry.path);
  else await browser().downloadEntries([entry.path]);
}

/** Double-click / Enter in the trash: a folder opens (a file cannot be opened there). */
export async function openTrashEntry(entry: Entry): Promise<void> {
  if (isDir(entry)) await browser().openTrash({ path: entry.path });
}

/** Put one item back from the trash under a name the user types (the old one may be taken). */
export async function restoreEntryAs(entry: Entry): Promise<void> {
  const name = await dialogs.prompt({
    title: t.restoreAs,
    label: t.newName,
    initial: entry.name,
    submit: t.restore,
    validate: problemText,
  });
  if (name) await browser().restoreEntries([entry.path], name.trim());
}

export const displayName = (path: string): string => baseName(path) || t.disk;
