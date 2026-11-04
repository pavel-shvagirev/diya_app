import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logTuning, logger, redactUrl, sanitize } from '../../src/main/logger.js';
import { visibleAt } from '../../src/shared/log.js';

describe('redaction', () => {
  it('keeps API URLs readable, hides the query of signed transfer links', () => {
    expect(redactUrl('https://cloud-api.yandex.net/v1/disk/resources?path=%2Fa&limit=1')).toBe(
      '/v1/disk/resources?path=%2Fa&limit=1'
    );
    expect(redactUrl('https://uploader1.disk.yandex.net/upload-target/123?sign=SECRET&x=1')).toBe(
      'https://uploader1.disk.yandex.net/upload-target/123?…'
    );
  });

  it('masks secret-looking keys at any depth and never leaks them', () => {
    const out = JSON.stringify(
      sanitize({
        headers: { Authorization: 'OAuth y0_secret' },
        nested: { access_token: 'abc', ok: 1 },
      })
    );
    expect(out).not.toContain('y0_secret');
    expect(out).not.toContain('abc');
    expect(out).toContain('"ok":1');
  });

  it('redacts URLs inside values and survives cycles, errors and huge payloads', () => {
    const cyc: Record<string, unknown> = { url: 'https://up.test/p?sign=SECRET' };
    cyc.self = cyc;
    expect(JSON.stringify(sanitize(cyc))).not.toContain('SECRET');
    expect(sanitize(new Error('boom'))).toEqual({ name: 'Error', message: 'boom' });
    const big = sanitize({ blob: 'x'.repeat(50_000) }) as { truncated: string };
    expect(big.truncated.length).toBeLessThan(4200);
  });
});

describe('logger', () => {
  beforeEach(() => {
    logger.clear();
    logger.setRecordLevel('debug');
  });

  it('records level, category, message and data with increasing ids', () => {
    logger.info('sync', 'run started', { pair: 'p1' });
    logger.warn('api', 'retry');
    const [a, b] = logger.getEntries();
    expect(a).toMatchObject({
      level: 'info',
      cat: 'sync',
      msg: 'run started',
      data: { pair: 'p1' },
    });
    expect(b!.id).toBeGreaterThan(a!.id);
  });

  it('drops trace unless recording at trace level', () => {
    logger.trace('api', 'body');
    expect(logger.getEntries()).toHaveLength(0);
    logger.setRecordLevel('trace');
    logger.trace('api', 'body');
    expect(logger.getEntries()).toHaveLength(1);
  });

  it('keeps only the newest 5000 entries', () => {
    for (let i = 0; i < 5100; i++) logger.debug('app', `m${i}`);
    const all = logger.getEntries();
    expect(all).toHaveLength(5000);
    expect(all.at(-1)!.msg).toBe('m5099');
    expect(all[0]!.msg).toBe('m100');
  });

  it('notifies subscribers until they unsubscribe', () => {
    const cb = vi.fn();
    const off = logger.onEntry(cb);
    logger.info('app', 'one');
    off();
    logger.info('app', 'two');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('visibleAt filters by verbosity', () => {
    expect(visibleAt({ level: 'error' }, 'warn')).toBe(true);
    expect(visibleAt({ level: 'debug' }, 'info')).toBe(false);
    expect(visibleAt({ level: 'trace' }, 'trace')).toBe(true);
  });

  describe('file', () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'logger-'));
    });
    afterEach(() => {
      logger.close();
      rmSync(dir, { recursive: true, force: true });
    });

    it('also writes redacted JSON lines to the log file', async () => {
      const file = logger.attachFile(dir);
      logger.info('api', 'hello', { token: 'SECRET' });
      logger.close();
      await new Promise(r => setTimeout(r, 50));
      const line = JSON.parse(readFileSync(file, 'utf8').trim().split('\n')[0]!);
      expect(line).toMatchObject({ msg: 'hello', level: 'info', cat: 'api' });
      expect(JSON.stringify(line)).not.toContain('SECRET');
    });
  });

  it('reports and changes the recording level and the file path', () => {
    logger.setRecordLevel('warn');
    expect(logger.getRecordLevel()).toBe('warn');
    logger.setRecordLevel('debug');
    expect(logger.getFilePath() === null || typeof logger.getFilePath() === 'string').toBe(true);
  });

  it('redacts URLs that are not parseable and unusual values', () => {
    expect(redactUrl('not a url')).toBe('not a url');
    expect(
      sanitize({ big: 10n, fn: () => 1, sym: Symbol('s'), url: 'https://x.example/p?sig=1' })
    ).toEqual({
      big: '10',
      url: 'https://x.example/p?…',
    });
    expect(sanitize({ a: { b: { c: { d: { e: { f: { g: 1 } } } } } } })).toEqual({
      a: { b: { c: { d: { e: { f: '[…]' } } } } },
    });
    expect(sanitize(Array.from({ length: 80 }, (_, i) => i))).toHaveLength(50);
    expect(sanitize(undefined)).toBeUndefined();
  });

  describe('rotation while the app runs', () => {
    it('moves the file aside when it grows past the limit and goes on writing to a new one', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'logrun-'));
      const before = logTuning.maxFileBytes;
      logTuning.maxFileBytes = 2000;
      try {
        const file = logger.attachFile(dir);
        for (let i = 0; i < 40; i++) {
          logger.info('app', `entry ${i} ${'x'.repeat(100)}`);
          await new Promise(r => setTimeout(r, 5)); // lets the file be created, as in real use
        }
        logger.close();
        await new Promise(r => setTimeout(r, 100));
        expect(statSync(`${file}.1`).size).toBeGreaterThan(1000);
        const now = readFileSync(file, 'utf8').trim().split('\n');
        expect(now.length).toBeGreaterThan(0);
        expect(statSync(file).size).toBeLessThan(4000); // never far past the limit
        expect(JSON.parse(now.at(-1)!).msg).toContain('entry 39');
      } finally {
        logTuning.maxFileBytes = before;
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('a failure to rotate never breaks logging', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'logrun-'));
      const before = logTuning.maxFileBytes;
      logTuning.maxFileBytes = 300;
      try {
        logger.attachFile(dir);
        rmSync(dir, { recursive: true, force: true }); // the folder vanishes under the logger
        expect(() => {
          for (let i = 0; i < 20; i++) logger.info('app', `entry ${i} ${'y'.repeat(100)}`);
        }).not.toThrow();
      } finally {
        logTuning.maxFileBytes = before;
        logger.close();
      }
    });
  });

  describe('file rotation', () => {
    it('moves a log bigger than 5 MB aside and survives a broken stream', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'logrot-'));
      const file = join(dir, 'diya.log');
      writeFileSync(file, Buffer.alloc(5 * 1024 * 1024 + 10, 97));
      logger.attachFile(dir);
      logger.info('app', 'after rotation');
      logger.attachFile(dir); // re-attach closes the previous stream
      logger.close();
      logger.close(); // closing twice is harmless
      await new Promise(r => setTimeout(r, 50));
      expect(statSync(`${file}.1`).size).toBeGreaterThan(5 * 1024 * 1024);
      rmSync(dir, { recursive: true, force: true });
    });
  });
});
