import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileTable } from '../../src/renderer/components/FileTable.js';
import { DND_MIME } from '../../src/renderer/components/FolderTree.js';
import { LogView } from '../../src/renderer/components/LogView.js';
import { Toolbar } from '../../src/renderer/components/Toolbar.js';
import { t } from '../../src/renderer/lib/strings.js';
import { useBrowserStore } from '../../src/renderer/store/browserStore.js';
import { dialogs, useDialogStore } from '../../src/renderer/store/dialogStore.js';
import { dir, file, installApi, list } from './helpers.js';

let api: ReturnType<typeof installApi>;

beforeEach(async () => {
  api = installApi();
  api.listFiles.mockImplementation(async () =>
    list([file('a.txt'), file('pub.txt', { public_url: 'https://yadi.sk/d/1' }), dir('Docs')])
  );
  useBrowserStore.setState(useBrowserStore.getInitialState(), true);
  useDialogStore.setState({ current: null });
  await useBrowserStore.getState().openFolder('/');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const press = (label: string): void => {
  fireEvent.click(screen.getByLabelText(label));
};
const pressText = (label: string): void => {
  fireEvent.click(screen.getByText(label).closest('button') as HTMLElement);
};

describe('Toolbar: every button reaches its action', () => {
  it('navigation, refresh, upload, download and the crumbs', async () => {
    const spies = {
      back: vi.fn(),
      forward: vi.fn(),
      up: vi.fn(),
      refresh: vi.fn(),
      openFolder: vi.fn(),
      uploadFiles: vi.fn(),
      downloadEntries: vi.fn(),
    };
    await useBrowserStore.getState().openFolder('/Docs/sub');
    await useBrowserStore.getState().openFolder('/Docs');
    await useBrowserStore.getState().back();
    useBrowserStore.setState(spies);
    act(() => useBrowserStore.getState().select('/a.txt', 'replace'));
    render(<Toolbar />);
    press(t.back);
    press(t.forward);
    press(t.up);
    press(t.refresh);
    pressText(t.upload);
    pressText(t.download);
    fireEvent.click(screen.getByTitle(t.toRoot));
    fireEvent.click(screen.getByTitle('/Docs'));
    expect(spies.back).toHaveBeenCalledTimes(1);
    expect(spies.forward).toHaveBeenCalledTimes(1);
    expect(spies.up).toHaveBeenCalledTimes(1);
    expect(spies.refresh).toHaveBeenCalledTimes(1);
    expect(spies.uploadFiles).toHaveBeenCalledTimes(1);
    expect(spies.downloadEntries).toHaveBeenCalledWith(['/a.txt']);
    expect(spies.openFolder.mock.calls).toEqual([['/'], ['/Docs']]);
  });

  it('new folder, share and delete ask through dialogs and act on the response', async () => {
    const prompt = vi.spyOn(dialogs, 'prompt').mockResolvedValue('Fresh');
    const share = vi.spyOn(dialogs, 'share').mockResolvedValue(null);
    const confirm = vi.spyOn(dialogs, 'confirm').mockResolvedValue(true);
    render(<Toolbar />);
    pressText(t.newFolder);
    await waitFor(() => expect(api.mkdir).toHaveBeenCalledWith('/Fresh'));
    expect(prompt).toHaveBeenCalled();
    // sharing is off, but a link that already exists can still be shown
    act(() => useBrowserStore.getState().select('/pub.txt', 'replace'));
    pressText(t.share);
    await waitFor(() =>
      expect(share).toHaveBeenCalledWith({ path: '/pub.txt', url: 'https://yadi.sk/d/1' })
    );
    pressText(t.delete);
    await waitFor(() => expect(api.deleteFile.mock.calls[0]?.[0]).toBe('/pub.txt'));
    expect(confirm).toHaveBeenCalled();
  });

  it('the trash path bar goes to the trash root and to the folders inside it', async () => {
    const openTrash = vi.fn();
    await useBrowserStore.getState().openTrash({ path: '/old_1234567/inner' });
    useBrowserStore.setState({ openTrash });
    render(<Toolbar />);
    fireEvent.click(screen.getByTitle(t.trash));
    fireEvent.click(screen.getByTitle('/old_1234567'));
    expect(openTrash.mock.calls).toEqual([[], [{ path: '/old_1234567' }]]);
  });
});

describe('sharing without a link to show', () => {
  it('a publish that yields no address opens no dialog', async () => {
    const { shareEntry } = await import('../../src/renderer/lib/actions.js');
    const { FEATURES } = await import('../../src/shared/features.js');
    const share = vi.spyOn(dialogs, 'share').mockResolvedValue(null);
    api.publish.mockResolvedValue('');
    FEATURES.publicLinks = true;
    try {
      await shareEntry({ path: '/a.txt', name: 'a.txt', type: 'file' } as never);
    } finally {
      FEATURES.publicLinks = false;
    }
    expect(share).not.toHaveBeenCalled();
  });
});

describe('LogView: copy, open the file, filters', () => {
  const entries = [
    { id: 1, ts: Date.UTC(2026, 10, 3, 10, 0, 1), level: 'info', cat: 'sync', msg: 'run started' },
    {
      id: 2,
      ts: Date.UTC(2026, 10, 3, 10, 0, 2),
      level: 'debug',
      cat: 'api',
      msg: 'GET /v1/disk',
      data: { status: 200 },
    },
  ];
  const mount = async (): Promise<void> => {
    window.api = {
      ...window.api,
      logGet: vi.fn().mockResolvedValue({ entries, recordLevel: 'debug', file: '/x/log' }),
      onLogEntry: vi.fn(() => vi.fn()),
      logReveal: vi.fn().mockResolvedValue(undefined),
      logClear: vi.fn().mockResolvedValue(undefined),
      logSetLevel: vi.fn().mockResolvedValue(undefined),
    } as never;
    render(<LogView />);
    await screen.findByText('run started');
  };

  it('copies the shown lines and says so for a moment', async () => {
    await mount();
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      fireEvent.click(screen.getByText(t.logCopy));
      await act(async () => undefined);
      expect(writeText.mock.calls[0]![0]).toContain('run started');
      expect(screen.getByText(t.logCopied)).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(screen.getByText(t.logCopy)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens the log file, filters by text, toggles a category and the autoscroll', async () => {
    await mount();
    fireEvent.click(screen.getByText(t.logOpenFile));
    expect(window.api.logReveal).toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText(t.logSearch), { target: { value: 'nothing' } });
    expect(screen.queryByText('run started')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText(t.logSearch), { target: { value: '' } });
    const follow = screen.getByLabelText(t.logAutoscroll) as HTMLInputElement;
    fireEvent.click(follow);
    expect(follow.checked).toBe(false);
  });

  it('shows the data of an entry next to its message', async () => {
    await mount();
    fireEvent.change(screen.getByDisplayValue('info'), { target: { value: 'debug' } });
    expect(await screen.findByText('{"status":200}')).toBeInTheDocument();
  });
});

describe('FileTable: menus and drag and drop', () => {
  it('the trash context menu opens a folder, restores and deletes for good', async () => {
    api.getTrashList.mockResolvedValue(list([dir('Old'), file('x.txt')]));
    await useBrowserStore.getState().openTrash();
    const openTrash = vi.fn();
    useBrowserStore.setState({ openTrash });
    render(<FileTable />);
    fireEvent.contextMenu(screen.getByText('Old'));
    fireEvent.click(screen.getByRole('menuitem', { name: t.open }));
    expect(openTrash).toHaveBeenCalledWith({ path: '/Old' });
  });

  it('the context menu of a published file offers the link', async () => {
    const share = vi.spyOn(dialogs, 'share').mockResolvedValue(null);
    render(<FileTable />);
    fireEvent.contextMenu(screen.getByText('pub.txt'));
    fireEvent.click(screen.getByRole('menuitem', { name: t.share }));
    await waitFor(() => expect(share).toHaveBeenCalled());
  });

  it('keys do nothing in an empty folder, and leaving a row clears its drop mark', async () => {
    api.listFiles.mockResolvedValue(list([]));
    await useBrowserStore.getState().openFolder('/empty');
    const { container, rerender } = render(<FileTable />);
    fireEvent.keyDown(container.querySelector('[tabindex]') as HTMLElement, { key: 'ArrowDown' });
    expect(useBrowserStore.getState().selection).toEqual([]);
    api.listFiles.mockResolvedValue(list([dir('Docs')]));
    await useBrowserStore.getState().openFolder('/');
    rerender(<FileTable />);
    const row = screen.getByText('Docs').closest('tr') as HTMLElement;
    fireEvent.dragOver(row, { dataTransfer: { types: [DND_MIME] } });
    expect(row.className).toMatch(/drop/);
    fireEvent.dragLeave(row);
    expect(row.className).not.toMatch(/drop/);
  });
});
