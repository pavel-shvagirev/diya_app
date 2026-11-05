/**
 * Errors from the Disk API and the transfer links. The message keeps the `<status>: <text>` form
 * the UI already shows; callers branch on `status` / `errorId`, never on message text.
 *
 * `error` and `description` are the fields of the official error object
 * (https://yandex.com/dev/disk-api/doc/en/reference/response-objects#error).
 *
 * @module api-error
 */

export class YandexApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The `error` field of the error object: an id meant for automatic processing. */
    readonly errorId?: string,
    /** The `description` field: detail for developers. */
    readonly description?: string
  ) {
    super(message);
    this.name = 'YandexApiError';
  }
}

/** A request that got no response in time (connection or body stalled). */
export class RequestTimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`${what} timed out after ${Math.round(ms / 1000)} s`);
    this.name = 'RequestTimeoutError';
  }
}

/**
 * An error for the log. undici reports every network failure as `fetch failed` and keeps the real
 * reason (`ECONNRESET`, a DNS or TLS error ...) in `cause`: without it the log cannot tell them apart.
 */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause;
  if (!(cause instanceof Error)) return err.message;
  const why = (cause as { code?: unknown }).code;
  const detail = typeof why === 'string' ? why : cause.message;
  return detail && detail !== err.message ? `${err.message} (${detail})` : err.message;
}

/** HTTP status of an error: typed errors carry it, older `<status>: text` messages are parsed. */
export function errorStatus(err: unknown): number | undefined {
  if (err instanceof YandexApiError) return err.status;
  if (err instanceof Error) {
    const m = /^(\d{3})\b/.exec(err.message);
    if (m) return Number(m[1]);
  }
  return undefined;
}
