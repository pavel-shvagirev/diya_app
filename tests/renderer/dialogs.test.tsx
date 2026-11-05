import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DialogHost } from '../../src/renderer/components/DialogHost.js';
import { t } from '../../src/renderer/lib/strings.js';
import { useDialogStore, type DialogRequest } from '../../src/renderer/store/dialogStore.js';
import { dir, installApi, list } from './helpers.js';

let api: ReturnType<typeof installApi>;

const open = (d: DialogRequest): void => {
  act(() => useDialogStore.getState().show(d));
};

beforeEach(() => {
  api = installApi();
  useDialogStore.setState({ current: null });
});
afterEach(cleanup);

describe('prompt dialog', () => {
  const prompt = (resolve: (v: string | null) => void, validate?: (v: string) => string | null) =>
    open({
      kind: 'prompt',
      title: 'New',
      label: 'Name',
      initial: 'x',
      submit: 'Go',
      validate,
      resolve,
    });

  it('Cancel and the close button resolve null', () => {
    const out: (string | null)[] = [];
    prompt(v => out.push(v));
    const { rerender } = render(<DialogHost />);
    fireEvent.click(screen.getByText(t.cancel));
    expect(out).toEqual([null]);
    prompt(v => out.push(v));
    rerender(<DialogHost />);
    fireEvent.click(screen.getByLabelText(t.close));
    expect(out).toEqual([null, null]);
  });

  it('an invalid value is refused on submit and the error stays hidden until the user types', () => {
    const out: (string | null)[] = [];
    prompt(
      v => out.push(v),
      v => (v.trim() ? null : 'empty')
    );
    render(<DialogHost />);
    const input = screen.getByLabelText('Name');
    expect(screen.queryByText('empty')).toBeNull();
    fireEvent.change(input, { target: { value: ' ' } });
    expect(screen.getByText('empty')).toBeInTheDocument();
    fireEvent.submit(input.closest('form')!);
    expect(out).toEqual([]);
    fireEvent.focus(input);
  });
});

describe('confirm dialog', () => {
  const confirm = (resolve: (v: boolean) => void, danger = false) =>
    open({ kind: 'confirm', title: 'T', message: 'Sure?', submit: 'Yes', danger, resolve });

  it('Cancel and the backdrop resolve false; a plain confirm has no danger colour', () => {
    const out: boolean[] = [];
    confirm(v => out.push(v));
    render(<DialogHost />);
    expect((screen.getByText('Yes') as HTMLElement).style.background).toBe('');
    fireEvent.click(screen.getByText(t.cancel));
    expect(out).toEqual([false]);
  });

  it('a dangerous confirm is painted with the danger token', () => {
    confirm(() => {}, true);
    render(<DialogHost />);
    expect((screen.getByText('Yes') as HTMLElement).style.background).toBe('var(--ui-danger)');
    const overlay = document.querySelector('.overlay') as HTMLElement;
    fireEvent.mouseDown(overlay);
    expect(useDialogStore.getState().current).toBeNull();
  });
});

describe('folder dialog', () => {
  it('Cancel resolves null; typing a path is normalised on submit', () => {
    const out: (string | null)[] = [];
    api.listFiles.mockResolvedValue(list([]));
    open({
      kind: 'folder',
      title: 'Pick',
      submit: 'Choose',
      initial: '/',
      resolve: v => out.push(v),
    });
    render(<DialogHost />);
    fireEvent.change(screen.getByLabelText(t.chooseFolder), { target: { value: '/a/../b//c/.' } });
    fireEvent.click(screen.getByText('Choose'));
    expect(out).toEqual(['/a/b/c']);
    open({
      kind: 'folder',
      title: 'Pick',
      submit: 'Choose',
      initial: '/',
      resolve: v => out.push(v),
    });
    fireEvent.click(screen.getByText(t.cancel));
    expect(out.at(-1)).toBeNull();
  });

  it('the chevron opens and closes a folder without selecting it, and a failed listing shows a mark', async () => {
    api.listFiles.mockImplementation(async (p: string) => {
      if (p === '/') return list([dir('A'), dir('Broken')]);
      if (p === '/Broken') throw new Error('boom');
      return list([dir('B', '/A')]);
    });
    open({ kind: 'folder', title: 'Pick', submit: 'Choose', initial: '/', resolve: () => {} });
    const { container } = render(<DialogHost />);
    await screen.findByText('A');
    const chevron = (name: string): HTMLElement =>
      screen.getByText(name).closest('[role="treeitem"]')!.querySelector('.tree-chevron')!;
    fireEvent.click(chevron('A'));
    expect(await screen.findByText('B')).toBeInTheDocument();
    fireEvent.click(chevron('A'));
    await waitFor(() => expect(screen.queryByText('B')).toBeNull());
    expect(screen.getByText('A').closest('[role="treeitem"]')).toHaveAttribute(
      'aria-selected',
      'false'
    );
    fireEvent.click(chevron('Broken'));
    await waitFor(() => expect(container.querySelectorAll('svg').length).toBeGreaterThan(0));
    await waitFor(() => expect(api.listFiles).toHaveBeenCalledWith('/Broken'));
  });

  it('the ancestors of the preselected folder are opened', async () => {
    api.listFiles.mockImplementation(async (p: string) =>
      list(p === '/' ? [dir('A')] : p === '/A' ? [dir('B', '/A')] : [])
    );
    open({ kind: 'folder', title: 'Pick', submit: 'Choose', initial: '/A/B', resolve: () => {} });
    render(<DialogHost />);
    expect(await screen.findByText('B')).toBeInTheDocument();
  });
});

describe('share dialog', () => {
  const share = (resolve: (v: 'unshare' | null) => void) =>
    open({ kind: 'share', path: '/a.txt', url: 'https://yadi.sk/d/1', resolve });

  it('Close and the backdrop resolve null', () => {
    const out: ('unshare' | null)[] = [];
    share(v => out.push(v));
    render(<DialogHost />);
    fireEvent.click(screen.getByText(t.close, { selector: 'button.btn--outline' }));
    expect(out).toEqual([null]);
  });

  it('copies the link, shows that it did, and goes back after two seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      share(() => {});
      render(<DialogHost />);
      fireEvent.click(screen.getByText(t.copyLink));
      await act(async () => undefined);
      expect(writeText).toHaveBeenCalledWith('https://yadi.sk/d/1');
      expect(screen.getByText(t.copied)).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(screen.getByText(t.copyLink)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens the link in the system browser', () => {
    share(() => {});
    render(<DialogHost />);
    fireEvent.click(screen.getByText(t.openLink));
    expect(api.openExternal).toHaveBeenCalledWith('https://yadi.sk/d/1');
  });
});
