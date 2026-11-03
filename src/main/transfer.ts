/**
 * File transfers with byte-level progress, shared by the file manager
 * (upload / download buttons) and the sync engine.
 *
 * @module transfer
 */
import { createHash } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { rename, rm, stat, utimes } from 'fs/promises';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';

import { RequestTimeoutError, YandexApiError, errorStatus } from './api-error.js';
import { logger } from './logger.js';
import type { YandexDiskClient } from './yandex-api.js';

export type ProgressCallback = (done: number, total: number) => void;

/**
 * Pass-through stream that counts the bytes flowing by. Counting in a Transform
 * (instead of `source.on('data')`) matters: a 'data' listener switches a Readable
 * into flowing mode at once, and whatever is emitted before the HTTP client starts
 * reading is silently dropped — the Disk then received an empty body.
 */
function counting(onBytes: (total: number) => void): Transform {
  let total = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      total += chunk.length;
      onBytes(total);
      cb(null, chunk);
    },
  });
}

/** Upload and download links come from an API answer: only https is followed. */
function assertHttps(href: string): void {
  let ok = false;
  try {
    const url = new URL(href);
    // Tests talk to a real HTTP server on the loopback interface; nothing else is ever allowed.
    const testLoopback =
      process.env.NODE_ENV === 'test' &&
      url.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    ok = url.protocol === 'https:' || testLoopback;
  } catch {
    // not a URL
  }
  if (!ok) throw new Error('Refusing a transfer link that is not https');
}

/**
 * Time limits and retries for transfers. Exported so tests can shrink them; nothing else changes
 * them.
 */
export const transferTuning = {
  /** Connecting and getting the response headers. */
  headersMs: 30_000,
  /** No byte moved for this long: the connection is considered dead. */
  stallMs: 60_000,
  /** After the last byte of an upload the Disk may need a while to answer. */
  responseMs: 300_000,
  /** Upload attempts (the first one included) and the pause before the first retry. */
  attempts: 3,
  retryDelayMs: 1000,
};

/** The largest file the Disk takes at all (Yandex 360 subscribers; others: 1 GB). */
export const MAX_UPLOAD_BYTES = 50 * 1024 ** 3;

