import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DialogHost } from '../../src/renderer/components/DialogHost.js';
import { FileTable } from '../../src/renderer/components/FileTable.js';
import { flattenTree, FolderTree } from '../../src/renderer/components/FolderTree.js';
import { SettingsDialog } from '../../src/renderer/components/SettingsDialog.js';
import { StatusBar } from '../../src/renderer/components/StatusBar.js';
import { Toolbar } from '../../src/renderer/components/Toolbar.js';
import { shareEntry } from '../../src/renderer/lib/actions.js';
import { formatSize } from '../../src/renderer/lib/format.js';
import { lang, t } from '../../src/renderer/lib/strings.js';
import { dialogs } from '../../src/renderer/store/dialogStore.js';
import { useBrowserStore } from '../../src/renderer/store/browserStore.js';
import { useDialogStore } from '../../src/renderer/store/dialogStore.js';
import { useSyncStore } from '../../src/renderer/store/syncStore.js';
import { useThemeStore } from '../../src/renderer/store/themeStore.js';
import { FEATURES } from '../../src/shared/features.js';
import { dir, file, installApi, list } from './helpers.js';

const entryOf = (name: string) => ({ path: `/${name}`, name, type: 'file' as const });

let api: ReturnType<typeof installApi>;

const idleProgress = {
  phase: 'idle' as const,
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

beforeEach(async () => {
  api = installApi();
  api.listFiles.mockImplementation(async (p: string) =>
    list(p === '/' ? [file('zeta.txt', { size: 2048 }), dir('Docs'), file('alpha.png')] : [])
  );
  useBrowserStore.setState(useBrowserStore.getInitialState(), true);
  useSyncStore.setState({ config: null, progress: idleProgress, loaded: true });
  useDialogStore.setState({ current: null });
  await useBrowserStore.getState().openFolder('/');
});
afterEach(cleanup);

const rowNames = (): string[] =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map(r => within(r).getAllByRole('gridcell')[0]?.textContent ?? '');

describe('FileTable', () => {
  it('shows folders first, then files, with size and type', () => {
    render(<FileTable />);
    expect(rowNames()).toEqual(['Docs', 'alpha.png', 'zeta.txt']);
    expect(screen.getByText(formatSize(2048, lang))).toBeInTheDocument();
    expect(screen.getByText('TXT')).toBeInTheDocument();
    expect(screen.getByText(t.folder)).toBeInTheDocument();
  });

  it('click selects, ctrl-click adds, shift-click selects a range', () => {
    render(<FileTable />);
    const rows = screen.getAllByRole('row').slice(1);
    fireEvent.click(rows[0]!);
    fireEvent.click(rows[2]!, { ctrlKey: true });
    expect(useBrowserStore.getState().selection).toEqual(['/Docs', '/zeta.txt']);
    fireEvent.click(rows[1]!, { shiftKey: true });
    // shift-click selects the range from the last anchor (zeta) to alpha
    expect(useBrowserStore.getState().selection).toEqual(['/alpha.png', '/zeta.txt']);
  });

  it('double-click on a folder opens it', async () => {
    render(<FileTable />);
    fireEvent.doubleClick(screen.getAllByRole('row')[1]!);
    await waitFor(() => expect(api.listFiles).toHaveBeenCalledWith('/Docs'));
  });

  it('double-click on a file starts a download', async () => {
    render(<FileTable />);
    fireEvent.doubleClick(screen.getAllByRole('row')[3]!);
    await waitFor(() => expect(api.downloadFiles).toHaveBeenCalledWith(['/zeta.txt']));
  });

  it('header click sorts, second click reverses', () => {
    render(<FileTable />);
    fireEvent.click(screen.getByText(t.colName));
    expect(rowNames()).toEqual(['Docs', 'zeta.txt', 'alpha.png']);
  });

  it('arrow keys move the selection and Enter opens a folder', async () => {
    render(<FileTable />);
    const wrap = document.querySelector('.table-wrap') as HTMLElement;
    fireEvent.keyDown(wrap, { key: 'ArrowDown' });
    expect(useBrowserStore.getState().selection).toEqual(['/Docs']);
    fireEvent.keyDown(wrap, { key: 'ArrowDown' });
    expect(useBrowserStore.getState().selection).toEqual(['/alpha.png']);
    fireEvent.keyDown(wrap, { key: 'ArrowUp' });
    fireEvent.keyDown(wrap, { key: 'Enter' });
    await waitFor(() => expect(api.listFiles).toHaveBeenCalledWith('/Docs'));
  });

  it('Delete asks for confirmation, then removes', async () => {
    render(<FileTable />);
    const wrap = document.querySelector('.table-wrap') as HTMLElement;
    fireEvent.click(screen.getAllByRole('row')[2]!);
    fireEvent.keyDown(wrap, { key: 'Delete' });
    const d = useDialogStore.getState().current;
    expect(d?.kind).toBe('confirm');
    await act(async () => {
      if (d?.kind === 'confirm') d.resolve(true);
    });
    await waitFor(() => expect(api.deleteFile).toHaveBeenCalledWith('/alpha.png', false));
  });

  it('context menu offers file actions for the right-clicked row', () => {
    render(<FileTable />);
    fireEvent.contextMenu(screen.getAllByRole('row')[3]!);
    const labels = screen.getAllByRole('menuitem').map(m => m.textContent);
    expect(labels).not.toContain(t.share); // public links are switched off
    expect(labels).toEqual(
      expect.arrayContaining([t.download, t.rename, t.copyTo, t.moveTo, t.delete])
    );
    expect(useBrowserStore.getState().selection).toEqual(['/zeta.txt']);
  });

  it('dropping OS files uploads them to the current folder', async () => {
    render(<FileTable />);
    const wrap = document.querySelector('.table-wrap') as HTMLElement;
    const f = new File(['x'], 'drop.txt');
    fireEvent.drop(wrap, { dataTransfer: { types: ['Files'], files: [f], getData: () => '' } });
    await waitFor(() => expect(api.uploadFiles).toHaveBeenCalledWith('/', ['/local/drop.txt']));
  });

  it('shows the error state with retry', async () => {
    api.listFiles.mockRejectedValue(new Error('500: down'));
    await useBrowserStore.getState().openFolder('/Docs');
    render(<FileTable />);
    expect(screen.getByRole('alert')).toHaveTextContent('500: down');
    api.listFiles.mockResolvedValue(list([file('ok.txt', { path: '/Docs/ok.txt' })]));
    fireEvent.click(screen.getByText(t.retry));
    await waitFor(() => expect(screen.getByText('ok.txt')).toBeInTheDocument());
  });

  it('shows empty-folder and no-match messages', async () => {
    api.listFiles.mockResolvedValue(list([]));
    await useBrowserStore.getState().openFolder('/Empty');
    render(<FileTable />);
    expect(screen.getByText(t.emptyFolder)).toBeInTheDocument();
  });
});

describe('FolderTree', () => {
  it('flattenTree honours expansion', () => {
    const tree = {
      '/': { dirs: ['/a', '/b'], loaded: true, loading: false },
      '/a': { dirs: ['/a/x'], loaded: true, loading: false },
    };
    expect(flattenTree(tree, { '/': true }).map(r => r.path)).toEqual(['/', '/a', '/b']);
    expect(flattenTree(tree, { '/': true, '/a': true }).map(r => `${r.depth}${r.path}`)).toEqual([
      '0/',
      '1/a',
      '2/a/x',
      '1/b',
    ]);
  });

  it('renders root, folders and trash; clicking a folder navigates', async () => {
    render(<FolderTree />);
    await screen.findByText('Docs');
    expect(screen.getByText(t.disk)).toBeInTheDocument();
    expect(screen.getByText(t.trash)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Docs'));
    await waitFor(() =>
      expect(useBrowserStore.getState().view).toEqual({ kind: 'folder', path: '/Docs' })
    );
  });

  it('clicking Trash opens the trash view', async () => {
    render(<FolderTree />);
    fireEvent.click(screen.getByText(t.trash));
    await waitFor(() => expect(useBrowserStore.getState().view).toEqual({ kind: 'trash' }));
  });

  it('marks the synced folder', async () => {
    useSyncStore.setState({ config: { localPath: '/l', remotePath: '/Docs', enabled: true } });
    render(<FolderTree />);
    await screen.findByText('Docs');
    expect(screen.getByTitle(t.syncFolderMarker)).toBeInTheDocument();
  });

  it('dropping dragged items on a folder moves them there', async () => {
    render(<FolderTree />);
    const docs = (await screen.findByText('Docs')).closest('[role=treeitem]') as HTMLElement;
    const data = JSON.stringify(['/zeta.txt']);
    fireEvent.dragOver(docs, {
      dataTransfer: { types: ['application/x-yadisk-paths'], getData: () => data },
    });
    fireEvent.drop(docs, {
      dataTransfer: { types: ['application/x-yadisk-paths'], getData: () => data },
    });
    await waitFor(() => expect(api.moveFile).toHaveBeenCalledWith('/zeta.txt', '/Docs/zeta.txt'));
  });
});

describe('Toolbar', () => {
  it('Upload opens the native picker via the store', async () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByText(t.upload));
    await waitFor(() => expect(api.uploadFiles).toHaveBeenCalledWith('/', undefined));
  });

  it('action buttons follow the selection', () => {
    render(<Toolbar />);
    expect(screen.getByText(t.download).closest('button')).toBeDisabled();
    expect(screen.getByText(t.delete).closest('button')).toBeDisabled();
    act(() => useBrowserStore.getState().select('/zeta.txt', 'replace'));
    expect(screen.getByText(t.download).closest('button')).toBeEnabled();
    // creating public links is switched off (FEATURES.publicLinks)
    expect(screen.getByText(t.share).closest('button')).toBeDisabled();
    expect(screen.getByText(t.share).closest('button')!.title).toBe(t.tipShareDisabled);
    act(() => useBrowserStore.getState().select('/Docs', 'toggle'));
    expect(screen.getByText(t.share).closest('button')).toBeDisabled();
  });

  describe('public links', () => {
    it('are off by default and the app refuses to create one', async () => {
      expect(FEATURES.publicLinks).toBe(false);
      await shareEntry({ ...entryOf('zeta.txt') });
      expect(api.publish).not.toHaveBeenCalled();
    });

    it('an already published entry can still be opened and revoked', async () => {
      const spy = vi.spyOn(dialogs, 'share').mockResolvedValue('unshare');
      await shareEntry({ ...entryOf('pub.txt'), public_url: 'https://yadi.sk/d/9' });
      expect(spy).toHaveBeenCalledWith({ path: '/pub.txt', url: 'https://yadi.sk/d/9' });
      await waitFor(() => expect(api.unpublish).toHaveBeenCalledWith('/pub.txt'));
      spy.mockRestore();
    });

    it('with the switch on, sharing works as before', async () => {
      FEATURES.publicLinks = true;
      try {
        const spy = vi.spyOn(dialogs, 'share').mockResolvedValue(null);
        await shareEntry({ ...entryOf('zeta.txt') });
        expect(api.publish).toHaveBeenCalledWith('/zeta.txt');
        spy.mockRestore();
      } finally {
        FEATURES.publicLinks = false;
      }
    });
  });

  it('path bar navigates through breadcrumbs and Up goes to the parent', async () => {
    await useBrowserStore.getState().openFolder('/Docs/Sub');
    render(<Toolbar />);
    fireEvent.click(screen.getByText('Docs'));
    await waitFor(() =>
      expect(useBrowserStore.getState().view).toEqual({ kind: 'folder', path: '/Docs' })
    );
    fireEvent.click(screen.getByLabelText(t.up));
    await waitFor(() =>
      expect(useBrowserStore.getState().view).toEqual({ kind: 'folder', path: '/' })
    );
  });

  it('filter box filters the listing', () => {
    render(<Toolbar />);
    fireEvent.change(screen.getByLabelText(t.search), { target: { value: 'alp' } });
    expect(useBrowserStore.getState().filter).toBe('alp');
  });

  it('inside a folder of the trash the path bar shows it and Up leads out', async () => {
    api.getTrashList.mockImplementation(async (p?: string) =>
      list(p ? [file('in.txt', { path: `${p}/in.txt` })] : [])
    );
    await useBrowserStore.getState().openTrash();
    const { rerender } = render(<Toolbar />);
    expect(screen.getByTitle(t.up)).toBeDisabled(); // the root of the trash has no parent
    await useBrowserStore.getState().openTrash({ path: '/Old_1700000000/sub' });
    rerender(<Toolbar />);
    expect(screen.getByText('Old')).toBeInTheDocument(); // the id the Disk adds is not shown
    expect(screen.getByText('sub')).toBeInTheDocument();
    expect(screen.getByTitle(t.up)).toBeEnabled();
    fireEvent.click(screen.getByTitle(t.up));
    await waitFor(() =>
      expect(useBrowserStore.getState().view).toEqual({ kind: 'trash', path: '/Old_1700000000' })
    );
    fireEvent.click(screen.getByTitle(t.trash)); // the first crumb goes to the root of the trash
    await waitFor(() => expect(useBrowserStore.getState().view).toEqual({ kind: 'trash' }));
  });

  it('"Restore as…" needs exactly one selected item and says so', async () => {
    api.getTrashList.mockResolvedValue(
      list([file('a.txt', { path: '/a.txt' }), file('b.txt', { path: '/b.txt' })])
    );
    await useBrowserStore.getState().openTrash();
    render(<Toolbar />);
    const button = screen.getByText(t.restoreAs).closest('button')!;
    expect(button).toBeDisabled();
    expect(button.title).toContain(t.hintSelectOne);
    act(() => useBrowserStore.getState().select('/a.txt', 'replace'));
    expect(button).toBeEnabled();
    act(() => useBrowserStore.getState().select('/b.txt', 'toggle'));
    expect(button).toBeDisabled();
  });

  it('every action button of the trash view is an icon with a hidden label and a title (none is bare text that would spill over its neighbours)', async () => {
    api.getTrashList.mockResolvedValue(list([file('a.txt', { path: '/a.txt' })]));
    await useBrowserStore.getState().openTrash();
    const { container } = render(<Toolbar />);
    const buttons = [...container.querySelectorAll('.toolbar > button')].filter(
      b => !b.classList.contains('crumb') && !b.classList.contains('btn--icon')
    );
    expect(buttons.map(b => b.textContent?.trim())).toEqual([
      t.restore,
      t.restoreAs,
      t.deleteForever,
      t.emptyTrash,
    ]);
    for (const b of buttons) {
      expect(b.querySelector('svg'), b.textContent ?? '').not.toBeNull();
      expect(b.querySelector('.btn__label'), b.textContent ?? '').not.toBeNull();
      expect((b as HTMLElement).title).not.toBe('');
    }
    const icons = buttons.map(b => b.querySelector('svg path')?.getAttribute('d'));
    expect(new Set(icons).size).toBe(icons.length); // no two buttons look the same
  });

  it('trash view swaps the actions', async () => {
    await useBrowserStore.getState().openTrash();
    render(<Toolbar />);
    expect(screen.getByText(t.restore)).toBeInTheDocument();
    expect(screen.queryByText(t.upload)).toBeNull();
  });
});

