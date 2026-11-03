import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { YandexApiError, errorStatus } from '../../src/main/api-error.js';
import { YandexDiskClient, isApiUrl, normalizePath } from '../../src/main/yandex-api.js';

const BASE = 'https://cloud-api.yandex.net/v1/disk';

function res(status: number, body?: unknown) {
  return {
    ok: status < 400,
    status,
    json: () => (body === undefined ? Promise.reject(new Error('no body')) : Promise.resolve(body)),
  };
}

describe('normalizePath', () => {
  it.each([
    ['disk:/', '/'],
    ['disk:/a/b', '/a/b'],
    ['trash:/x_123', '/x_123'],
    ['/a/b/', '/a/b'],
    ['a', '/a'],
  ])('%s -> %s', (input, out) => expect(normalizePath(input)).toBe(out));
});

describe('YandexDiskClient', () => {
  let client: YandexDiskClient;
  beforeEach(() => {
    vi.clearAllMocks();
    client = new YandexDiskClient('tok', { baseDelay: 1, pollInterval: 1 });
  });

  it('sends OAuth auth header', async () => {
    mockFetch.mockResolvedValueOnce(res(200, { total_space: 1, used_space: 0, trash_size: 0 }));
    await client.getDiskInfo();
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/`,
      expect.objectContaining({ headers: { Authorization: 'OAuth tok' } })
    );
  });

  it('listFiles reads _embedded.items and normalizes disk:/ paths', async () => {
    mockFetch.mockResolvedValueOnce(
      res(200, {
        path: 'disk:/',
        _embedded: {
          total: 2,
          items: [
            {
              type: 'dir',
              name: 'Docs',
              path: 'disk:/Docs',
              modified: '2026-01-01T00:00:00+00:00',
            },
            {
              type: 'file',
              name: 'a.txt',
              path: 'disk:/a.txt',
              size: 5,
              md5: 'abc',
              preview: 'https://p',
            },
          ],
        },
      })
    );
    const list = await client.listFiles('/');
    expect(list.items).toHaveLength(2);
    expect(list.items[0]).toMatchObject({ type: 'dir', path: '/Docs', is_folder: true });
    expect(list.items[1]).toMatchObject({
      path: '/a.txt',
      size: 5,
      md5: 'abc',
      thumbnail_href: 'https://p',
    });
    expect(mockFetch.mock.calls[0][0]).toContain('path=%2F');
  });

  it('listFiles follows pagination until total is reached', async () => {
    const item = (n: number) => ({ type: 'file', name: `f${n}`, path: `disk:/f${n}` });
    mockFetch
      .mockResolvedValueOnce(res(200, { _embedded: { total: 3, items: [item(1), item(2)] } }))
      .mockResolvedValueOnce(res(200, { _embedded: { total: 3, items: [item(3)] } }));
    const list = await client.listFiles('/');
    expect(list.items.map(i => i.name)).toEqual(['f1', 'f2', 'f3']);
    expect(mockFetch.mock.calls[1][0]).toContain('offset=2');
  });

  it('getTrashResources lists trash root and strips trash:/', async () => {
    mockFetch.mockResolvedValueOnce(
      res(200, {
        _embedded: { total: 1, items: [{ type: 'file', name: 'x', path: 'trash:/x_9' }] },
      })
    );
    const list = await client.getTrashResources();
    expect(mockFetch.mock.calls[0][0]).toContain('/trash/resources?path=%2F');
    expect(list.items[0].path).toBe('/x_9');
  });

  it('tolerates empty bodies (204 / 201 without JSON)', async () => {
    mockFetch.mockResolvedValueOnce(res(204));
    await expect(client.deleteFile('/a')).resolves.toBeUndefined();
    mockFetch.mockResolvedValueOnce(res(201));
    await expect(client.mkdir('/new')).resolves.toBeUndefined();
  });

  it('waits for a 202 operation to succeed', async () => {
    mockFetch
      .mockResolvedValueOnce(res(202, { href: `${BASE}/operations/1` }))
      .mockResolvedValueOnce(res(200, { status: 'in-progress' }))
      .mockResolvedValueOnce(res(200, { status: 'success' }));
    await client.moveFile('/a', '/b');
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch.mock.calls[0][0]).toBe(`${BASE}/resources/move?from=%2Fa&path=%2Fb`);
  });

  it('never sends the token to a foreign operation link', async () => {
    mockFetch.mockResolvedValueOnce(res(202, { href: 'https://evil.example/operations/1' }));
    await expect(client.moveFile('/a', '/b')).rejects.toThrow(/untrusted/i);
    expect(mockFetch).toHaveBeenCalledTimes(1); // only the original move; the link was never fetched
  });

  it('refuses a non-https or look-alike operation link', async () => {
    for (const href of [
      'http://cloud-api.yandex.net/v1/disk/operations/1',
      'https://cloud-api.yandex.net.evil.example/v1/disk/operations/1',
      'https://evil.example/?https://cloud-api.yandex.net/v1/disk/operations/1',
    ]) {
      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce(res(202, { href }));
      await expect(client.copyFile('/a', '/b')).rejects.toThrow(/untrusted/i);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    }
  });

  it('rejects when the 202 operation fails', async () => {
    mockFetch
      .mockResolvedValueOnce(res(202, { href: `${BASE}/operations/2` }))
      .mockResolvedValueOnce(res(200, { status: 'failed' }));
    await expect(client.copyFile('/a', '/b')).rejects.toThrow('Operation failed');
  });

  it('publish returns the public url read back from metadata', async () => {
    mockFetch
      .mockResolvedValueOnce(res(200, { href: 'x' }))
      .mockResolvedValueOnce(
        res(200, { type: 'file', name: 'a', path: 'disk:/a', public_url: 'https://yadi.sk/d/1' })
      );
    expect(await client.publish('/a')).toEqual({ public_url: 'https://yadi.sk/d/1' });
  });

  it('restoreFromTrash and emptyTrash hit the trash endpoints', async () => {
    mockFetch.mockResolvedValue(res(201, {}));
    await client.restoreFromTrash('/x_9');
    await client.emptyTrash();
    expect(mockFetch.mock.calls[0][0]).toBe(`${BASE}/trash/resources/restore?path=%2Fx_9`);
    expect(mockFetch.mock.calls[1][0]).toBe(`${BASE}/trash/resources`);
  });

  it('retries 429/5xx with backoff then succeeds', async () => {
    mockFetch
      .mockResolvedValueOnce(res(429, {}))
      .mockResolvedValueOnce(res(503, {}))
      .mockResolvedValueOnce(res(200, { total_space: 1, used_space: 0, trash_size: 0 }));
    await client.getDiskInfo();
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('gives up after maxRetries and reports the API message', async () => {
    mockFetch.mockResolvedValue(res(500, { message: 'boom' }));
    await expect(client.getDiskInfo()).rejects.toThrow('500: boom');
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('409 is not retried and carries the API description', async () => {
    mockFetch.mockResolvedValueOnce(res(409, { description: 'exists' }));
    await expect(client.mkdir('/a')).rejects.toThrow('409: exists');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('401 clears the token, notifies listener and handler', async () => {
    const onToken = vi.fn();
    const onUnauthorized = vi.fn();
    client.setTokenListener(onToken);
    client.setUnauthorizedHandler(onUnauthorized);
    mockFetch.mockResolvedValueOnce(res(401, {}));
    await expect(client.getDiskInfo()).rejects.toThrow('401');
    expect(client.getAccessToken()).toBe('');
    expect(onToken).toHaveBeenCalledWith('');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  describe('401 with a refresh handler', () => {
    it('repeats the request once with the new token', async () => {
      client.setAccessToken('old');
      client.setRefreshHandler(async () => {
        client.setAccessToken('new');
        return true;
      });
      mockFetch
        .mockResolvedValueOnce(res(401, { error: 'UnauthorizedError' }))
        .mockResolvedValueOnce(res(200, { total_space: 1, used_space: 0, trash_size: 0 }));
      await client.getDiskInfo();
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0]![1].headers.Authorization).toContain('old');
      expect(mockFetch.mock.calls[1]![1].headers.Authorization).toContain('new');
    });

    it('gives up (and signs out) when the refresh fails', async () => {
      const unauthorized = vi.fn();
      client.setUnauthorizedHandler(unauthorized);
      client.setRefreshHandler(async () => false);
      mockFetch.mockResolvedValueOnce(res(401, {}));
      await expect(client.getDiskInfo()).rejects.toThrow('401');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(unauthorized).toHaveBeenCalled();
      expect(client.getAccessToken()).toBe('');
    });

    it('does not loop: a second 401 after a refresh signs out', async () => {
      client.setRefreshHandler(async () => true);
      mockFetch.mockResolvedValue(res(401, {}));
      await expect(client.getDiskInfo()).rejects.toThrow('401');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  it('setAccessToken notifies the token listener', () => {
    const onToken = vi.fn();
    client.setTokenListener(onToken);
    client.setAccessToken('abc');
    expect(onToken).toHaveBeenCalledWith('abc');
  });

  describe('more of the API surface', () => {
    it('gets upload and download links with the encoded path and the overwrite flag', async () => {
      mockFetch
        .mockResolvedValueOnce(res(200, { href: 'https://up.example/x', method: 'PUT' }))
        .mockResolvedValueOnce(res(200, { href: 'https://down.example/x' }));
      expect((await client.getUploadHref('/a b.txt', true)).href).toBe('https://up.example/x');
      expect((await client.getDownloadHref('/a b.txt')).href).toBe('https://down.example/x');
      expect(mockFetch.mock.calls[0]![0]).toBe(
        `${BASE}/resources/upload?path=%2Fa%20b.txt&overwrite=true`
      );
      expect(mockFetch.mock.calls[1]![0]).toBe(`${BASE}/resources/download?path=%2Fa%20b.txt`);
    });

    it('unpublish, delete, restore and empty-trash use the documented verbs and URLs', async () => {
      mockFetch.mockResolvedValue(res(204));
      await client.unpublish('/p');
      await client.deleteFile('/d', true);
      await client.restoreFromTrash('/t');
      await client.emptyTrash();
      const calls = mockFetch.mock.calls.map(c => [c[1].method, c[0]]);
      expect(calls).toEqual([
        ['PUT', `${BASE}/resources/unpublish?path=%2Fp`],
        ['DELETE', `${BASE}/resources?path=%2Fd&permanently=true`],
        ['PUT', `${BASE}/trash/resources/restore?path=%2Ft`],
        ['DELETE', `${BASE}/trash/resources`],
      ]);
    });

    it('getMeta maps a folder and a file, defaulting a missing path to the root', async () => {
      mockFetch
        .mockResolvedValueOnce(res(200, { type: 'dir', name: 'd' }))
        .mockResolvedValueOnce(
          res(200, { type: 'file', name: 'f', path: 'disk:/f', size: 2, md5: 'x', preview: 'p' })
        );
      expect(await client.getMeta('/d')).toMatchObject({ type: 'dir', path: '/', is_folder: true });
      expect(await client.getMeta('/f')).toMatchObject({
        type: 'file',
        path: '/f',
        size: 2,
        md5: 'x',
        thumbnail_href: 'p',
      });
    });

    it('a read that keeps failing on the network is retried, then the last error is thrown', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNRESET'));
      await expect(client.getDiskInfo()).rejects.toThrow('ECONNRESET');
      expect(mockFetch).toHaveBeenCalledTimes(4); // the first try and 3 retries
      mockFetch.mockReset();
      mockFetch.mockRejectedValue('offline');
      await expect(client.getDiskInfo()).rejects.toBe('offline');
    });

    it('operation polling gives up after the timeout', async () => {
      const slow = new YandexDiskClient('tok', { pollInterval: 1, pollTimeout: 20 });
      mockFetch.mockImplementation((url: string) =>
        Promise.resolve(
          url.includes('/resources/copy')
            ? res(202, { href: `${BASE}/operations/9` })
            : res(200, { status: 'in-progress' })
        )
      );
      await expect(slow.copyFile('/a', '/b')).rejects.toThrow('timed out');
      mockFetch.mockReset();
    });

    it('error answers without a JSON body still report the status', async () => {
      mockFetch.mockResolvedValueOnce(res(404));
      await expect(client.getMeta('/nope')).rejects.toThrow('404: Request failed');
    });
  });
});

describe('isApiUrl', () => {
  it('accepts only the API origin over https', () => {
    expect(isApiUrl('https://cloud-api.yandex.net/v1/disk/operations/1')).toBe(true);
    expect(isApiUrl('https://cloud-api.yandex.net:444/x')).toBe(false);
    expect(isApiUrl('nonsense')).toBe(false);
  });
});

describe('request rate', () => {
  it('never exceeds the 40 requests/s allowed by the API terms', async () => {
    mockFetch.mockReset();
    const stamps: number[] = [];
    mockFetch.mockImplementation(async () => {
      stamps.push(Date.now());
      return res(200, { total_space: 1, used_space: 0 });
    });
    const client = new YandexDiskClient('t');
    await Promise.all(Array.from({ length: 12 }, () => client.getDiskInfo()));
    expect(stamps).toHaveLength(12);
    const span = stamps[11]! - stamps[0]!;
    expect(span).toBeGreaterThanOrEqual(11 * 45); // 12 calls take at least ~11 gaps of 50 ms
    expect(12 / (span / 1000)).toBeLessThan(40);
  });

  it('can be switched off for tests', async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(res(200, { total_space: 1, used_space: 0 }));
    const client = new YandexDiskClient('t', { minInterval: 0 });
    const started = Date.now();
    await Promise.all(Array.from({ length: 20 }, () => client.getDiskInfo()));
    expect(Date.now() - started).toBeLessThan(200);
  });
});

describe('YandexDiskClient: network failures, timeouts and server advice', () => {
  const quick = (opts = {}) =>
    new YandexDiskClient('tok', { baseDelay: 1, pollInterval: 1, minInterval: 0, ...opts });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it('a read that fails once on the network succeeds on the retry', async () => {
    mockFetch
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(res(200, { total_space: 1, used_space: 0, trash_size: 0 }));
    await expect(quick().getDiskInfo()).resolves.toMatchObject({ total_space: 1 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('a write is never repeated after a network failure (the first one may have happened)', async () => {
    for (const call of [
      (c: YandexDiskClient) => c.mkdir('/a'),
      (c: YandexDiskClient) => c.copyFile('/a', '/b'),
      (c: YandexDiskClient) => c.moveFile('/a', '/b'),
      (c: YandexDiskClient) => c.deleteFile('/a'),
    ]) {
      mockFetch.mockReset();
      mockFetch.mockRejectedValue(new TypeError('fetch failed'));
      await expect(call(quick())).rejects.toThrow('fetch failed');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    }
  });

  it('every request carries a timeout signal; a silent connection fails with a clear error', async () => {
    mockFetch.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason))
        )
    );
    const c = quick({ requestTimeout: 20, maxRetries: 1 });
    await expect(c.getDiskInfo()).rejects.toThrow(/timed out after/);
    expect(mockFetch).toHaveBeenCalledTimes(2); // a read is retried once
    expect(mockFetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);

    mockFetch.mockClear();
    await expect(c.mkdir('/x')).rejects.toThrow(/timed out after/);
    expect(mockFetch).toHaveBeenCalledTimes(1); // a write is not
  });

  it('a signal given by the caller aborts the call and is not retried', async () => {
    const ctrl = new AbortController();
    mockFetch.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          if (init.signal!.aborted) reject(init.signal!.reason);
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
        })
    );
    const pending = quick().request(`${BASE}/`, { signal: ctrl.signal });
    ctrl.abort();
    await expect(pending).rejects.toBeDefined();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  describe('Retry-After', () => {
    const withHeader = (status: number, value: string) => ({
      ...res(status, {}),
      headers: new Headers({ 'retry-after': value }),
    });

    async function waitFor(header: string, advance: number[]): Promise<boolean[]> {
      vi.useFakeTimers();
      try {
        mockFetch
          .mockResolvedValueOnce(withHeader(429, header))
          .mockResolvedValueOnce(res(200, { total_space: 1, used_space: 0, trash_size: 0 }));
        const c = quick({ baseDelay: 10 });
        let done = false;
        void c.getDiskInfo().then(() => (done = true));
        const seen: boolean[] = [];
        for (const ms of advance) {
          await vi.advanceTimersByTimeAsync(ms);
          seen.push(done);
        }
        return seen;
      } finally {
        vi.useRealTimers();
      }
    }

    it('waits as many seconds as the server asks', async () => {
      expect(await waitFor('2', [1900, 200])).toEqual([false, true]);
    });

    it('understands an HTTP date', async () => {
      const when = new Date(Date.now() + 4000).toUTCString();
      const [early, late] = await waitFor(when, [500, 4000]);
      expect(early).toBe(false);
      expect(late).toBe(true);
    });

    it('never waits longer than a minute, whatever the server says', async () => {
      expect(await waitFor('99999', [59_000, 1_100])).toEqual([false, true]);
    });

    it('falls back to the normal backoff for a header it cannot use', async () => {
      expect(await waitFor('soon', [50])).toEqual([true]);
      expect(await waitFor('-5', [50])).toEqual([true]);
    });

    it('also applies to 503', async () => {
      vi.useFakeTimers();
      try {
        mockFetch
          .mockResolvedValueOnce(withHeader(503, '3'))
          .mockResolvedValueOnce(res(200, { total_space: 1, used_space: 0, trash_size: 0 }));
        let done = false;
        void quick({ baseDelay: 10 })
          .getDiskInfo()
          .then(() => (done = true));
        await vi.advanceTimersByTimeAsync(2900);
        expect(done).toBe(false);
        await vi.advanceTimersByTimeAsync(200);
        expect(done).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('typed errors', () => {
    it('carry the status and the API error id and description, and keep the old message', async () => {
      mockFetch.mockResolvedValueOnce(
        res(409, { description: 'resource already exists', error: 'PlatformResourceAlreadyExists' })
      );
      const err = await quick()
        .mkdir('/a')
        .catch(e => e);
      expect(err).toBeInstanceOf(YandexApiError);
      expect(err.status).toBe(409);
      expect(err.errorId).toBe('PlatformResourceAlreadyExists');
      expect(err.description).toBe('resource already exists');
      expect(err.message).toBe('409: resource already exists');
      expect(errorStatus(err)).toBe(409);
    });

    it('401 is typed too, once the token is cleared', async () => {
      mockFetch.mockResolvedValueOnce(res(401, {}));
      const err = await quick()
        .getDiskInfo()
        .catch(e => e);
      expect(errorStatus(err)).toBe(401);
      expect(err).toBeInstanceOf(YandexApiError);
    });

    it('errorStatus reads old-style messages and ignores everything else', () => {
      expect(errorStatus(new Error('404: not found'))).toBe(404);
      expect(errorStatus(new Error('Network down'))).toBeUndefined();
      expect(errorStatus(new Error('4040 nope'))).toBeUndefined();
      expect(errorStatus('404')).toBeUndefined();
      expect(errorStatus(undefined)).toBeUndefined();
    });
  });

  describe('202 answers', () => {
    it('are polled only when the link is an operation status link', async () => {
      mockFetch
        .mockResolvedValueOnce(res(202, { href: `${BASE}/resources?path=disk%3A%2Fb` }))
        .mockResolvedValue(res(200, { status: 'success' }));
      await quick().moveFile('/a', '/b');
      expect(mockFetch).toHaveBeenCalledTimes(1); // the link was not fetched
    });

    it('operation links on our origin but elsewhere in the tree are refused', async () => {
      await expect(quick().pollAsyncOp(`${BASE}/resources?path=x`)).rejects.toThrow(/untrusted/i);
      await expect(
        quick().pollAsyncOp('https://cloud-api.yandex.net/v1/other/operations/1')
      ).rejects.toThrow(/untrusted/i);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
