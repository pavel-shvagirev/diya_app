import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FolderTree } from '../../src/renderer/components/FolderTree.js';
import { StatusBar } from '../../src/renderer/components/StatusBar.js';
import { t } from '../../src/renderer/lib/strings.js';
import { useBrowserStore } from '../../src/renderer/store/browserStore.js';
import { useSyncStore } from '../../src/renderer/store/syncStore.js';
import { useTransferStore } from '../../src/renderer/store/transferStore.js';
import { useUiStore } from '../../src/renderer/store/uiStore.js';
import { dir, installApi, list } from './helpers.js';

const idle = {
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
const config = { localPath: '/l', remotePath: '/r', enabled: true };

beforeEach(() => {
  installApi();
  useBrowserStore.setState(useBrowserStore.getInitialState(), true);
  useSyncStore.setState({ config: null, progress: idle, loaded: true });
  useTransferStore.setState({ transfers: [] });
});
afterEach(cleanup);

const chip = (): string => document.querySelector('.statusbar .chip')?.textContent ?? '';

describe('StatusBar sync chip', () => {
  it('scanning, never synced, and byte-less progress', () => {
    useSyncStore.setState({ config, progress: { ...idle, phase: 'scanning' } });
    const { rerender } = render(<StatusBar />);
    expect(chip()).toContain(t.syncScanning);

    act(() => useSyncStore.setState({ progress: { ...idle, lastSync: null } }));
    rerender(<StatusBar />);
    expect(chip()).toContain(t.syncNever);

    // only folders to create: no bytes, progress falls back to the file count
    act(() =>
      useSyncStore.setState({
        progress: { ...idle, phase: 'syncing', totalFiles: 4, doneFiles: 1 },
      })
    );
    rerender(<StatusBar />);
    expect(chip()).toContain(t.syncing(1, 4, 25));
  });

  it('shows the failure count after a run and the details in the hint', () => {
    useSyncStore.setState({
      config,
      progress: { ...idle, failures: ['a: boom', 'b: boom'], error: null },
    });
    render(<StatusBar />);
    expect(chip()).toContain(t.syncFailures(2));
    expect(document.querySelector('.statusbar .chip')!.getAttribute('title')).toContain(
      `${t.failuresTitle}: 2`
    );
  });

  it('puts the file being transferred into the hint', () => {
    useSyncStore.setState({
      config,
      progress: {
        ...idle,
        phase: 'syncing',
        totalFiles: 2,
        totalBytes: 10,
        doneBytes: 1,
        current: { path: 'dir/big.bin', direction: 'upload', done: 1, total: 10 },
      },
    });
    render(<StatusBar />);
    expect(document.querySelector('.statusbar .chip')!.getAttribute('title')).toContain(
      'dir/big.bin'
    );
  });

  it('clicking the chip opens Settings', () => {
    render(<StatusBar />);
    fireEvent.click(document.querySelector('.statusbar .chip')!);
    expect(useUiStore.getState().settingsOpen).toBe(true);
  });

  it('refreshes the relative time every 30 s', () => {
    vi.useFakeTimers();
    try {
      useSyncStore.setState({ config, progress: { ...idle, lastSync: new Date().toISOString() } });
      render(<StatusBar />);
      expect(chip()).toContain(t.justNow);
      act(() => {
        vi.advanceTimersByTime(30_000 * 3);
      });
      expect(chip()).not.toBe('');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('StatusBar transfer chip', () => {
  const ev = (over: Record<string, unknown>) => ({
    id: 'x',
    name: 'file.bin',
    direction: 'upload' as const,
    done: 5,
    total: 10,
    status: 'active' as const,
    ...over,
  });

  it('is hidden with no transfers', () => {
    render(<StatusBar />);
    expect(screen.queryByRole('dialog', { name: t.transfers })).toBeNull();
    expect(document.querySelectorAll('.statusbar .chip')).toHaveLength(1);
  });

  it('counts active uploads / downloads, then failures, then "done"', () => {
    act(() => useTransferStore.getState().apply(ev({})));
    const { rerender } = render(<StatusBar />);
    expect(document.body.textContent).toContain(`${t.uploading}: 1`);

    act(() => useTransferStore.getState().apply(ev({ id: 'y', direction: 'download' })));
    act(() => useTransferStore.getState().apply(ev({ id: 'x', status: 'done' })));
    rerender(<StatusBar />);
    expect(document.body.textContent).toContain(`${t.downloading}: 1`);

    act(() =>
      useTransferStore.getState().apply(ev({ id: 'y', status: 'error', error: 'no space' }))
    );
    rerender(<StatusBar />);
    expect(document.body.textContent).toContain(`${t.transferFailed}: 1`);
    expect(document.querySelector('.chip--error')).not.toBeNull();

    act(() => useTransferStore.getState().apply(ev({ id: 'y', status: 'done' })));
    rerender(<StatusBar />);
    expect(document.body.textContent).toContain(t.transferDone);
  });

  it('the popover lists transfers with progress, errors, and clears the finished', () => {
    act(() => {
      useTransferStore.getState().apply(ev({ id: 'a', name: 'busy.bin' }));
      useTransferStore.getState().apply(ev({ id: 'b', name: 'ok.bin', status: 'done' }));
      useTransferStore
        .getState()
        .apply(ev({ id: 'c', name: 'bad.bin', status: 'error', error: 'disk full' }));
    });
    render(<StatusBar />);
    fireEvent.click(document.querySelectorAll('.statusbar .chip')[0]!);
    const pop = screen.getByRole('dialog', { name: t.transfers });
    expect(within(pop).getByText('50%')).toBeInTheDocument();
    expect(within(pop).getByText('disk full')).toBeInTheDocument();
    expect(within(pop).getAllByText(t.transferDone).length).toBeGreaterThan(0);
    fireEvent.click(within(pop).getByText(t.clearFinished));
    expect(useTransferStore.getState().transfers.map(x => x.id)).toEqual(['a']);
    fireEvent.click(document.querySelectorAll('.statusbar .chip')[0]!);
    expect(screen.queryByRole('dialog', { name: t.transfers })).toBeNull();
  });
});

describe('FolderTree keyboard', () => {
  beforeEach(async () => {
    const api = installApi();
    api.listFiles.mockImplementation(async (p: string) =>
      list(p === '/' ? [dir('Docs'), dir('Music')] : p === '/Docs' ? [dir('Sub', '/Docs')] : [])
    );
    await useBrowserStore.getState().openFolder('/');
  });

  const press = (key: string): Promise<void> =>
    act(async () => {
      fireEvent.keyDown(document.querySelector('.tree')!, { key });
      await Promise.resolve();
    });
  const selectedLabel = (): string =>
    document.querySelector('.tree-item--selected .tree-item__label')?.textContent ?? '';

  it('arrows move the cursor, Enter opens, Right/Left expand and collapse', async () => {
    render(<FolderTree />);
    await screen.findByText('Docs');
    await press('ArrowDown'); // cursor: Docs
    await press('Enter');
    await vi.waitFor(() =>
      expect(useBrowserStore.getState().view).toMatchObject({ path: '/Docs' })
    );
    expect(selectedLabel()).toBe('Docs');

    await press('ArrowRight'); // expand
    await screen.findByText('Sub');
    await press('ArrowRight'); // already open: step into it
    await press('Enter');
    await vi.waitFor(() =>
      expect(useBrowserStore.getState().view).toMatchObject({ path: '/Docs/Sub' })
    );

    await press('ArrowLeft'); // an open leaf folder collapses first…
    await press('ArrowLeft'); // …then the cursor goes to the parent
    await press('Enter');
    await vi.waitFor(() =>
      expect(useBrowserStore.getState().view).toMatchObject({ path: '/Docs' })
    );
    await press('ArrowLeft'); // collapse Docs
    await vi.waitFor(() => expect(screen.queryByText('Sub')).toBeNull());
    await press('ArrowUp');
    await press('ArrowUp'); // stays on the first row
    await press('Home'); // unknown key is ignored
  });

  it('keyboard reaches the trash and does not expand it', async () => {
    render(<FolderTree />);
    await screen.findByText('Docs');
    for (let i = 0; i < 6; i++) await press('ArrowDown');
    await press('ArrowRight');
    await press('ArrowLeft');
    await press('Enter');
    await vi.waitFor(() => expect(useBrowserStore.getState().view.kind).toBe('trash'));
  });

  it('the chevron expands a folder without opening it', async () => {
    render(<FolderTree />);
    await screen.findByText('Docs');
    const chevron = document.querySelectorAll('.tree-chevron')[1]!;
    fireEvent.click(chevron);
    await screen.findByText('Sub');
    expect(useBrowserStore.getState().view).toMatchObject({ path: '/' });
  });
});