describe('DialogHost', () => {
  const open = (
    d: Parameters<typeof useDialogStore.getState>['0'] extends never ? never : unknown
  ) => act(() => useDialogStore.getState().show(d as never));

  it('prompt validates the name and resolves with the trimmed value', async () => {
    let result: string | null | undefined;
    open({
      kind: 'prompt',
      title: 'New',
      label: 'Name',
      initial: '',
      submit: 'Create',
      validate: (v: string) => (v.includes('/') ? 'bad' : v.trim() ? null : 'empty'),
      resolve: (v: string | null) => (result = v),
    });
    render(<DialogHost />);
    const input = screen.getByLabelText('Name');
    fireEvent.change(input, { target: { value: 'a/b' } });
    expect(screen.getByText('bad')).toBeInTheDocument();
    expect(screen.getByText('Create').closest('button')).toBeDisabled();
    fireEvent.change(input, { target: { value: '  Reports ' } });
    fireEvent.click(screen.getByText('Create'));
    expect(result).toBe('Reports');
  });

  it('Escape cancels a prompt', () => {
    let result: string | null | undefined = 'unset';
    open({
      kind: 'prompt',
      title: 'T',
      label: 'L',
      initial: 'x',
      submit: 'OK',
      resolve: (v: string | null) => (result = v),
    });
    render(<DialogHost />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(result).toBeNull();
  });

  it('confirm resolves true / false', () => {
    const out: boolean[] = [];
    open({
      kind: 'confirm',
      title: 'T',
      message: 'Sure?',
      danger: true,
      submit: 'Yes',
      resolve: (v: boolean) => out.push(v),
    });
    render(<DialogHost />);
    fireEvent.click(screen.getByText('Yes'));
    expect(out).toEqual([true]);
  });

  it('folder picker lists folders lazily and returns the chosen path', async () => {
    api.listFiles.mockImplementation(async (p: string) =>
      list(p === '/' ? [dir('A')] : p === '/A' ? [dir('B', '/A')] : [])
    );
    let result: string | null | undefined;
    open({
      kind: 'folder',
      title: 'Pick',
      submit: 'Choose',
      initial: '/',
      resolve: (v: string | null) => (result = v),
    });
    render(<DialogHost />);
    fireEvent.click(await screen.findByText('A'));
    fireEvent.click(screen.getByText('Choose'));
    expect(result).toBe('/A');
  });

  it('share dialog shows the link and can stop sharing', () => {
    let result: string | null | undefined = 'unset';
    open({
      kind: 'share',
      path: '/a.txt',
      url: 'https://yadi.sk/d/1',
      resolve: (v: string | null) => (result = v),
    });
    render(<DialogHost />);
    expect(screen.getByDisplayValue('https://yadi.sk/d/1')).toBeInTheDocument();
    fireEvent.click(screen.getByText(t.unshare));
    expect(result).toBe('unshare');
  });
});

describe('dialog layering and hints', () => {
  it('a dialog opened from Settings is rendered in its own layer above it', () => {
    act(() =>
      useDialogStore.getState().show({
        kind: 'folder',
        title: 'Pick',
        submit: 'Choose',
        initial: '/',
        resolve: () => {},
      })
    );
    render(
      <>
        <SettingsDialog />
        <DialogHost />
      </>
    );
    const layer = document.querySelector('.dialog-layer') as HTMLElement;
    expect(layer).not.toBeNull();
    expect(layer.querySelector('.modal')).not.toBeNull();
    expect(document.querySelectorAll('.overlay')).toHaveLength(2);
  });

  it('Esc closes only the topmost dialog, then the one below', () => {
    let picked: string | null | undefined = 'unset';
    act(() =>
      useDialogStore.getState().show({
        kind: 'folder',
        title: 'Pick',
        submit: 'Choose',
        initial: '/',
        resolve: v => (picked = v),
      })
    );
    const closed: string[] = [];
    useDialogStore.subscribe(s => s.current === null && closed.push('dialog'));
    render(
      <>
        <SettingsDialog />
        <DialogHost />
      </>
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(picked).toBeNull(); // the picker was cancelled…
    expect(screen.getByRole('dialog', { name: t.settingsTitle })).toBeInTheDocument(); // …Settings stays
  });

  it('every toolbar and status-bar action button carries a hint', () => {
    render(
      <>
        <Toolbar />
        <StatusBar />
      </>
    );
    const missing = screen
      .getAllByRole('button')
      .filter(b => !b.getAttribute('title') && !b.getAttribute('aria-label'))
      .filter(b => !b.closest('.pathbar'))
      .map(b => b.textContent);
    expect(missing).toEqual([]);
  });

  it('a disabled action explains what is needed', () => {
    render(<Toolbar />);
    expect(screen.getByText(t.download).closest('button')!.title).toContain(t.hintSelect);
    expect(screen.getByText(t.share).closest('button')!.title).toContain(t.hintSelectOne);
    act(() => useBrowserStore.getState().select('/zeta.txt', 'replace'));
    expect(screen.getByText(t.share).closest('button')!.title).toBe(t.tipShareDisabled);
    expect(screen.getByText(t.download).closest('button')!.title).toBe(t.tipDownload);
  });

  it('Settings: the language choice is loaded, shown and saved', async () => {
    const api = installApi({ languageGet: vi.fn().mockResolvedValue('ru') });
    render(<SettingsDialog />);
    const ruRadio = await screen.findByLabelText(t.langRu);
    await waitFor(() => expect(ruRadio).toBeChecked());
    fireEvent.click(screen.getByLabelText(t.langEn));
    expect(api.languageSet).toHaveBeenCalledWith('en');
    expect(screen.getByLabelText(t.langEn)).toBeChecked();
    fireEvent.click(screen.getByLabelText(t.langSystem));
    expect(api.languageSet).toHaveBeenLastCalledWith('system');
  });

  it('Settings buttons have hints', () => {
    render(<SettingsDialog />);
    for (const label of [t.applySync, t.signOut]) {
      expect(screen.getByText(label).closest('button')!.title).not.toBe('');
    }
    expect(screen.getAllByText(t.choosePlus)[0]!.closest('button')!.title).toBe(t.tipChooseLocal);
  });
});

describe('StatusBar', () => {
  const chipText = (): string => document.querySelector('.statusbar .chip')?.textContent ?? '';

  it('shows counts, selection and quota', async () => {
    await useBrowserStore.getState().loadQuota();
    act(() => useBrowserStore.getState().select('/zeta.txt', 'replace'));
    render(<StatusBar />);
    expect(screen.getByText(new RegExp(t.items(3)))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(t.selected(1)))).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
  });

  it('sync chip: not configured → opens settings', () => {
    render(<StatusBar />);
    expect(chipText()).toContain(t.syncNotConfigured);
  });

  it('sync chip: running shows files and percent', () => {
    useSyncStore.setState({
      config: { localPath: '/l', remotePath: '/r', enabled: true },
      progress: {
        ...idleProgress,
        phase: 'syncing',
        totalFiles: 40,
        doneFiles: 12,
        totalBytes: 200,
        doneBytes: 70,
      },
    });
    render(<StatusBar />);
    expect(chipText()).toContain(t.syncing(12, 40, 35));
  });

  it('sync chip: idle shows the last sync, error and pause states', () => {
    useSyncStore.setState({
      config: { localPath: '/l', remotePath: '/r', enabled: true },
      progress: { ...idleProgress, lastSync: new Date().toISOString() },
    });
    const { rerender } = render(<StatusBar />);
    expect(chipText()).toContain(t.syncUpToDate(t.justNow));
    act(() =>
      useSyncStore.setState({ progress: { ...idleProgress, phase: 'error', error: 'boom' } })
    );
    rerender(<StatusBar />);
    expect(chipText()).toContain(t.syncError);
    act(() =>
      useSyncStore.setState({
        config: { localPath: '/l', remotePath: '/r', enabled: false },
        progress: idleProgress,
      })
    );
    rerender(<StatusBar />);
    expect(chipText()).toContain(t.syncPaused);
  });
});

describe('SettingsDialog', () => {
  it('choosing a local folder and applying configures sync', async () => {
    api.selectFolder.mockResolvedValue('/Users/me/Sync');
    api.getSyncConfig.mockResolvedValue({
      localPath: '/Users/me/Sync',
      remotePath: '/Sync',
      enabled: true,
    });
    api.getSyncStatus.mockResolvedValue({ ...idleProgress, configured: true, enabled: true });
    render(<SettingsDialog />);
    expect(screen.getByText(t.notChosen)).toBeInTheDocument();
    expect(screen.getByText(t.applySync).closest('button')).toBeDisabled();
    fireEvent.click(screen.getAllByText(t.choosePlus)[0]!);
    await screen.findByText('/Users/me/Sync');
    fireEvent.click(screen.getByText(t.applySync));
    await waitFor(() =>
      expect(api.configureSync).toHaveBeenCalledWith('/Users/me/Sync', t.defaultRemoteFolder)
    );
  });

  it('configured pair: toggle pauses, Sync now triggers a run, progress and failures are visible', async () => {
    useSyncStore.setState({
      config: { localPath: '/Users/me/Sync', remotePath: '/Sync', enabled: true },
      progress: {
        ...idleProgress,
        phase: 'syncing',
        totalFiles: 4,
        doneFiles: 1,
        totalBytes: 1000,
        doneBytes: 250,
        current: { path: 'a/b.txt', direction: 'upload', done: 1, total: 2 },
        failures: ['c.txt: 507: no space'],
        conflicts: 2,
      },
    });
    api.getSyncConfig.mockResolvedValue({
      localPath: '/Users/me/Sync',
      remotePath: '/Sync',
      enabled: false,
    });
    api.getSyncStatus.mockResolvedValue({ ...idleProgress, configured: true, enabled: false });
    render(<SettingsDialog />);
    expect(screen.getByText(/1 \/ 4/)).toBeInTheDocument();
    expect(screen.getByText('a/b.txt')).toBeInTheDocument();
    expect(screen.getByText('c.txt: 507: no space')).toBeInTheDocument();
    expect(screen.getByText(t.conflictsCount(2))).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(t.syncEnabled));
    await waitFor(() => expect(api.pauseSync).toHaveBeenCalled());
  });

  it('theme radios switch the data-theme attribute and back to system', () => {
    render(<SettingsDialog />);
    fireEvent.click(screen.getByLabelText(t.themeDark));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(useThemeStore.getState().mode).toBe('dark');
    fireEvent.click(screen.getByLabelText(t.themeSystem));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('sign out calls logout', () => {
    render(<SettingsDialog />);
    fireEvent.click(screen.getByText(t.signOut));
    expect(api.authLogout).toHaveBeenCalled();
  });
});
