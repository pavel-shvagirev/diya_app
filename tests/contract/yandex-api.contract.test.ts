/**
 * The client against the official response examples (see official-examples.ts). If the Disk's
 * documented shapes and our reading of them drift apart, this is where it shows.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { YandexApiError } from '../../src/main/api-error.js';
import { YandexDiskClient } from '../../src/main/yandex-api.js';
import {
  DISK,
  DOWNLOAD_LINK,
  ERROR_OBJECT,
  FILES_RESOURCE_LIST,
  OPERATION_FAILED,
  OPERATION_IN_PROGRESS,
  OPERATION_LINK_PATH,
  OPERATION_LINK_QUERY,
  OPERATION_SUCCESS,
  RESOURCE_FILE,
  RESOURCE_FOLDER,
  RESOURCE_LINK,
  TRASH_RESOURCE,
  UPLOAD_LINK,
} from './official-examples.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const reply = (status: number, body?: unknown) => ({
  ok: status < 400,
  status,
  headers: new Headers(),
  json: () => (body === undefined ? Promise.reject(new Error('no body')) : Promise.resolve(body)),
});

const client = () => new YandexDiskClient('tok', { baseDelay: 1, pollInterval: 1, minInterval: 0 });

beforeEach(() => mockFetch.mockReset());

describe('Resource', () => {
  it('a file: every documented field we use is read as documented', async () => {
    mockFetch.mockResolvedValueOnce(reply(200, RESOURCE_FILE));
    expect(await client().getMeta('/foo/photo.png')).toEqual({
      type: 'file',
      name: 'photo.png',
      path: '/foo/photo.png', // `disk:/foo/photo.png`
      href: '',
      size: 34567,
      modified: '2014-04-21T14:57:14+04:00',
      md5: '4334dc6379c8f95ddf11b8508cfea271',
      mime_type: 'application/x-www-form-urlencoded',
      thumbnail_href: undefined,
      public_url: 'https://yadi.sk/d/AaaBbb1122Ccc',
      is_folder: false,
    });
  });

  it('the preview link of an image is the thumbnail', async () => {
    mockFetch.mockResolvedValueOnce(
      reply(200, { ...RESOURCE_FILE, preview: 'https://downloader.disk.yandex.ru/preview/...' })
    );
    expect((await client().getMeta('/foo/photo.png')).thumbnail_href).toBe(
      'https://downloader.disk.yandex.ru/preview/...'
    );
  });

  it('a folder listing is read from _embedded (a ResourceList): folders first, as documented', async () => {
    mockFetch.mockResolvedValueOnce(reply(200, RESOURCE_FOLDER));
    const list = await client().listFiles('/foo');
    expect(list.total).toBe(3);
    expect(list.items.map(i => [i.type, i.path])).toEqual([
      ['dir', '/foo/Photos'],
      ['file', '/foo/photo.png'],
      ['file', '/foo/notes.txt'],
    ]);
    expect(list.items[0]!.is_folder).toBe(true);
    // limit and offset are sent; `path` is URL-encoded.
    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://cloud-api.yandex.net/v1/disk/resources?path=%2Ffoo&limit=200&offset=0'
    );
  });

  it('pages are read until `total` is reached', async () => {
    const page = (items: unknown[], total: number) =>
      reply(200, { ...RESOURCE_FOLDER, _embedded: { ...RESOURCE_FOLDER._embedded, items, total } });
    const items = RESOURCE_FOLDER._embedded.items;
    mockFetch.mockResolvedValueOnce(page(items.slice(0, 2), 3));
    mockFetch.mockResolvedValueOnce(page(items.slice(2), 3));
    const list = await client().listFiles('/foo');
    expect(list.items).toHaveLength(3);
    expect(mockFetch.mock.calls[1][0]).toContain('offset=2');
  });

  it('a resource in the trash keeps its id suffix; origin_path is not mistaken for the path', async () => {
    mockFetch.mockResolvedValueOnce(
      reply(200, { ...RESOURCE_FOLDER, _embedded: { items: [TRASH_RESOURCE], total: 1 } })
    );
    const [item] = (await client().getTrashResources()).items;
    expect(item!.path).toBe('/foo_1408546879');
    expect(item!.name).toBe('foo');
  });
});

describe('Link', () => {
  it('upload: href and method are what the reference shows', async () => {
    mockFetch.mockResolvedValueOnce(reply(200, UPLOAD_LINK));
    expect(await client().getUploadHref('/bar/photo.png', true)).toEqual(UPLOAD_LINK);
    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://cloud-api.yandex.net/v1/disk/resources/upload?path=%2Fbar%2Fphoto.png&overwrite=true'
    );
  });

  it('download', async () => {
    mockFetch.mockResolvedValueOnce(reply(200, DOWNLOAD_LINK));
    expect(await client().getDownloadHref('/bar/photo.png')).toEqual(DOWNLOAD_LINK);
  });

  it('201 with a Link to the new resource ends the call: the link is not followed', async () => {
    for (const call of [
      (c: YandexDiskClient) => c.mkdir('/Music'),
      (c: YandexDiskClient) => c.copyFile('/a', '/b'),
      (c: YandexDiskClient) => c.moveFile('/a', '/b'),
      (c: YandexDiskClient) => c.restoreFromTrash('/x_1'),
    ]) {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(reply(201, RESOURCE_LINK));
      await call(client());
      expect(mockFetch).toHaveBeenCalledTimes(1);
    }
  });

  it('204 without a body (delete, empty the trash) is success', async () => {
    mockFetch.mockResolvedValue(reply(204));
    await client().deleteFile('/a');
    await client().emptyTrash();
  });
});

describe('Operation (202)', () => {
  it.each([
    ['the query-string link shown for copy, move and delete', OPERATION_LINK_QUERY],
    ['the path link shown on the operation page', OPERATION_LINK_PATH],
  ])('%s is polled until `success`', async (_name, link) => {
    mockFetch
      .mockResolvedValueOnce(reply(202, link))
      .mockResolvedValueOnce(reply(200, OPERATION_IN_PROGRESS))
      .mockResolvedValueOnce(reply(200, OPERATION_SUCCESS));
    await client().copyFile('/a', '/b');
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch.mock.calls[1][0]).toBe(link.href);
    expect(mockFetch.mock.calls[2][0]).toBe(link.href);
  });

  it('`failed` is an error (the reference: repeat the original request)', async () => {
    mockFetch
      .mockResolvedValueOnce(reply(202, OPERATION_LINK_QUERY))
      .mockResolvedValueOnce(reply(200, OPERATION_FAILED));
    await expect(client().deleteFile('/a')).rejects.toThrow('Operation failed');
  });

  it('the status request carries the token (it is on the API origin)', async () => {
    mockFetch
      .mockResolvedValueOnce(reply(202, OPERATION_LINK_QUERY))
      .mockResolvedValueOnce(reply(200, OPERATION_SUCCESS));
    await client().moveFile('/a', '/b');
    expect(mockFetch.mock.calls[1][1].headers).toEqual({ Authorization: 'OAuth tok' });
  });
});

describe('Disk', () => {
  it('the capacity sample comes back whole, system_folders included', async () => {
    mockFetch.mockResolvedValueOnce(reply(200, DISK));
    expect(await client().getDiskInfo()).toEqual(DISK);
  });
});

describe('Error', () => {
  it('the error object becomes a typed error with the documented fields', async () => {
    mockFetch.mockResolvedValueOnce(reply(409, ERROR_OBJECT));
    const err = await client()
      .mkdir('/Music')
      .catch(e => e);
    expect(err).toBeInstanceOf(YandexApiError);
    expect(err.status).toBe(409);
    expect(err.errorId).toBe('PlatformResourceAlreadyExists');
    expect(err.description).toBe('resource already exists');
  });

  it('an error without a JSON body still carries its status', async () => {
    mockFetch.mockResolvedValueOnce(reply(404));
    const err = await client()
      .getMeta('/nope')
      .catch(e => e);
    expect(err.status).toBe(404);
    expect(err.errorId).toBeUndefined();
  });
});

describe('FilesResourceList (the flat list of all files)', () => {
  it('is read as documented: items with paths, sizes, timestamps and md5, then an empty page ends it', async () => {
    mockFetch
      .mockResolvedValueOnce(reply(200, FILES_RESOURCE_LIST))
      .mockResolvedValueOnce(reply(200, { items: [], limit: 1000, offset: 2 }));
    const files = await client().listAllFiles();
    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({
      type: 'file',
      name: 'photo2.png',
      path: '/foo/photo2.png', // `disk:/foo/photo2.png`
      size: 54321,
      modified: '2014-04-22T14:57:14+04:00',
      md5: '53f4dc6379c8f95ddf11b9508cfea271',
    });
    expect(files[1]?.path).toBe('/foo/photo1.png');
  });
});
