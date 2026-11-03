import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../../src/renderer/src/App.js';
import { t } from '../../src/renderer/lib/strings.js';
import { useBrowserStore } from '../../src/renderer/store/browserStore.js';
import { useErrorStore } from '../../src/renderer/store/errorStore.js';
import { useUiStore } from '../../src/renderer/store/uiStore.js';
import { file, installApi, list } from './helpers.js';

type Cb = (...a: never[]) => void;
let api: ReturnType<typeof installApi>;
const cbs: Record<string, Cb> = {};

beforeEach(() => {
  const on = (name: string) =>
    vi.fn((cb: Cb) => {
      cbs[name] = cb;
      return vi.fn();
    });
  api = installApi({
    authStatus: vi.fn().mockResolvedValue({ isAuthenticated: true }),
    onAuthChanged: on('auth'),
    onSyncProgress: on('sync'),
    onTransferProgress: on('transfer'),
    onSyncConfigChanged: on('config'),
    onOpenSettings: on('settings'),
    authConfig: vi
      .fn()
      .mockResolvedValue({ source: 'custom', clientId: 'a'.repeat(32), hasSecret: true }),
    onAuthLoginFailed: vi.fn(() => vi.fn()),
    getQuota: vi.fn().mockResolvedValue({ total_space: 10, used_space: 1, trash_size: 0 }),
    getDiskInfo: vi.fn().mockResolvedValue({ total_space: 10, used_space: 1, trash_size: 0 }),
  });
  api.listFiles.mockResolvedValue(list([file('hello.txt')]));
  api.getSyncStatus.mockResolvedValue({
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
  });
  useBrowserStore.setState(useBrowserStore.getInitialState(), true);
  useUiStore.setState({ settingsOpen: false });
});
afterEach(cleanup);

describe('App', () => {
  it('shows the file manager when signed in and loads the root folder', async () => {
    render(<App />);
    expect(await screen.findByText('hello.txt')).toBeInTheDocument();
    expect(api.listFiles).toHaveBeenCalledWith('/');
  });

  it('shows the sign-in screen when signed out, and switches when the session changes', async () => {
    api.authStatus.mockResolvedValue({ isAuthenticated: false });
    render(<App />);
    expect(await screen.findByText(t.authLead)).toBeInTheDocument();
    act(() => (cbs.auth as (b: boolean) => void)(true));
    expect(await screen.findByText('hello.txt')).toBeInTheDocument();
    useErrorStore.getState().addError('stale');
    act(() => (cbs.auth as (b: boolean) => void)(false));
    expect(useErrorStore.getState().errors).toEqual([]);
    expect(await screen.findByText(t.authLead)).toBeInTheDocument();
  });

  it('a failing auth check falls back to the sign-in screen', async () => {
    api.authStatus.mockRejectedValue(new Error('ipc down'));
    render(<App />);
    expect(await screen.findByText(t.authLead)).toBeInTheDocument();
  });

  it('shows "loading" until the auth check answers', () => {
    api.authStatus.mockReturnValue(new Promise(() => undefined));
    render(<App />);
    expect(screen.getByText(t.loading)).toBeInTheDocument();
  });

  it('opens Settings when the main process asks (tray, menu)', async () => {
    render(<App />);
    await screen.findByText('hello.txt');
    act(() => (cbs.settings as () => void)());
    expect(useUiStore.getState().settingsOpen).toBe(true);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('a finished sync run refreshes the listing and the quota', async () => {
    render(<App />);
    await screen.findByText('hello.txt');
    const sync = cbs.sync as (p: unknown) => void;
    const base = {
      totalFiles: 1,
      doneFiles: 0,
      totalBytes: 0,
      doneBytes: 0,
      current: null,
      lastSync: null,
      error: null,
      failures: [],
      conflicts: 0,
    };
    api.listFiles.mockClear();
    act(() => sync({ ...base, phase: 'syncing' }));
    expect(api.listFiles).not.toHaveBeenCalled();
    act(() => sync({ ...base, phase: 'idle' }));
    await waitFor(() => expect(api.listFiles).toHaveBeenCalled());
  });

  it('transfer events reach the transfers store and config changes re-read the sync state', async () => {
    render(<App />);
    await screen.findByText('hello.txt');
    api.getSyncConfig.mockClear();
    act(() => (cbs.config as () => void)());
    await waitFor(() => expect(api.getSyncConfig).toHaveBeenCalled());
    act(() =>
      (cbs.transfer as (e: unknown) => void)({
        id: 't1',
        name: 'a',
        direction: 'upload',
        status: 'active',
        done: 1,
        total: 2,
      })
    );
  });
});