/** Fires `onTimeout` unless kicked again in time. */
class Watchdog {
  private timer: NodeJS.Timeout | undefined;
  fired = false;
  constructor(private readonly onTimeout: () => void) {}
  kick(ms: number): void {
    this.stop();
    this.timer = setTimeout(() => {
      this.fired = true;
      this.onTimeout();
    }, ms);
  }
  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

export type UploadResult = 'created' | 'accepted';

/** What the Disk answers to a PUT, in words (official codes: reference/upload). */
function uploadRejection(status: number): YandexApiError {
  const text: Record<number, string> = {
    412: 'the Disk refused the upload (precondition failed)',
    413: 'the file is larger than the Disk accepts (1 GB; 50 GB with a Yandex 360 subscription)',
    507: 'there is not enough free space on the Disk',
  };
  return new YandexApiError(
    status,
    text[status] ? `${status}: ${text[status]}` : `Upload failed: ${status}`
  );
}

/** Worth repeating: a server error or a connection that failed or stalled; never our own mistakes. */
function isRetryableUpload(err: unknown): boolean {
  const status = errorStatus(err);
  if (status !== undefined) return status === 500 || status === 503;
  return !(err instanceof Error && /not https/.test(err.message));
}

/**
 * Upload a local file to `remotePath`, streaming it so large files stay out of memory. A server
 * error (500/503), a failed or stalled connection is retried with a fresh upload link (the
 * official advice for 500/503 is to upload again); a rejection that repeating cannot fix is not.
 * Resolves `'accepted'` for 202: the Disk has the file but has not placed it yet.
 */
export async function uploadFile(
  client: YandexDiskClient,
  localPath: string,
  remotePath: string,
  overwrite: boolean,
  onProgress?: ProgressCallback
): Promise<UploadResult> {
  const started = Date.now();
  const { size } = await stat(localPath);
  if (size > MAX_UPLOAD_BYTES) {
    throw new YandexApiError(413, `413: the file is larger than the Disk accepts (50 GB)`);
  }
  for (let attempt = 0; ; attempt++) {
    const { href } = await client.getUploadHref(remotePath, overwrite);
    assertHttps(href);
    logger.info(
      'transfer',
      `upload ${remotePath} (${size} B${overwrite ? ', overwrite' : ''})${attempt ? `, attempt ${attempt + 1}` : ''}`
    );
    try {
      const result = await putFile(href, localPath, size, remotePath, onProgress);
      logger.info('transfer', `uploaded ${remotePath}: ${size} B in ${Date.now() - started} ms`);
      onProgress?.(size, size);
      return result;
    } catch (err) {
      if (attempt + 1 >= transferTuning.attempts || !isRetryableUpload(err)) throw err;
      const delay = transferTuning.retryDelayMs * 2 ** attempt;
      logger.warn(
        'transfer',
        `upload ${remotePath} failed (${err instanceof Error ? err.message : String(err)}), retry in ${delay} ms`
      );
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

/** One PUT of the file to an upload link. */
async function putFile(
  href: string,
  localPath: string,
  size: number,
  remotePath: string,
  onProgress?: ProgressCallback
): Promise<UploadResult> {
  const ctrl = new AbortController();
  const dog = new Watchdog(() => ctrl.abort());
  const body = counting(sent => {
    dog.kick(transferTuning.stallMs);
    onProgress?.(sent, size);
  });
  // All of the body has been read: now the Disk answers, and may take its time.
  body.on('end', () => dog.kick(transferTuning.responseMs));
  const source = createReadStream(localPath);
  let readError: Error | undefined;
  // A read error reaches the caller through the failing request; without a listener on the
  // stream it would be an uncaught exception.
  body.on('error', () => undefined);
  source.on('error', err => {
    readError = err;
    body.destroy(err);
  });
  source.pipe(body);
  const cleanup = (): void => {
    dog.stop();
    source.destroy();
    body.destroy();
  };
  let response: Response;
  try {
    dog.kick(transferTuning.headersMs);
    response = await fetch(href, {
      method: 'PUT',
      body: body as unknown as RequestInit['body'],
      duplex: 'half',
      headers: { 'Content-Length': String(size) },
      signal: ctrl.signal,
    } as RequestInit & { duplex: 'half' });
  } catch (err) {
    const timedOut = dog.fired;
    cleanup();
    const failure =
      readError ??
      (timedOut ? new RequestTimeoutError(`upload ${remotePath}`, transferTuning.stallMs) : err);
    logger.error(
      'transfer',
      `upload ${remotePath} failed: ${failure instanceof Error ? failure.message : String(failure)}`
    );
    throw failure;
  }
  dog.stop();
  if (!response.ok) {
    cleanup();
    logger.error('transfer', `upload ${remotePath} rejected: HTTP ${response.status}`);
    throw uploadRejection(response.status);
  }
  if (response.status === 202) {
    logger.info('transfer', `upload ${remotePath}: 202, the Disk has it but has not placed it yet`);
  }
  return response.status === 202 ? 'accepted' : 'created';
}

/** What the Disk reported for the file; a download is checked against whatever is present. */
export interface ExpectedContent {
  size?: number;
  md5?: string;
}

/**
 * Compare what was received with what the Disk said the file is (size and md5 from its metadata,
 * the length announced for the transfer). A truncated or altered file must never be renamed into
 * place or recorded as synced.
 */
function verifyDownload(
  remotePath: string,
  received: number,
  digest: string,
  announced: number,
  expected?: ExpectedContent
): void {
  const mismatch = (what: string, want: string | number, got: string | number): Error =>
    new Error(
      `Download of ${remotePath} failed the ${what} check (expected ${want}, got ${got}); ` +
        'the file may have changed on the Disk, it will be retried on the next sync'
    );
  if (announced > 0 && received !== announced) throw mismatch('size', announced, received);
  if (expected?.size !== undefined && received !== expected.size) {
    throw mismatch('size', expected.size, received);
  }
  if (expected?.md5 && digest !== expected.md5.toLowerCase()) {
    throw mismatch('md5 checksum', expected.md5.toLowerCase(), digest);
  }
}

/**
 * Download `remotePath` to `localPath`. Writes to `<file>.part` first and
 * renames on success, so an interrupted download never leaves a truncated
 * file under the real name. `mtime` (if given) is applied to the result. When `expected` carries
 * the size and/or md5 the Disk reported, the download is verified before the rename. A connection
 * that goes quiet is cut after `transferTuning.stallMs`.
 */
export async function downloadFile(
  client: YandexDiskClient,
  remotePath: string,
  localPath: string,
  onProgress?: ProgressCallback,
  mtime?: Date,
  expected?: ExpectedContent
): Promise<void> {
  const started = Date.now();
  const { href } = await client.getDownloadHref(remotePath);
  assertHttps(href);
  logger.info('transfer', `download ${remotePath}`);
  const part = `${localPath}.part`;
  const ctrl = new AbortController();
  const dog = new Watchdog(() => ctrl.abort());
  try {
    dog.kick(transferTuning.headersMs);
    const response = await fetch(href, { signal: ctrl.signal });
    if (!response.ok) {
      logger.error('transfer', `download ${remotePath} rejected: HTTP ${response.status}`);
      throw new YandexApiError(response.status, `Download failed: ${response.status}`);
    }
    const total = Number(response.headers.get('content-length') ?? 0);
    // An empty file has no body stream at all (`body === null`): that is a valid, empty download.
    const source = response.body ? Readable.fromWeb(response.body as never) : Readable.from([]);
    const hash = createHash('md5');
    let received = 0;
    dog.kick(transferTuning.stallMs);
    await pipeline(
      source,
      counting(n => onProgress?.(n, total || n)),
      new Transform({
        transform(chunk: Buffer, _enc, cb) {
          dog.kick(transferTuning.stallMs);
          hash.update(chunk);
          received += chunk.length;
          cb(null, chunk);
        },
      }),
      createWriteStream(part)
    );
    dog.stop();
    verifyDownload(remotePath, received, hash.digest('hex'), total, expected);
    await rename(part, localPath);
    if (mtime) await utimes(localPath, mtime, mtime);
    logger.info(
      'transfer',
      `downloaded ${remotePath}: ${(await stat(localPath)).size} B in ${Date.now() - started} ms`
    );
  } catch (err) {
    const failure = dog.fired
      ? new RequestTimeoutError(`download ${remotePath}`, transferTuning.stallMs)
      : err;
    logger.error(
      'transfer',
      `download ${remotePath} failed: ${failure instanceof Error ? failure.message : String(failure)}`
    );
    await rm(part, { force: true });
    throw failure;
  } finally {
    dog.stop();
  }
}
