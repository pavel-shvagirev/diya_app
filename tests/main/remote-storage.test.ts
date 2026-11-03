import { beforeEach, describe, expect, it, vi } from 'vitest';

const transfer = vi.hoisted(() => ({ uploadFile: vi.fn(), downloadFile: vi.fn() }));
vi.mock('../../src/main/transfer.js', () => transfer);

import { YandexRemote } from '../../src/main/remote-storage.js';

const client = {
  listFiles: vi.fn(),
  getMeta: vi.fn(),
  mkdir: vi.fn().mockResolvedValue(undefined),
  deleteFile: vi.fn().mockResolvedValue(undefined),
};
const remote = new YandexRemote(client as never);

beforeEach(() => vi.clearAllMocks());

describe('YandexRemote', () => {
  it('lists a folder as RemoteEntry values (dir flag, md5, defaults for missing fields)', async () => {
    client.listFiles.mockResolvedValue({
      items: [
        { type: 'dir', name: 'sub', path: '/Sync/sub' },
        {
          type: 'file',
          name: 'a.txt',
          path: '/Sync/a.txt',
          size: 3,
          modified: '2026-01-01T00:00:00+00:00',
          md5: 'abc',
        },
      ],
    });
    expect(await remote.list('/Sync')).toEqual([
      { path: '/Sync/sub', name: 'sub', isDir: true, size: 0, modified: '', md5: undefined },
      {
        path: '/Sync/a.txt',
        name: 'a.txt',
        isDir: false,
        size: 3,
        modified: '2026-01-01T00:00:00+00:00',
        md5: 'abc',
      },
    ]);
    expect(client.listFiles).toHaveBeenCalledWith('/Sync');
  });

  it('stat reads the metadata of one path', async () => {
    client.getMeta.mockResolvedValue({
      type: 'file',
      name: 'a',
      path: '/a',
      size: 1,
      modified: 'm',
    });
    expect(await remote.stat('/a')).toMatchObject({ path: '/a', isDir: false, size: 1 });
  });

  it('mkdir and remove (to the trash, never permanently) go to the client', async () => {
    await remote.mkdir('/x');
    await remote.remove('/x/a');
    expect(client.mkdir).toHaveBeenCalledWith('/x');
    expect(client.deleteFile).toHaveBeenCalledWith('/x/a', false);
  });

  it('upload and download delegate to the transfer layer with the progress callback', async () => {
    const cb = vi.fn();
    const mtime = new Date(0);
    await remote.upload('/l/a', '/r/a', true, cb);
    expect(transfer.uploadFile).toHaveBeenCalledWith(client, '/l/a', '/r/a', true, cb);
    const expected = { size: 3, md5: 'abc' };
    await remote.download('/r/a', '/l/a', cb, mtime, expected);
    expect(transfer.downloadFile).toHaveBeenCalledWith(client, '/r/a', '/l/a', cb, mtime, expected);
  });
});
