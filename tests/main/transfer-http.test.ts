// @vitest-environment node
// Real fetch against a real server: the browser-like globals of the default environment replace
// AbortController, which Node's fetch then refuses.
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { createHash } from 'crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { downloadFile, transferTuning, uploadFile } from '../../src/main/transfer.js';

// Real fetch + a real HTTP server: no mocked transport, so a body that is lost
// in the stream plumbing shows up here.
let server: Server;
let base: string;
let stored = Buffer.alloc(0);
let lastLength: string | undefined;
const dir = mkdtempSync(join(tmpdir(), 'transfer-http-'));

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      lastLength = req.headers['content-length'];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        stored = Buffer.concat(chunks);
        res.statusCode = 201;
        res.end();
      });
    } else {
      res.setHeader('content-length', stored.length);
      res.end(stored);
    }
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

const client = () => ({
  getUploadHref: vi.fn().mockResolvedValue({ href: `${base}/up` }),
  getDownloadHref: vi.fn().mockResolvedValue({ href: `${base}/down` }),
});

describe.each([
  ['empty', Buffer.alloc(0)],
  ['2 bytes', Buffer.from('a\n')],
  ['1 MiB', Buffer.alloc(1024 * 1024, 5)],
  ['20 MiB', Buffer.alloc(20 * 1024 * 1024, 9)],
])('real HTTP round trip: %s', (_n, content) => {
  it('arrives byte for byte and comes back identical', async () => {
    const src = join(dir, 'src.bin');
    writeFileSync(src, content);
    const seen: number[] = [];
    await uploadFile(client() as never, src, '/x', false, d => seen.push(d));
    expect(stored.equals(content)).toBe(true);
    expect(lastLength).toBe(String(content.length));
    expect(seen.at(-1)).toBe(content.length);

    const dst = join(dir, 'dst.bin');
    await downloadFile(client() as never, '/x', dst);
    expect(readFileSync(dst).equals(content)).toBe(true);
  });
});

describe('download verification against what the Disk reported', () => {
  const content = Buffer.from('the real content of the file');
  const md5 = createHash('md5').update(content).digest('hex');

  async function download(expected?: { size?: number; md5?: string }, body = content) {
    stored = body;
    const dst = join(dir, `verified-${Math.random().toString(36).slice(2)}.bin`);
    const result = downloadFile(client() as never, '/x', dst, undefined, undefined, expected);
    return { result, dst };
  }

  it('accepts a file whose size and md5 match (md5 in any letter case)', async () => {
    for (const expected of [
      { size: content.length, md5 },
      { size: content.length, md5: md5.toUpperCase() },
    ]) {
      const { result, dst } = await download(expected);
      await result;
      expect(readFileSync(dst).equals(content)).toBe(true);
    }
  });

  it('checks only what is known: nothing, size alone, md5 alone, an empty md5', async () => {
    for (const expected of [
      undefined,
      {},
      { size: content.length },
      { md5 },
      { size: content.length, md5: '' },
    ]) {
      const { result, dst } = await download(expected);
      await result;
      expect(existsSync(dst)).toBe(true);
    }
  });

  it('refuses a different size and leaves neither the file nor a .part behind', async () => {
    const { result, dst } = await download({ size: content.length + 1 });
    await expect(result).rejects.toThrow(/size/i);
    expect(existsSync(dst)).toBe(false);
    expect(existsSync(`${dst}.part`)).toBe(false);
  });

  it('refuses the right size with other content (md5 differs)', async () => {
    const other = Buffer.from('X'.repeat(content.length));
    const { result, dst } = await download({ size: content.length, md5 }, other);
    await expect(result).rejects.toThrow(/md5|checksum/i);
    expect(existsSync(dst)).toBe(false);
    expect(existsSync(`${dst}.part`)).toBe(false);
  });

  it('does not replace an existing file when the new content fails the check', async () => {
    const dst = join(dir, 'existing.bin');
    writeFileSync(dst, 'precious local copy');
    stored = Buffer.from('corrupted');
    await expect(
      downloadFile(client() as never, '/x', dst, undefined, undefined, { md5 })
    ).rejects.toThrow();
    expect(readFileSync(dst, 'utf8')).toBe('precious local copy');
  });

  it('verifies an empty file too', async () => {
    const { result, dst } = await download(
      { size: 0, md5: 'd41d8cd98f00b204e9800998ecf8427e' },
      Buffer.alloc(0)
    );
    await result;
    expect(readFileSync(dst).length).toBe(0);
    const bad = await download({ size: 3 }, Buffer.alloc(0));
    await expect(bad.result).rejects.toThrow(/size/i);
  });
});

