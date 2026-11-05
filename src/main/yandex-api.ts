/**
 * Yandex.Disk REST API client.
 *
 * All HTTP requests go to the main process — no CORS issues, tokens stay secure.
 * Response shapes follow https://yandex.com/dev/disk-api/doc/en/reference/ :
 * folder listings come back as `_embedded.items`, paths look like `disk:/a/b`
 * (or `trash:/x_123`), and long operations respond with 202 with an operation link.
 *
 * @module yandex-api
 */

import { RequestTimeoutError, YandexApiError, describeError } from './api-error.js';
import { logger, redactUrl } from './logger.js';
import type { FileInfoList, FileMetadata } from '../shared/types.js';

export interface YandexDiskClientOptions {
  /** Maximum retry attempts for 429/5xx responses. Default 3. */
  maxRetries?: number;
  /** Base delay for exponential backoff in ms. Default 500. */
  baseDelay?: number;
  /** Poll interval for async operations in ms. Default 1000. */
  pollInterval?: number;
  /** Give up on an async operation after this many ms. Default 300 000. */
  pollTimeout?: number;
  /** Minimum gap between API requests in ms (the API terms allow 40 requests/s). Default 50. */
  minInterval?: number;
  /** Give up on one request (headers and body) after this many ms. Default 30 000. */
  requestTimeout?: number;
}

const DEFAULT_OPTIONS: Required<YandexDiskClientOptions> = {
  maxRetries: 3,
  baseDelay: 500,
  pollInterval: 1000,
  pollTimeout: 300_000,
  minInterval: 50,
  requestTimeout: 30_000,
};

/** Longest pause a `Retry-After` response may impose on us. */
const MAX_RETRY_AFTER_MS = 60_000;

/** Seconds or an HTTP date → milliseconds (undefined when absent or unusable). */
function retryAfterMs(header: string | null | undefined, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now;
  return Number.isFinite(ms) && ms >= 0 ? Math.min(ms, MAX_RETRY_AFTER_MS) : undefined;
}

const PAGE_SIZE = 200;
/** Pages of the flat file list. The listing is read until an empty page, whatever the Disk caps. */
const FLAT_PAGE_SIZE = 1000;

/** What the sync engine reads of a resource: no previews, links or custom properties. */
const SYNC_KEYS = ['name', 'path', 'type', 'size', 'modified', 'md5'];
const FOLDER_FIELDS = [...SYNC_KEYS.map(k => `_embedded.items.${k}`), '_embedded.total'].join(',');
const FLAT_FIELDS = SYNC_KEYS.map(k => `items.${k}`).join(',');

interface RawResource {
  type?: string;
  name?: string;
  path?: string;
  size?: number;
  modified?: string;
  md5?: string;
  mime_type?: string;
  preview?: string;
  public_url?: string;
  _embedded?: { items?: RawResource[]; total?: number };
}

interface Sent {
  status: number;
  body: Record<string, unknown>;
}

const API_ORIGIN = 'https://cloud-api.yandex.net';

/** True only for https URLs on the exact API origin. */
export function isApiUrl(href: string): boolean {
  try {
    return new URL(href).origin === API_ORIGIN;
  } catch {
    return false;
  }
}

/**
 * The status link of a long operation on the API origin. The official examples show
 * `/v1/disk/operations?id=<id>` (copy, move, delete) while the operation page describes
 * `/v1/disk/operations/<id>`; both are accepted.
 */
export function isOperationUrl(href: string): boolean {
  try {
    const url = new URL(href);
    return (
      url.origin === API_ORIGIN &&
      (url.pathname === '/v1/disk/operations' || url.pathname.startsWith('/v1/disk/operations/'))
    );
  } catch {
    return false;
  }
}

