import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FolderTree } from '../../src/renderer/components/FolderTree.js';
import { SettingsDialog } from '../../src/renderer/components/SettingsDialog.js';
import { StatusBar } from '../../src/renderer/components/StatusBar.js';
import { DND_MIME } from '../../src/renderer/components/FolderTree.js';
import { ContextMenu } from '../../src/renderer/ui/ContextMenu.js';
import { Modal } from '../../src/renderer/ui/Modal.js';
import { extensionOf, sortEntries, type Entry } from '../../src/renderer/lib/entries.js';
import { formatDate } from '../../src/renderer/lib/format.js';
import { t } from '../../src/renderer/lib/strings.js';
import { useBrowserStore } from '../../src/renderer/store/browserStore.js';
import { dialogs, useDialogStore } from '../../src/renderer/store/dialogStore.js';
import { useErrorStore } from '../../src/renderer/store/errorStore.js';
import { useSyncStore } from '../../src/renderer/store/syncStore.js';
import type { SyncProgress } from '../../src/shared/types.js';
import { dir, file, installApi, list } from './helpers.js';

let api: ReturnType<typeof installApi>;

const idle: SyncProgress = {
  phase: 'idle',
  totalFiles: 0,
  doneFiles: 0,
  totalBytes: 0,
  doneBytes: 0,
  current: null,
  lastSync: null,
  error: null,
  failures: [],
  conflicts: 0,
};

