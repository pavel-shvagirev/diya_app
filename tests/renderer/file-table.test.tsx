import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileTable } from '../../src/renderer/components/FileTable.js';
import { t } from '../../src/renderer/lib/strings.js';
import { useBrowserStore } from '../../src/renderer/store/browserStore.js';
import { dialogs, useDialogStore } from '../../src/renderer/store/dialogStore.js';
import { dir, file, installApi, list } from './helpers.js';

let api: ReturnType<typeof installApi>;
const sel = () => useBrowserStore.getState().selection;
const table = () => screen.getByRole('grid').parentElement as HTMLElement;
const row = (path: string) => document.querySelector(`[data-path="${path}"]`) as HTMLElement;

beforeEach(async () => {
  api = installApi();
  api.listFiles.mockImplementation(async (p: string) =>
    list(p === '/' ? [file('zeta.txt'), dir('Docs'), file('alpha.png')] : [])
  );
  api.getTrashList.mockResolvedValue(list([file('old.txt', { path: '/old.txt' })]));
  useBrowserStore.setState(useBrowserStore.getInitialState(), true);
  useDialogStore.setState({ current: null });
  await useBrowserStore.getState().openFolder('/');
});
afterEach(cleanup);

// rows are shown as: Docs, alpha.png, zeta.txt
describe('keyboard', () => {
  it('arrows, Home/End and Shift extend the selection; Ctrl+A and Esc', () => {
    render(<FileTable />);
    const key = (k: string, extra = {}) => fireEvent.keyDown(table(), { key: k, ...extra });
    key('ArrowDown');
    expect(sel()).toEqual(['/Docs']);
    key('ArrowDown');
    expect(sel()).toEqual(['/alpha.png']);
    key('ArrowUp');
    expect(sel()).toEqual(['/Docs']);
    key('End');
    expect(sel()).toEqual(['/zeta.txt']);
    key('Home', { shiftKey: true });
    expect(sel().sort()).toEqual(['/Docs', '/alpha.png', '/zeta.txt']);
    key('Escape');
    expect(sel()).toEqual([]);
    key('a', { ctrlKey: true });
    expect(sel()).toHaveLength(3);
    key('A', { metaKey: true });
    expect(sel()).toHaveLength(3);
  });

  it('Enter opens a folder or downloads a file; F2 renames; Delete asks to delete', async () => {
    render(<FileTable />);
    act(() => useBrowserStore.getState().select('/Docs', 'replace'));
    fireEvent.keyDown(table(), { key: 'Enter' });
    await waitFor(() => expect(api.listFiles).toHaveBeenLastCalledWith('/Docs'));
    await act(() => useBrowserStore.getState().openFolder('/'));
    act(() => useBrowserStore.getState().select('/zeta.txt', 'replace'));
    fireEvent.keyDown(table(), { key: 'Enter' });
    await waitFor(() => expect(api.downloadFiles).toHaveBeenCalledWith(['/zeta.txt']));
    fireEvent.keyDown(table(), { key: 'F2' });
    await waitFor(() => expect(useDialogStore.getState().current?.kind).toBe('prompt'));
    act(() => useDialogStore.setState({ current: null }));
    fireEvent.keyDown(table(), { key: 'Delete' });
    await waitFor(() => expect(useDialogStore.getState().current?.kind).toBe('confirm'));
  });

  it('other keys and keys with nothing to act on are ignored', () => {
    render(<FileTable />);
    const e = new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true });
    table().dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    fireEvent.keyDown(table(), { key: 'Enter' }); // nothing selected
    fireEvent.keyDown(table(), { key: 'F2' });
    expect(useDialogStore.getState().current).toBeNull();
  });

  it('in the trash Delete means "delete forever" and Enter/F2 do nothing', async () => {
    await useBrowserStore.getState().openTrash();
    render(<FileTable />);
    act(() => useBrowserStore.getState().select('/old.txt', 'replace'));
    fireEvent.keyDown(table(), { key: 'Enter' });
    fireEvent.keyDown(table(), { key: 'F2' });
    expect(useDialogStore.getState().current).toBeNull();
    fireEvent.keyDown(table(), { key: 'Backspace' });
    await waitFor(() => expect(useDialogStore.getState().current?.kind).toBe('confirm'));
  });
});