/** `disk:/a/b` | `trash:/x` | `a/b` → `/a/b`. Root becomes `/`. */
export function normalizePath(p: string): string {
  const stripped = p.replace(/^(disk|trash):/, '');
  const withSlash = stripped.startsWith('/') ? stripped : `/${stripped}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, '') : withSlash;
}

function toMetadata(raw: RawResource): FileMetadata {
  const type = raw.type === 'dir' ? 'dir' : 'file';
  return {
    type,
    name: raw.name ?? '',
    path: normalizePath(raw.path ?? '/'),
    href: '',
    size: raw.size,
    modified: raw.modified,
    md5: raw.md5,
    mime_type: raw.mime_type,
    thumbnail_href: raw.preview,
    public_url: raw.public_url,
    is_folder: type === 'dir',
  };
}

/**
 * Yandex.Disk API client with OAuth, retry/backoff, and all endpoint methods.
 *
 * @see https://yandex.com/dev/disk/rest/
 */
export class YandexDiskClient {
  private _accessToken: string;
  private readonly options: Required<YandexDiskClientOptions>;
  private tokenListener: ((token: string) => void) | null = null;
  private unauthorizedHandler: (() => void) | null = null;
  private refreshHandler: (() => Promise<boolean>) | null = null;
  private nextSlot = 0;

  constructor(accessToken: string, options?: YandexDiskClientOptions) {
    this._accessToken = accessToken;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  getAccessToken(): string {
    return this._accessToken;
  }

  setAccessToken(token: string): void {
    this._accessToken = token;
    this.tokenListener?.(token);
  }

  /** Called with the new token on every change ('' = cleared). Used to persist it. */
  setTokenListener(cb: ((token: string) => void) | null): void {
    this.tokenListener = cb;
  }

  /** Called after a 401 once the token has been cleared (implicit flow has no refresh token). */
  setUnauthorizedHandler(cb: (() => void) | null): void {
    this.unauthorizedHandler = cb;
  }

  /**
   * Called once on a 401 before giving up: return true after a new access token was applied
   * (the request is then repeated with it).
   */
  setRefreshHandler(cb: (() => Promise<boolean>) | null): void {
    this.refreshHandler = cb;
  }

  // ── Transport ────────────────────────────────────────────────

  /** Space requests at least `minInterval` ms apart: a hard cap of 1000/minInterval per second. */
  private async throttle(): Promise<void> {
    const gap = this.options.minInterval;
    if (gap <= 0) return;
    const now = Date.now();
    const at = Math.max(now, this.nextSlot);
    this.nextSlot = at + gap;
    if (at > now) await new Promise<void>(resolve => setTimeout(resolve, at - now));
  }

  /** Send a request with retry/backoff for 429 and 5xx. Returns status + JSON body. */
  private async send(
    url: string,
    init?: RequestInit,
    retries = 0,
    refreshed = false
  ): Promise<Sent> {
    const method = (init?.method ?? 'GET').toUpperCase();
    const shown = redactUrl(url);
    const started = Date.now();
    let response: Response;
    // The caller gave up (sync paused, app closing): nothing is sent, nothing is repeated.
    init?.signal?.throwIfAborted();
    try {
      await this.throttle();
      init?.signal?.throwIfAborted();
      // The timer covers the whole exchange, body included: a connection that goes quiet must
      // fail instead of freezing a sync run.
      const signal = AbortSignal.timeout(this.options.requestTimeout);
      response = await fetch(url, {
        ...init,
        signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal,
      });
    } catch (err) {
      if (init?.signal?.aborted) {
        logger.debug('api', `${method} ${shown} — cancelled`);
        throw err;
      }
      const timedOut =
        err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      const failure = timedOut
        ? new RequestTimeoutError(`${method} ${shown}`, this.options.requestTimeout)
        : err;
      const message = describeError(failure);
      // A timeout error already starts with the request: do not repeat it.
      const what = message.startsWith(`${method} ${shown}`)
        ? message
        : `${method} ${shown} — ${message}`;
      // Only reads are repeated after a network failure: a lost response to a write may hide a
      // write that happened (a second copy would then fail with 409 and mislead the user).
      if (method === 'GET' && retries < this.options.maxRetries && !init?.signal?.aborted) {
        const delay = this.options.baseDelay * 2 ** retries;
        logger.warn(
          'api',
          `${what}, retry ${retries + 1}/${this.options.maxRetries} in ${delay} ms`
        );
        await new Promise(r => setTimeout(r, delay));
        return this.send(url, init, retries + 1, refreshed);
      }
      logger.error('api', `${what} (network error)`);
      throw failure;
    }
    const ms = Date.now() - started;

    if (response.ok) {
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      logger.debug('api', `${method} ${shown} → ${response.status} (${ms} ms)`);
      logger.trace('api', `${method} ${shown} response`, { status: response.status, body });
      return { status: response.status, body };
    }

    const isRetryable = response.status === 429 || response.status >= 500;
    if (isRetryable && retries < this.options.maxRetries) {
      // The server's own `Retry-After` wins over our backoff, within a sane bound.
      const delay =
        retryAfterMs(response.headers?.get?.('retry-after')) ??
        this.options.baseDelay * 2 ** retries;
      logger.warn(
        'api',
        `${method} ${shown} → ${response.status} (${ms} ms), retry ${retries + 1}/${this.options.maxRetries} in ${delay} ms`
      );
      await new Promise(r => setTimeout(r, delay));
      return this.send(url, init, retries + 1, refreshed);
    }

    if (response.status === 401) {
      const sentAuth = Boolean(
        (init?.headers as Record<string, string> | undefined)?.Authorization
      );
      if (!refreshed && sentAuth && this.refreshHandler && (await this.refreshHandler())) {
        logger.info('api', `${method} ${shown} → 401, repeating with a refreshed token`);
        const headers = { ...(init?.headers as Record<string, string>), ...this.authHeaders() };
        return this.send(url, { ...init, headers }, retries, true);
      }
      logger.error(
        'api',
        `${method} ${shown} → 401 Unauthorized: the saved token is no longer valid and was cleared`
      );
      this.setAccessToken('');
      this.unauthorizedHandler?.();
      throw new YandexApiError(401, '401: Unauthorized — token expired', 'UnauthorizedError');
    }

    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      description?: string;
      message?: string;
    };
    logger.warn('api', `${method} ${shown} → ${response.status} (${ms} ms)`, { body });
    throw new YandexApiError(
      response.status,
      `${response.status}: ${body.message || body.description || body.error || 'Request failed'}`,
      body.error,
      body.description
    );
  }

  /** Generic request returning the parsed JSON body ({} for empty bodies). */
  async request<T>(url: string, init?: RequestInit): Promise<T> {
    return (await this.send(url, init)).body as T;
  }

  /**
   * Run a mutating call. A 202 response means "accepted" — wait for the
   * operation to finish so callers can refresh the view afterwards.
   */
  private async mutate(url: string, method: string, signal?: AbortSignal): Promise<void> {
    const { status, body } = await this.send(url, { method, headers: this.authHeaders(), signal });
    if (status === 202 && typeof body.href === 'string') {
      // Only an operation status link is polled. Another link on our own origin is not a
      // status page; a foreign one is refused by pollAsyncOp.
      if (isApiUrl(body.href) && !isOperationUrl(body.href)) {
        logger.warn('api', `202 with a link that is not an operation: ${redactUrl(body.href)}`);
        return;
      }
      await this.pollAsyncOp(body.href, signal);
    }
  }

  /** Poll an operation link until it succeeds, fails or times out. */
  async pollAsyncOp(href: string, signal?: AbortSignal): Promise<void> {
    // The link comes from a response body. The token is attached to every poll, so it must
    // never leave the API origin (https + exact host, no look-alikes).
    if (!isOperationUrl(href)) {
      logger.error('api', 'refusing to poll a link that is not an API operation', {
        href: redactUrl(href),
      });
      throw new Error('Untrusted operation link');
    }
    const start = Date.now();
    while (Date.now() - start < this.options.pollTimeout) {
      const { body } = await this.send(href, { headers: this.authHeaders(), signal });
      logger.debug('api', `operation ${redactUrl(href)} → ${String(body.status)}`);
      if (body.status === 'success') return;
      if (body.status === 'failed') throw new Error('Operation failed');
      signal?.throwIfAborted();
      await new Promise(r => setTimeout(r, this.options.pollInterval));
    }
    throw new Error('Async operation timed out');
  }

  // ── Disk info ────────────────────────────────────────────────

  /** GET /v1/disk/ — disk info & quota */
  async getDiskInfo(signal?: AbortSignal): Promise<{
    type: 'disk';
    total_space: number;
    used_space: number;
    trash_size: number;
  }> {
    const info = await this.request<
      Record<string, unknown> & {
        type: 'disk';
        total_space: number;
        used_space: number;
        trash_size: number;
      }
    >(`${this.baseUrl}/`, { headers: this.authHeaders(), signal });
    this.noteRevision(info);
    return info;
  }

  private revisionMissingSaid = false;

  /**
   * Diagnostics: does the answer carry a revision of the whole Disk, and does it change when
   * something changes? (The reference does not list the field.) Logged at debug level only.
   */
  private noteRevision(info: Record<string, unknown>): void {
    const revision = info.revision;
    if (typeof revision === 'number' || typeof revision === 'string') {
      logger.debug('api', `disk info: revision ${revision}`);
    } else if (!this.revisionMissingSaid) {
      this.revisionMissingSaid = true;
      logger.debug('api', `disk info: no revision field (fields: ${Object.keys(info).join(', ')})`);
    }
  }

  // ── Listing ──────────────────────────────────────────────────

  /** Fetch every page of a folder listing from `resources` or `trash/resources`. */
  private async listAll(
    endpoint: 'resources' | 'trash/resources',
    path: string,
    signal?: AbortSignal,
    fields?: string
  ): Promise<FileInfoList> {
    const items: FileMetadata[] = [];
    let total = Infinity;
    const only = fields ? `&fields=${encodeURIComponent(fields)}` : '';
    while (items.length < total) {
      const res = await this.request<RawResource>(
        `${this.baseUrl}/${endpoint}?path=${encodeURIComponent(path)}&limit=${PAGE_SIZE}&offset=${items.length}${only}`,
        { headers: this.authHeaders(), signal }
      );
      const page = res._embedded?.items ?? [];
      total = res._embedded?.total ?? page.length;
      items.push(...page.map(toMetadata));
      if (page.length === 0) break;
    }
    return { total: items.length, items, limit: items.length, offset: 0, href: '' };
  }

  /** GET /v1/disk/resources?path= — all entries of a folder. */
  async listFiles(path: string, signal?: AbortSignal): Promise<FileInfoList> {
    return this.listAll('resources', path, signal);
  }

  /**
   * GET /v1/disk/resources?path=&fields= — a folder as the sync engine needs it: names, paths,
   * sizes, timestamps and checksums only, which keeps big folders' responses small.
   */
  async listFolder(path: string, signal?: AbortSignal): Promise<FileInfoList> {
    return this.listAll('resources', path, signal, FOLDER_FIELDS);
  }

  /**
   * GET /v1/disk/resources/files — every file on the Disk in one flat list, whatever the folder
   * (https://yandex.com/dev/disk-api/doc/en/reference/all-files). The response carries no `total`, so
   * pages are read until an empty one.
   */
  async listAllFiles(signal?: AbortSignal): Promise<FileMetadata[]> {
    const items: FileMetadata[] = [];
    let firstOfLastPage: string | undefined;
    for (;;) {
      const res = await this.request<{ items?: RawResource[] }>(
        `${this.baseUrl}/resources/files?limit=${FLAT_PAGE_SIZE}&offset=${items.length}&fields=${encodeURIComponent(FLAT_FIELDS)}`,
        { headers: this.authHeaders(), signal }
      );
      const page = res.items ?? [];
      if (page.length === 0) return items;
      // A Disk that ignores the offset would respond with the same page for ever.
      if (page[0]?.path !== undefined && page[0].path === firstOfLastPage) {
        throw new Error('The Disk file list does not advance');
      }
      firstOfLastPage = page[0]?.path;
      items.push(...page.map(toMetadata));
    }
  }

  /**
   * GET /v1/disk/trash/resources?path= — the trash root (default) or a folder inside it, given
   * relative to the trash root (`/foo_1408546879/sub`).
   */
  async getTrashResources(path = '/', signal?: AbortSignal): Promise<FileInfoList> {
    return this.listAll('trash/resources', path, signal);
  }

  /** GET /v1/disk/resources?path= — metadata of one resource (no listing). */
  async getMeta(path: string, signal?: AbortSignal): Promise<FileMetadata> {
    const raw = await this.request<RawResource>(
      `${this.baseUrl}/resources?path=${encodeURIComponent(path)}&limit=0`,
      { headers: this.authHeaders(), signal }
    );
    return toMetadata(raw);
  }

  // ── Transfer links ───────────────────────────────────────────

  /** GET /v1/disk/resources/upload — get upload link */
  async getUploadHref(
    path: string,
    overwrite = false,
    signal?: AbortSignal
  ): Promise<{ href: string; method: 'PUT' }> {
    return this.request(
      `${this.baseUrl}/resources/upload?path=${encodeURIComponent(path)}&overwrite=${overwrite}`,
      { headers: this.authHeaders(), signal }
    );
  }

  /** GET /v1/disk/resources/download — get download link */
  async getDownloadHref(path: string, signal?: AbortSignal): Promise<{ href: string }> {
    return this.request(`${this.baseUrl}/resources/download?path=${encodeURIComponent(path)}`, {
      headers: this.authHeaders(),
      signal,
    });
  }

  // ── Mutations ────────────────────────────────────────────────

  /** DELETE /v1/disk/resources — to trash, or permanently */
  async deleteFile(path: string, permanently = false, signal?: AbortSignal): Promise<void> {
    await this.mutate(
      `${this.baseUrl}/resources?path=${encodeURIComponent(path)}&permanently=${permanently}`,
      'DELETE',
      signal
    );
  }

  /** POST /v1/disk/resources/copy */
  async copyFile(sourcePath: string, targetPath: string): Promise<void> {
    await this.mutate(
      `${this.baseUrl}/resources/copy?from=${encodeURIComponent(sourcePath)}&path=${encodeURIComponent(targetPath)}`,
      'POST'
    );
  }

  /** POST /v1/disk/resources/move (also used to rename) */
  async moveFile(sourcePath: string, targetPath: string): Promise<void> {
    await this.mutate(
      `${this.baseUrl}/resources/move?from=${encodeURIComponent(sourcePath)}&path=${encodeURIComponent(targetPath)}`,
      'POST'
    );
  }

  /** PUT /v1/disk/resources — create directory (parents are not created) */
  async mkdir(path: string, signal?: AbortSignal): Promise<void> {
    await this.mutate(`${this.baseUrl}/resources?path=${encodeURIComponent(path)}`, 'PUT', signal);
  }

  /** PUT /v1/disk/resources/publish, then read back the public URL. */
  async publish(path: string): Promise<{ public_url: string }> {
    await this.mutate(`${this.baseUrl}/resources/publish?path=${encodeURIComponent(path)}`, 'PUT');
    const meta = await this.getMeta(path);
    return { public_url: meta.public_url ?? '' };
  }

  /** PUT /v1/disk/resources/unpublish */
  async unpublish(path: string): Promise<void> {
    await this.mutate(
      `${this.baseUrl}/resources/unpublish?path=${encodeURIComponent(path)}`,
      'PUT'
    );
  }

  /**
   * PUT /v1/disk/trash/resources/restore — to the old place, optionally under a new name (when
   * the old name is taken the Disk refuses; `overwrite` is never sent, so nothing is replaced).
   */
  async restoreFromTrash(path: string, name?: string): Promise<void> {
    const rename = name === undefined ? '' : `&name=${encodeURIComponent(name)}`;
    await this.mutate(
      `${this.baseUrl}/trash/resources/restore?path=${encodeURIComponent(path)}${rename}`,
      'PUT'
    );
  }

  /** DELETE /v1/disk/trash/resources — empty the trash (or one item) */
  async emptyTrash(path?: string): Promise<void> {
    const qs = path ? `?path=${encodeURIComponent(path)}` : '';
    await this.mutate(`${this.baseUrl}/trash/resources${qs}`, 'DELETE');
  }

  /** Authorization header for all requests */
  authHeaders(): Record<string, string> {
    return { Authorization: `OAuth ${this._accessToken}` };
  }

  private get baseUrl(): string {
    return 'https://cloud-api.yandex.net/v1/disk';
  }
}