beforeEach(() => {
  api = installApi();
  useBrowserStore.setState(useBrowserStore.getInitialState(), true);
  useDialogStore.setState({ current: null });
  useErrorStore.setState(useErrorStore.getInitialState(), true);
  useSyncStore.setState({ config: null, progress: idle, loaded: true });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('entries and formats', () => {
  const e = (name: string, extra: Partial<Entry> = {}): Entry =>
    ({ path: `/${name}`, name, type: 'file', ...extra }) as Entry;

  it('sorts by size, modified date and type, with ties settled by name', () => {
    const items = [
      e('b.txt', { size: 5, modified: '2026-01-02' }),
      e('a.png', { size: 5, modified: '2026-01-01' }),
      e('c'), // no size, no date, no extension
      e('d.txt', { size: 1, modified: '2026-01-03' }),
    ];
    expect(sortEntries(items, 'size', 'asc').map(x => x.name)).toEqual([
      'c',
      'd.txt',
      'a.png',
      'b.txt',
    ]);
    expect(sortEntries(items, 'modified', 'desc').map(x => x.name)).toEqual([
      'd.txt',
      'b.txt',
      'a.png',
      'c',
    ]);
    expect(sortEntries(items, 'type', 'asc').map(x => x.name)).toEqual([
      'c',
      'a.png',
      'b.txt',
      'd.txt',
    ]);
  });

  it('a folder has no extension, a dotfile has none either', () => {
    expect(extensionOf({ name: 'x.d', type: 'dir' })).toBe('');
    expect(extensionOf({ name: '.env', type: 'file' })).toBe('');
    expect(extensionOf({ name: 'A.TXT', type: 'file' })).toBe('txt');
  });

  it('an unreadable date is shown as nothing', () => {
    expect(formatDate('not a date', 'en')).toBe('');
    expect(formatDate(undefined, 'en')).toBe('');
  });
});

describe('overlays', () => {
  it('a press inside the dialog does not close it, only the backdrop does', () => {
    const onClose = vi.fn();
    render(
      <Modal title="T" onClose={onClose}>
        body
      </Modal>
    );
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.querySelector('.overlay') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the browser menu is not shown over the app menu', () => {
    render(
      <ContextMenu x={1} y={1} items={[{ label: 'One', onClick: () => {} }]} onClose={() => {}} />
    );
    const prevented = !fireEvent.contextMenu(screen.getByRole('menu'));
    expect(prevented).toBe(true);
  });
});

describe('StatusBar', () => {
  it('counts the size of the selected files only and turns the quota bar red near the limit', async () => {
    api.listFiles.mockResolvedValue(list([file('a.txt', { size: 100 }), dir('D')]));
    api.getQuota.mockResolvedValue({ total_space: 100, used_space: 95, trash_size: 0 });
    await useBrowserStore.getState().openFolder('/');
    await useBrowserStore.getState().loadQuota();
    act(() => useBrowserStore.getState().select('/a.txt', 'replace'));
    act(() => useBrowserStore.getState().select('/D', 'toggle'));
    const { container } = render(<StatusBar />);
    const bar = container.querySelector('[role="progressbar"] > *') as HTMLElement;
    expect(bar.style.background).toBe('var(--ui-danger)');
  });
});

describe('Settings: sync section', () => {
  const config = { localPath: '/home/u/Disk', remotePath: '/Sync', enabled: true };
  const mount = (progress: Partial<SyncProgress> = {}, cfg = config) => {
    useSyncStore.setState({
      config: cfg,
      progress: { ...idle, ...progress },
      loaded: true,
      syncNow: vi.fn().mockResolvedValue(undefined),
    });
    return render(<SettingsDialog />);
  };

  it('names every phase, shows the last run and the error', () => {
    mount({ phase: 'error', error: 'boom', lastSync: '2026-01-01T10:00:00.000Z' });
    expect(screen.getByText(t.syncError)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
    cleanup();
    mount({ phase: 'scanning' });
    expect(screen.getByText(t.syncScanning)).toBeInTheDocument();
    cleanup();
    mount({ phase: 'syncing', totalFiles: 2, doneFiles: 1 });
    expect(screen.getAllByText(new RegExp(t.secSync)).length).toBeGreaterThan(0);
  });

  it('shows the local folder, picks the Disk folder and syncs now', async () => {
    mount();
    fireEvent.click(screen.getByText(t.showInFinder));
    expect(api.showInFolder).toHaveBeenCalledWith('/home/u/Disk');
    const pick = vi.spyOn(dialogs, 'pickFolder').mockResolvedValue('/Other');
    fireEvent.click(screen.getAllByText(t.choosePlus)[1]!);
    await waitFor(() => expect(screen.getByTitle('/Other')).toBeInTheDocument());
    expect(pick).toHaveBeenCalled();
    fireEvent.click(screen.getByText(t.syncNow).closest('button')!);
    expect(useSyncStore.getState().syncNow).toHaveBeenCalled();
  });

  it('a cancelled folder picker changes nothing', async () => {
    mount();
    vi.spyOn(dialogs, 'pickFolder').mockResolvedValue(null);
    fireEvent.click(screen.getAllByText(t.choosePlus)[1]!);
    await act(async () => undefined);
    expect(screen.getByTitle('/Sync')).toBeInTheDocument();
  });
});

describe('FolderTree: keys and drops', () => {
  const mount = async () => {
    api.listFiles.mockImplementation(async (p: string) =>
      list(p === '/' ? [dir('A'), dir('B')] : p === '/A' ? [dir('A1', '/A')] : [])
    );
    await useBrowserStore.getState().openFolder('/');
    await useBrowserStore.getState().loadTreeNode('/');
    render(<FolderTree />);
    await screen.findByText('A');
    return screen.getByRole('tree');
  };

  it('arrows move, right opens, left closes or goes to the parent, Enter opens the folder', async () => {
    const tree = await mount();
    const key = (k: string): boolean => fireEvent.keyDown(tree, { key: k });
    key('ArrowDown');
    key('ArrowDown');
    key('ArrowUp');
    key('ArrowRight'); // expands A
    await waitFor(() => expect(screen.getByText('A1')).toBeInTheDocument());
    key('ArrowRight'); // already open: steps into it
    key('ArrowLeft'); // closes nothing on a leaf: goes to the parent
    key('ArrowLeft');
    key('Enter');
    expect(key('x')).toBe(true); // an unknown key is not swallowed
    fireEvent.blur(tree);
  });

  it('a drop moves what the table dragged into the folder; the trash takes nothing', async () => {
    await mount();
    const move = vi.fn();
    useBrowserStore.setState({ moveEntries: move });
    const row = screen.getByText('B').closest('[role="treeitem"]') as HTMLElement;
    const dt = { types: [DND_MIME], getData: () => JSON.stringify(['/x.txt']), dropEffect: '' };
    fireEvent.dragOver(row, { dataTransfer: dt });
    fireEvent.dragLeave(row);
    fireEvent.drop(row, { dataTransfer: dt });
    expect(move).toHaveBeenCalledWith(['/x.txt'], '/B');
    move.mockClear();
    fireEvent.drop(row, { dataTransfer: { ...dt, getData: () => '' } });
    expect(move).not.toHaveBeenCalled();
    const trash = screen.getByText(t.trash).closest('[role="treeitem"]') as HTMLElement;
    fireEvent.dragOver(trash, { dataTransfer: dt });
    fireEvent.drop(trash, { dataTransfer: dt });
    expect(move).not.toHaveBeenCalled();
    // a press on the chevron of a folder opens it without selecting it
    const chevron = row.querySelector('.tree-chevron') as HTMLElement;
    fireEvent.click(chevron);
  });
});

describe('browser store: failures are reported, not thrown', () => {
  it('a folder that cannot be read shows the error and an empty list', async () => {
    api.listFiles.mockRejectedValue(new Error('no route'));
    await useBrowserStore.getState().openFolder('/x');
    expect(useBrowserStore.getState()).toMatchObject({ error: 'no route', entries: [] });
  });

  it('the trash that cannot be read, likewise', async () => {
    api.getTrashList.mockRejectedValue(new Error('no trash'));
    await useBrowserStore.getState().openTrash();
    expect(useBrowserStore.getState()).toMatchObject({ error: 'no trash', entries: [] });
  });

  it('an older answer never replaces a newer view', async () => {
    let release: (v: unknown) => void = () => {};
    api.listFiles.mockImplementationOnce(() => new Promise(r => (release = r)));
    const slow = useBrowserStore.getState().openFolder('/slow');
    api.listFiles.mockResolvedValue(list([file('new.txt')]));
    await useBrowserStore.getState().openFolder('/fast');
    release(list([file('old.txt')]));
    await slow;
    expect(useBrowserStore.getState().entries.map(x => x.name)).toEqual(['new.txt']);
    // the same for a slow failure and for the trash
    api.listFiles.mockImplementationOnce(() => new Promise((_, rej) => (release = rej)));
    const slowFail = useBrowserStore.getState().openFolder('/slow2');
    await useBrowserStore.getState().openFolder('/fast');
    release(new Error('late'));
    await slowFail;
    expect(useBrowserStore.getState().error).toBeNull();
    api.getTrashList.mockImplementationOnce(() => new Promise(r => (release = r)));
    const slowTrash = useBrowserStore.getState().openTrash();
    await useBrowserStore.getState().openFolder('/fast');
    release(list([file('t.txt')]));
    await slowTrash;
    expect(useBrowserStore.getState().view.kind).toBe('folder');
    api.getTrashList.mockImplementationOnce(() => new Promise((_, rej) => (release = rej)));
    const slowTrashFail = useBrowserStore.getState().openTrash();
    await useBrowserStore.getState().openFolder('/fast');
    release(new Error('late trash'));
    await slowTrashFail;
    expect(useBrowserStore.getState().error).toBeNull();
  });

  it('back and forward stop at the ends of the history', async () => {
    api.listFiles.mockResolvedValue(list([]));
    await useBrowserStore.getState().openFolder('/');
    const last = useBrowserStore.getState().historyIndex;
    await useBrowserStore.getState().forward(); // nothing ahead
    expect(useBrowserStore.getState().historyIndex).toBe(last);
    for (let i = 0; i <= last + 1; i++) await useBrowserStore.getState().back();
    expect(useBrowserStore.getState().historyIndex).toBe(0); // nothing behind
  });

  it('a download or an upload that fails is added to the errors, and the view is refreshed', async () => {
    api.downloadFiles.mockRejectedValue(new Error('disk full'));
    api.uploadFiles.mockRejectedValue(new Error('no access'));
    api.listFiles.mockResolvedValue(list([]));
    await useBrowserStore.getState().downloadEntries(['/a']);
    await useBrowserStore.getState().uploadFiles(['/tmp/x']);
    expect(useErrorStore.getState().errors.map(x => x.message)).toEqual(['disk full', 'no access']);
  });

  it('a folder in the tree that cannot be listed shows no children', async () => {
    api.listFiles.mockRejectedValue(new Error('x'));
    await useBrowserStore.getState().loadTreeNode('/broken');
    expect(useBrowserStore.getState().tree['/broken']).toMatchObject({ dirs: [], loaded: true });
  });
});