describe('a connection that goes quiet is cut', () => {
  const tuningAtStart = { ...transferTuning };
  let quiet: Server;
  let quietBase: string;
  let mode: 'no-headers' | 'stall-body' | 'no-answer' | 'slow' = 'no-headers';
  const open = new Set<import('net').Socket>();

  beforeAll(async () => {
    quiet = createServer((req, res) => {
      if (mode === 'no-headers') return; // never answers
      if (req.method === 'PUT') {
        req.resume();
        if (mode === 'no-answer') return; // takes the body, never answers
        return;
      }
      if (mode === 'slow') {
        // Slow but alive: a chunk every 80 ms, 400 ms in all.
        res.setHeader('content-length', '5');
        let sent = 0;
        const timer = setInterval(() => {
          res.write('x');
          if (++sent === 5) {
            clearInterval(timer);
            res.end();
          }
        }, 80);
        return;
      }
      res.setHeader('content-length', '1000');
      res.write('only the start'); // then nothing
    });
    quiet.on('connection', s => {
      open.add(s);
      s.on('close', () => open.delete(s));
    });
    await new Promise<void>(r => quiet.listen(0, '127.0.0.1', r));
    quietBase = `http://127.0.0.1:${(quiet.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    for (const s of open) s.destroy();
    quiet.close();
  });
  afterEach(() => Object.assign(transferTuning, tuningAtStart));

  const quietClient = () => ({
    getUploadHref: vi.fn().mockResolvedValue({ href: `${quietBase}/up` }),
    getDownloadHref: vi.fn().mockResolvedValue({ href: `${quietBase}/down` }),
  });

  it('download: no answer at all', async () => {
    Object.assign(transferTuning, { headersMs: 150 });
    mode = 'no-headers';
    const dst = join(dir, 'q1.bin');
    await expect(downloadFile(quietClient() as never, '/x', dst)).rejects.toThrow(/timed out/);
    expect(existsSync(dst)).toBe(false);
    expect(existsSync(`${dst}.part`)).toBe(false);
  });

  it('download: the body stops halfway; nothing is left behind and a kept file is not touched', async () => {
    Object.assign(transferTuning, { stallMs: 150 });
    mode = 'stall-body';
    const dst = join(dir, 'q2.bin');
    writeFileSync(dst, 'old copy');
    await expect(downloadFile(quietClient() as never, '/x', dst)).rejects.toThrow(/timed out/);
    expect(readFileSync(dst, 'utf8')).toBe('old copy');
    expect(existsSync(`${dst}.part`)).toBe(false);
  });

  it('download: a slow but steady stream is not cut (the limit is for silence, not for duration)', async () => {
    Object.assign(transferTuning, { stallMs: 200 });
    mode = 'slow';
    const dst = join(dir, 'slow.bin');
    await downloadFile(quietClient() as never, '/x', dst);
    expect(readFileSync(dst, 'utf8')).toBe('xxxxx');
  });

  it('upload: the Disk takes the file but never answers', async () => {
    Object.assign(transferTuning, { responseMs: 150, attempts: 1 });
    mode = 'no-answer';
    const src = join(dir, 'q3.bin');
    writeFileSync(src, 'payload');
    await expect(uploadFile(quietClient() as never, src, '/x', false)).rejects.toThrow(/timed out/);
  });

  it('upload: no answer at all; it is repeated, then given up', async () => {
    Object.assign(transferTuning, { responseMs: 100, attempts: 2, retryDelayMs: 1 });
    mode = 'no-headers';
    const src = join(dir, 'q4.bin');
    writeFileSync(src, 'payload');
    const c = quietClient();
    await expect(uploadFile(c as never, src, '/x', false)).rejects.toThrow(/timed out/);
    expect(c.getUploadHref).toHaveBeenCalledTimes(2);
  });
});
