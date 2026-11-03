import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { YandexApiError, errorStatus } from '../../src/main/api-error.js';
import {
  MAX_UPLOAD_BYTES,
  downloadFile,
  transferTuning,
  uploadFile,
} from '../../src/main/transfer.js';

const tuningAtStart = { ...transferTuning };

const client = {
  getUploadHref: vi.fn().mockResolvedValue({ href: 'https://uploader.test/put', method: 'PUT' }),
  getDownloadHref: vi.fn().mockResolvedValue({ href: 'https://downloader.test/get' }),
};

/** Read a request body the way a real HTTP client does: later, asynchronously. */
async function readBody(body: unknown, delayMs = 20): Promise<Buffer> {
  await new Promise(r => setTimeout(r, delayMs));
  const chunks: Buffer[] = [];
  for await (const c of body as AsyncIterable<Buffer>) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

describe('transfer', () => {
  let dir: string;
  const realFetch = global.fetch;

  beforeEach(() => {
    transferTuning.retryDelayMs = 1;
    dir = mkdtempSync(join(tmpdir(), 'transfer-'));
  });
  afterEach(() => {
    Object.assign(transferTuning, tuningAtStart);
    global.fetch = realFetch;
    rmSync(dir, { recursive: true, force: true });
  });

  it.each([
    ['empty', ''],
    ['2 bytes', 'a\n'],
    ['small text', 'hello world'.repeat(10)],
    ['bigger than a stream chunk', 'x'.repeat(300_000)],
  ])(
    'upload sends the exact file content (%s) even if the client reads the body late',
    async (_n, text) => {
      const file = join(dir, 'f.txt');
      writeFileSync(file, text);
      let received = Buffer.alloc(0);
      global.fetch = vi.fn(async (_url: unknown, init: RequestInit) => {
        received = await readBody(init.body);
        return { ok: true, status: 201 } as Response;
      }) as never;

      await uploadFile(client as never, file, '/f.txt', false);

      expect(received.length).toBe(statSync(file).size);
      expect(received.toString()).toBe(text);
    }
  );

  it('upload reports increasing progress that ends at the file size', async () => {
    const file = join(dir, 'p.bin');
    writeFileSync(file, Buffer.alloc(200_000, 7));
    global.fetch = vi.fn(async (_u: unknown, init: RequestInit) => {
      await readBody(init.body, 0);
      return { ok: true, status: 201 } as Response;
    }) as never;
    const seen: number[] = [];
    await uploadFile(client as never, file, '/p.bin', false, (done, total) => {
      expect(total).toBe(200_000);
      seen.push(done);
    });
    expect(seen.at(-1)).toBe(200_000);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });

  it('upload fails on a non-2xx answer', async () => {
    const file = join(dir, 'e.txt');
    writeFileSync(file, 'x');
    global.fetch = vi.fn(async (_u: unknown, init: RequestInit) => {
      await readBody(init.body, 0);
      return { ok: false, status: 507 } as Response;
    }) as never;
    await expect(uploadFile(client as never, file, '/e.txt', false)).rejects.toThrow('507');
  });

  it.each([
    ['empty', ''],
    ['2 bytes', 'a\n'],
    ['big', 'y'.repeat(300_000)],
  ])('download writes the exact content (%s) and leaves no .part file', async (_n, text) => {
    global.fetch = vi.fn(
      async () =>
        new Response(text, {
          status: 200,
          headers: { 'content-length': String(Buffer.byteLength(text)) },
        })
    ) as never;
    const target = join(dir, 'd.txt');
    const mtime = new Date('2026-01-02T03:04:05Z');
    await downloadFile(client as never, '/d.txt', target, undefined, mtime);
    expect(readFileSync(target, 'utf8')).toBe(text);
    expect(statSync(target).mtime.getTime()).toBe(mtime.getTime());
    expect(() => statSync(`${target}.part`)).toThrow();
  });

  it('a failed download removes the partial file', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 500, body: null }) as Response) as never;
    const target = join(dir, 'x.txt');
    await expect(downloadFile(client as never, '/x.txt', target)).rejects.toThrow('500');
    expect(() => statSync(`${target}.part`)).toThrow();
  });

  it('an upload that fails at the network level is reported and rethrown', async () => {
    const file = join(dir, 'n.txt');
    writeFileSync(file, 'x');
    global.fetch = vi.fn(async () => {
      throw new Error('socket hang up');
    }) as never;
    await expect(uploadFile(client as never, file, '/n.txt', false)).rejects.toThrow(
      'socket hang up'
    );
    expect(global.fetch).toHaveBeenCalledTimes(transferTuning.attempts); // retried, then given up
    global.fetch = vi.fn(async () => {
      throw 'plain string';
    }) as never;
    await expect(uploadFile(client as never, file, '/n.txt', false)).rejects.toBe('plain string');
  });

  it('a download that breaks halfway removes the partial file and keeps the old target', async () => {
    const target = join(dir, 'keep.txt');
    writeFileSync(target, 'old');
    const broken = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('par'));
        controller.error(new Error('connection lost'));
      },
    });
    global.fetch = vi.fn(async () => new Response(broken, { status: 200 })) as never;
    await expect(downloadFile(client as never, '/keep.txt', target)).rejects.toThrow(
      'connection lost'
    );
    expect(readFileSync(target, 'utf8')).toBe('old');
    expect(() => statSync(`${target}.part`)).toThrow();
    global.fetch = vi.fn(async () => {
      const bad = new ReadableStream({ start: c => c.error('weird') });
      return new Response(bad, { status: 200 });
    }) as never;
    await expect(downloadFile(client as never, '/keep.txt', target)).rejects.toBe('weird');
  });

  it('a download without a content-length still reports progress', async () => {
    const target = join(dir, 'p.txt');
    global.fetch = vi.fn(async () => new Response('hello', { status: 200 })) as never;
    const seen: Array<[number, number]> = [];
    await downloadFile(client as never, '/p.txt', target, (d, t) => seen.push([d, t]));
    expect(seen.at(-1)).toEqual([5, 5]);
  });
});

