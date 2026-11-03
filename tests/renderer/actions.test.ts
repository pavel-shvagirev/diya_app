import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as actions from '../../src/renderer/lib/actions.js';
import { dialogs } from '../../src/renderer/store/dialogStore.js';
import { useBrowserStore } from '../../src/renderer/store/browserStore.js';
import { dir, file, installApi, list } from './helpers.js';

let api: ReturnType<typeof installApi>;
const entry = (name: string, type: 'file' | 'dir' = 'file') => ({
  path: `/${name}`,
  name,
  type,
});

beforeEach(async () => {
  api = installApi();
  api.listFiles.mockResolvedValue(list([file('a.txt'), dir('D')]));
  useBrowserStore.setState(useBrowserStore.getInitialState(), true);
  await useBrowserStore.getState().openFolder('/');
  vi.restoreAllMocks();
});

describe('new folder and rename', () => {
  it('creates a folder with the name typed; cancel does nothing', async () => {
    const spy = vi
      .spyOn(dialogs, 'prompt')
      .mockResolvedValueOnce('New')
      .mockResolvedValueOnce(null);
    await actions.newFolder();
    expect(api.mkdir).toHaveBeenCalledWith('/New');
    await actions.newFolder();
    expect(api.mkdir).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].validate!('')).not.toBeNull();
  });

  it('validation texts cover every problem and accept a good name', async () => {
    const spy = vi.spyOn(dialogs, 'prompt').mockResolvedValue(null);
    await actions.newFolder();
    const validate = spy.mock.calls[0]![0].validate!;
    expect(validate('')).toBeTruthy();
    expect(validate('a/b')).toBeTruthy();
    expect(validate('..')).toBeTruthy();
    expect(validate('fine')).toBeNull();
  });

  it('rename keeps the old name when it was not changed', async () => {
    const spy = vi.spyOn(dialogs, 'prompt');
    spy.mockResolvedValueOnce('a.txt').mockResolvedValueOnce('b.txt').mockResolvedValueOnce(null);
    await actions.renameEntry(entry('a.txt'));
    expect(api.moveFile).not.toHaveBeenCalled();
    await actions.renameEntry(entry('a.txt'));
    expect(api.moveFile).toHaveBeenCalledWith('/a.txt', '/b.txt');
    await actions.renameEntry(entry('a.txt'));
    expect(api.moveFile).toHaveBeenCalledTimes(1);
  });
});

describe('delete, move, copy', () => {
  it('delete to trash asks first and does nothing for an empty selection', async () => {
    const confirm = vi
      .spyOn(dialogs, 'confirm')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    await actions.removeEntries([]);
    expect(confirm).not.toHaveBeenCalled();
    await actions.removeEntries([entry('a.txt')]);
    expect(api.deleteFile).toHaveBeenCalledWith('/a.txt', false);
    await actions.removeEntries([entry('b.txt')]);
    expect(api.deleteFile).toHaveBeenCalledTimes(1);
  });

  it('delete forever removes each item from the trash, tolerating failures', async () => {
    const confirm = vi
      .spyOn(dialogs, 'confirm')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    api.deleteFromTrash.mockRejectedValueOnce(new Error('gone')).mockResolvedValue(undefined);
    await actions.deleteForever([]);
    await actions.deleteForever([entry('x'), entry('y')]);
    expect(api.deleteFromTrash).toHaveBeenCalledTimes(2);
    await actions.deleteForever([entry('z')]);
    expect(api.deleteFromTrash).toHaveBeenCalledTimes(2);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('empty trash needs a confirmation', async () => {
    vi.spyOn(dialogs, 'confirm').mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await actions.emptyTrash();
    expect(api.emptyTrash).toHaveBeenCalled();
    api.emptyTrash.mockClear();
    await actions.emptyTrash();
    expect(api.emptyTrash).not.toHaveBeenCalled();
  });

  it('move and copy go to the folder picked; cancelling does nothing', async () => {
    vi.spyOn(dialogs, 'pickFolder')
      .mockResolvedValueOnce('/Dest')
      .mockResolvedValueOnce('/Dest')
      .mockResolvedValue(null);
    await actions.moveEntriesTo([entry('a.txt')]);
    expect(api.moveFile).toHaveBeenCalledWith('/a.txt', '/Dest/a.txt');
    await actions.copyEntriesTo([entry('a.txt')]);
    expect(api.copyFile).toHaveBeenCalledWith('/a.txt', '/Dest/a.txt');
    await actions.moveEntriesTo([entry('a.txt')]);
    await actions.copyEntriesTo([entry('a.txt')]);
    expect(api.moveFile).toHaveBeenCalledTimes(1);
    expect(api.copyFile).toHaveBeenCalledTimes(1);
  });
});

describe('open', () => {
  it('a folder opens, a file is downloaded', async () => {
    await actions.openEntry(entry('D', 'dir'));
    expect(api.listFiles).toHaveBeenLastCalledWith('/D');
    await actions.openEntry(entry('a.txt'));
    expect(api.downloadFiles).toHaveBeenCalledWith(['/a.txt']);
  });
});