describe('selection and sorting', () => {
  it('click, Ctrl-click and Shift-click select; clicking the empty area clears', () => {
    render(<FileTable />);
    fireEvent.click(row('/Docs'));
    fireEvent.click(row('/zeta.txt'), { ctrlKey: true });
    expect(sel().sort()).toEqual(['/Docs', '/zeta.txt']);
    fireEvent.click(row('/alpha.png'), { shiftKey: true });
    expect(sel()).toContain('/alpha.png');
    fireEvent.click(table());
    expect(sel()).toEqual([]);
  });

  it('a header click sorts and sets aria-sort', () => {
    render(<FileTable />);
    const nameHeader = screen.getByRole('columnheader', { name: new RegExp(t.colName) });
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');
    fireEvent.click(nameHeader);
    expect(nameHeader).toHaveAttribute('aria-sort', 'descending');
    fireEvent.click(screen.getByRole('columnheader', { name: new RegExp(t.colSize) }));
    expect(useBrowserStore.getState().sortBy).toBe('size');
  });
});

describe('states', () => {
  it('shows the empty folder / no matches / empty trash messages', async () => {
    api.listFiles.mockResolvedValue(list([]));
    await useBrowserStore.getState().openFolder('/Empty');
    const { rerender } = render(<FileTable />);
    expect(screen.getByText(t.emptyFolder)).toBeInTheDocument();
    act(() => useBrowserStore.getState().setFilter('zzz'));
    rerender(<FileTable />);
    expect(screen.getByText(t.noMatches)).toBeInTheDocument();
    act(() => useBrowserStore.getState().setFilter(''));
    api.getTrashList.mockResolvedValue(list([]));
    await useBrowserStore.getState().openTrash();
    rerender(<FileTable />);
    expect(screen.getByText(t.emptyTrashMsg)).toBeInTheDocument();
  });

  it('shows a load error with retry and, inside a folder, a way back to the root', async () => {
    api.listFiles.mockRejectedValue(new Error('503: down'));
    await useBrowserStore.getState().openFolder('/Docs');
    render(<FileTable />);
    expect(screen.getByRole('alert')).toHaveTextContent('503: down');
    api.listFiles.mockResolvedValue(list([file('x')]));
    fireEvent.click(screen.getByText(t.toRoot));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('retry reloads; the root has no "to root" button', async () => {
    api.listFiles.mockRejectedValue(new Error('boom'));
    await useBrowserStore.getState().openFolder('/');
    render(<FileTable />);
    expect(screen.queryByText(t.toRoot)).toBeNull();
    api.listFiles.mockResolvedValue(list([file('back.txt')]));
    fireEvent.click(screen.getByText(t.retry));
    await screen.findByText('back.txt');
  });

  it('shows a spinner while the first load is in progress', () => {
    useBrowserStore.setState({ entries: [], loading: true, error: null });
    render(<FileTable />);
    expect(screen.getByText(t.loading)).toBeInTheDocument();
  });
});

describe('context menu', () => {
  const labels = () => screen.getAllByRole('menuitem').map(m => m.textContent);

  it('a folder offers Open and Download; a multi-selection offers Download', async () => {
    render(<FileTable />);
    fireEvent.contextMenu(row('/Docs'));
    expect(labels()).toEqual(expect.arrayContaining([t.open, t.download, t.rename]));
    fireEvent.click(screen.getByText(t.download));
    await waitFor(() => expect(api.downloadFiles).toHaveBeenCalledWith(['/Docs']));
    act(() => {
      useBrowserStore.getState().select('/Docs', 'replace');
      useBrowserStore.getState().select('/zeta.txt', 'toggle');
    });
    fireEvent.contextMenu(row('/zeta.txt'));
    expect(labels()).not.toContain(t.rename);
    fireEvent.click(screen.getByText(t.download));
    await waitFor(() =>
      expect(api.downloadFiles).toHaveBeenLastCalledWith(
        expect.arrayContaining(['/Docs', '/zeta.txt'])
      )
    );
  });

  it('menu items run their actions (rename, copy, move, delete, open)', async () => {
    render(<FileTable />);
    for (const [label, kind] of [
      [t.rename, 'prompt'],
      [t.copyTo, 'folder'],
      [t.moveTo, 'folder'],
      [t.delete, 'confirm'],
    ] as const) {
      fireEvent.contextMenu(row('/zeta.txt'));
      fireEvent.click(within(screen.getByRole('menu')).getByText(label));
      await waitFor(() => expect(useDialogStore.getState().current?.kind).toBe(kind));
      act(() => useDialogStore.setState({ current: null }));
    }
    fireEvent.contextMenu(row('/Docs'));
    fireEvent.click(within(screen.getByRole('menu')).getByText(t.open));
    await waitFor(() => expect(api.listFiles).toHaveBeenLastCalledWith('/Docs'));
  });

  it('the empty area has no menu until something is selected', () => {
    render(<FileTable />);
    fireEvent.contextMenu(table());
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('in the trash: restore and delete forever', async () => {
    await useBrowserStore.getState().openTrash();
    render(<FileTable />);
    fireEvent.contextMenu(row('/old.txt'));
    expect(labels()).toEqual([t.restore, t.restoreAs, t.deleteForever]);
    fireEvent.click(screen.getByText(t.restore));
    await waitFor(() => expect(api.restoreFromTrash).toHaveBeenCalledWith('/old.txt'));
    fireEvent.contextMenu(row('/old.txt'));
    fireEvent.click(screen.getByText(t.deleteForever));
    await waitFor(() => expect(useDialogStore.getState().current?.kind).toBe('confirm'));
  });
});

describe('folders in the trash', () => {
  const labels = () => screen.getAllByRole('menuitem').map(m => m.textContent);

  beforeEach(() => {
    api.getTrashList.mockImplementation(async (p?: string) =>
      list(
        p === '/Old_1'
          ? [file('in.txt', { path: '/Old_1/in.txt' })]
          : [
              dir('Old_1'),
              file('old.txt', { path: '/old.txt' }),
              file('two.txt', { path: '/two.txt' }),
            ]
      )
    );
  });

  it('double-click opens a folder and leaves a file alone', async () => {
    await useBrowserStore.getState().openTrash();
    render(<FileTable />);
    fireEvent.doubleClick(row('/old.txt'));
    expect(api.getTrashList).toHaveBeenCalledTimes(1);
    fireEvent.doubleClick(row('/Old_1'));
    await waitFor(() =>
      expect(useBrowserStore.getState().view).toEqual({ kind: 'trash', path: '/Old_1' })
    );
  });

  it('Enter opens the selected folder', async () => {
    await useBrowserStore.getState().openTrash();
    render(<FileTable />);
    fireEvent.click(row('/Old_1'));
    fireEvent.keyDown(table(), { key: 'Enter' });
    await waitFor(() =>
      expect(useBrowserStore.getState().view).toEqual({ kind: 'trash', path: '/Old_1' })
    );
  });

  it('"Restore as…" is offered for one item only, and restores under the name given', async () => {
    await useBrowserStore.getState().openTrash();
    render(<FileTable />);
    fireEvent.click(row('/old.txt'));
    fireEvent.click(row('/two.txt'), { ctrlKey: true });
    fireEvent.contextMenu(row('/old.txt'));
    expect(labels()).toEqual([t.restore, t.deleteForever]);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.click(row('/old.txt'));
    vi.spyOn(dialogs, 'prompt').mockResolvedValue('again.txt');
    fireEvent.contextMenu(row('/old.txt'));
    fireEvent.click(screen.getByText(t.restoreAs));
    await waitFor(() => expect(api.restoreFromTrash).toHaveBeenCalledWith('/old.txt', 'again.txt'));
  });
});

describe('drag and drop', () => {
  const dt = (over: Record<string, unknown> = {}) => ({
    types: [] as string[],
    files: [] as unknown[],
    data: {} as Record<string, string>,
    effectAllowed: '',
    setData(k: string, v: string) {
      this.data[k] = v;
      this.types.push(k);
    },
    getData(k: string) {
      return this.data[k] ?? '';
    },
    ...over,
  });

  it('dragging rows onto a folder row moves them there', async () => {
    render(<FileTable />);
    const transfer = dt();
    fireEvent.dragStart(row('/zeta.txt'), { dataTransfer: transfer });
    expect(sel()).toEqual(['/zeta.txt']);
    expect(Object.keys(transfer.data)).toHaveLength(1);
    fireEvent.dragOver(row('/Docs'), { dataTransfer: transfer });
    expect(row('/Docs').className).toContain('row--drop');
    fireEvent.drop(row('/Docs'), { dataTransfer: transfer });
    await waitFor(() => expect(api.moveFile).toHaveBeenCalledWith('/zeta.txt', '/Docs/zeta.txt'));
  });

  it('dragging a selected row drags the whole selection; files are not drop targets', () => {
    render(<FileTable />);
    act(() => useBrowserStore.getState().selectAll());
    const transfer = dt();
    fireEvent.dragStart(row('/zeta.txt'), { dataTransfer: transfer });
    expect(
      JSON.parse(
        transfer.data['application/x-yadisk-paths'] ??
          transfer.data[Object.keys(transfer.data)[0]!]!
      )
    ).toHaveLength(3);
    fireEvent.dragOver(row('/alpha.png'), { dataTransfer: transfer });
    expect(row('/alpha.png').className).not.toContain('row--drop');
    fireEvent.drop(row('/alpha.png'), { dataTransfer: transfer });
    expect(api.moveFile).not.toHaveBeenCalled();
  });

  it('dropping OS files uploads them; the drop zone shows while dragging over', async () => {
    render(<FileTable />);
    const files = [{ name: 'a.bin' }, { name: 'b.bin' }];
    const transfer = dt({ types: ['Files'], files });
    fireEvent.dragOver(table(), { dataTransfer: transfer });
    expect(screen.getByText(t.dropToUpload)).toBeInTheDocument();
    fireEvent.dragLeave(table(), { dataTransfer: transfer, relatedTarget: document.body });
    expect(screen.queryByText(t.dropToUpload)).toBeNull();
    fireEvent.dragOver(table(), { dataTransfer: transfer });
    fireEvent.drop(table(), { dataTransfer: transfer });
    await waitFor(() =>
      expect(api.uploadFiles).toHaveBeenCalledWith('/', ['/local/a.bin', '/local/b.bin'])
    );
  });

  it('non-file drags are ignored, and nothing uploads into the trash', async () => {
    render(<FileTable />);
    fireEvent.dragOver(table(), { dataTransfer: dt() });
    expect(screen.queryByText(t.dropToUpload)).toBeNull();
    fireEvent.drop(table(), { dataTransfer: dt() });
    expect(api.uploadFiles).not.toHaveBeenCalled();
    await useBrowserStore.getState().openTrash();
    cleanup();
    render(<FileTable />);
    fireEvent.dragOver(table(), { dataTransfer: dt({ types: ['Files'] }) });
    expect(screen.queryByText(t.dropToUpload)).toBeNull();
    fireEvent.drop(table(), { dataTransfer: dt({ types: ['Files'], files: [{ name: 'x' }] }) });
    expect(api.uploadFiles).not.toHaveBeenCalled();
  });
});

vi.stubGlobal('CSS', { escape: (s: string) => s });