describe('transfer links come from an API answer', () => {
  it.each([
    'http://uploader.test/put',
    'ftp://x/y',
    'file:///etc/passwd',
    'not a url',
    'javascript:1',
  ])('upload refuses %s', async href => {
    const c = {
      ...client,
      getUploadHref: vi.fn().mockResolvedValue({ href, method: 'PUT' }),
    };
    const file = join(mkdtempSync(join(tmpdir(), 'link-')), 'whatever.bin');
    writeFileSync(file, 'x');
    await expect(uploadFile(c as never, file, '/x', false)).rejects.toThrow('not https');
  });

  it.each(['http://downloader.test/get', 'file:///etc/passwd', 'not a url'])(
    'download refuses %s',
    async href => {
      const c = { ...client, getDownloadHref: vi.fn().mockResolvedValue({ href }) };
      await expect(downloadFile(c as never, '/x', '/tmp/never-written')).rejects.toThrow(
        'not https'
      );
    }
  );
});

describe('download announced length', () => {
  it('refuses a body shorter than the length the server announced', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'announced-'));
    const realFetch = global.fetch;
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('12345', { status: 200, headers: { 'content-length': '10' } })
      ) as never;
    try {
      await expect(downloadFile(client as never, '/x', join(dir, 'f.bin'))).rejects.toThrow(
        /size check/
      );
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      global.fetch = realFetch;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('upload: retries, answers and limits', () => {
  let dir: string;
  let file: string;
  const realFetch = global.fetch;
  const tuningAtStart = { ...transferTuning };
  const answer = (status: number) => ({ ok: status < 400, status }) as Response;
  const links = () => ({
    getUploadHref: vi.fn().mockResolvedValue({ href: 'https://uploader.test/put', method: 'PUT' }),
    getDownloadHref: vi.fn(),
  });

  beforeEach(() => {
    transferTuning.retryDelayMs = 1;
    dir = mkdtempSync(join(tmpdir(), 'upload-rules-'));
    file = join(dir, 'f.txt');
    writeFileSync(file, 'content');
  });
  afterEach(() => {
    Object.assign(transferTuning, tuningAtStart);
    global.fetch = realFetch;
    rmSync(dir, { recursive: true, force: true });
  });

  async function drain(init: RequestInit): Promise<void> {
    for await (const _ of init.body as AsyncIterable<Buffer>) void _;
  }

  it.each([500, 503])('repeats after a %i with a fresh upload link, then succeeds', async code => {
    const c = links();
    let n = 0;
    global.fetch = vi.fn(async (_u: unknown, init: RequestInit) => {
      await drain(init);
      return answer(n++ < 2 ? code : 201);
    }) as never;
    await expect(uploadFile(c as never, file, '/f.txt', false)).resolves.toBe('created');
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(c.getUploadHref).toHaveBeenCalledTimes(3);
  });

  it('gives up after the allowed attempts and says what the Disk answered', async () => {
    global.fetch = vi.fn(async (_u: unknown, init: RequestInit) => {
      await drain(init);
      return answer(503);
    }) as never;
    const err = await uploadFile(links() as never, file, '/f.txt', false).catch(e => e);
    expect(errorStatus(err)).toBe(503);
    expect(global.fetch).toHaveBeenCalledTimes(transferTuning.attempts);
  });

  it('a connection failure is repeated too', async () => {
    let n = 0;
    global.fetch = vi.fn(async (_u: unknown, init: RequestInit) => {
      if (n++ === 0) throw new TypeError('fetch failed');
      await drain(init);
      return answer(201);
    }) as never;
    await expect(uploadFile(links() as never, file, '/f.txt', false)).resolves.toBe('created');
  });

  it.each([
    [413, /1 GB; 50 GB/],
    [507, /not enough free space/],
    [412, /precondition/],
    [400, /Upload failed: 400/],
    [409, /Upload failed: 409/],
  ])('%i is answered once, in words, and not repeated', async (code, words) => {
    global.fetch = vi.fn(async (_u: unknown, init: RequestInit) => {
      await drain(init);
      return answer(code);
    }) as never;
    const err = await uploadFile(links() as never, file, '/f.txt', false).catch(e => e);
    expect(err.message).toMatch(words);
    expect(errorStatus(err)).toBe(code);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('202 means accepted, not yet placed on the Disk', async () => {
    global.fetch = vi.fn(async (_u: unknown, init: RequestInit) => {
      await drain(init);
      return answer(202);
    }) as never;
    await expect(uploadFile(links() as never, file, '/f.txt', false)).resolves.toBe('accepted');
  });

  // Windows has no sparse files here: truncating to 50 GB fails with ENOSPC.
  const sparse = process.platform === 'win32' ? it.skip : it;

  sparse('refuses a file above what the Disk takes at all, before asking for a link', async () => {
    const big = join(dir, 'big.bin');
    writeFileSync(big, '');
    truncateSync(big, MAX_UPLOAD_BYTES + 1); // sparse: no space is used
    const c = links();
    global.fetch = vi.fn() as never;
    const err = await uploadFile(c as never, big, '/big.bin', false).catch(e => e);
    expect(errorStatus(err)).toBe(413);
    expect(err.message).toMatch(/50 GB/);
    expect(c.getUploadHref).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  sparse('a file of exactly the limit is not refused up front', async () => {
    const edge = join(dir, 'edge.bin');
    writeFileSync(edge, '');
    truncateSync(edge, MAX_UPLOAD_BYTES);
    const c = links();
    global.fetch = vi.fn(async () => answer(413)) as never;
    // The fake answers 413 without reading: what matters is that the link was requested.
    await uploadFile(c as never, edge, '/edge.bin', false).catch(() => undefined);
    expect(c.getUploadHref).toHaveBeenCalled();
  });

  it('a failure to get the link is not repeated here (the API client has its own retries)', async () => {
    const c = {
      getUploadHref: vi.fn().mockRejectedValue(new YandexApiError(503, '503: busy')),
      getDownloadHref: vi.fn(),
    };
    await expect(uploadFile(c as never, file, '/f.txt', false)).rejects.toThrow('503: busy');
    expect(c.getUploadHref).toHaveBeenCalledTimes(1);
  });
});
