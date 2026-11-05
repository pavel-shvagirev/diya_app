/**
 * Yandex OAuth "device" flow: the app shows a short code, the user confirms it in a browser,
 * the app polls for the token. No redirect URI and no deep link. Yandex expects the application's
 * ID and secret ("password") in the token exchange; both belong to the user's own application.
 *
 * Source: https://yandex.com/dev/id/doc/en/codes/screen-code-oauth
 * Refresh: https://yandex.com/dev/id/doc/en/tokens/refresh-client
 *
 * @module oauth
 */

const DEFAULT_BASE = 'https://oauth.yandex.com';

/** The user's own Yandex OAuth application. `base` is the OAuth site (.ru or .com). */
export interface OAuthApp {
  clientId: string;
  clientSecret?: string;
  base?: string;
}

const baseOf = (app: OAuthApp): string => app.base ?? DEFAULT_BASE;

/** Form fields identifying the application; the secret only when there is one. */
const credentials = (app: OAuthApp): Record<string, string> => ({
  client_id: app.clientId,
  ...(app.clientSecret ? { client_secret: app.clientSecret } : {}),
});

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  /** Minimum seconds between token requests. */
  interval: number;
  /** Seconds until the code pair stops working. */
  expiresIn: number;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  /** Seconds. */
  expiresIn?: number;
}

/** An OAuth error response: `code` is the documented `error` value (e.g. `authorization_pending`). */
export class OAuthError extends Error {
  constructor(
    readonly code: string,
    description?: string
  ) {
    super(description ? `${code}: ${description}` : code);
    this.name = 'OAuthError';
  }
}

export interface OAuthDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

async function post(
  app: OAuthApp,
  path: string,
  form: Record<string, string>,
  f: typeof fetch
): Promise<Record<string, unknown>> {
  const response = await f(`${baseOf(app)}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new OAuthError(
      typeof body.error === 'string' ? body.error : `http_${response.status}`,
      typeof body.error_description === 'string' ? body.error_description : undefined
    );
  }
  return body;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function toTokens(body: Record<string, unknown>): OAuthTokens {
  const accessToken = str(body.access_token);
  if (!accessToken) throw new OAuthError('invalid_response', 'no access_token in the response');
  return {
    accessToken,
    ...(str(body.refresh_token) ? { refreshToken: str(body.refresh_token) } : {}),
    ...(typeof body.expires_in === 'number' ? { expiresIn: body.expires_in } : {}),
  };
}

/** `POST /device/code` — ask for a code pair to show to the user. */
export async function requestDeviceCode(
  app: OAuthApp,
  deviceId: string,
  deviceName: string,
  deps: OAuthDeps = {}
): Promise<DeviceCode> {
  const body = await post(
    app,
    '/device/code',
    { client_id: app.clientId, device_id: deviceId, device_name: deviceName },
    deps.fetch ?? fetch
  );
  const deviceCode = str(body.device_code);
  const userCode = str(body.user_code);
  if (!deviceCode || !userCode) throw new OAuthError('invalid_response', 'no device/user code');
  return {
    deviceCode,
    userCode,
    verificationUrl: str(body.verification_url) || `${baseOf(app)}/device`,
    interval: typeof body.interval === 'number' ? body.interval : 5,
    expiresIn: typeof body.expires_in === 'number' ? body.expires_in : 300,
  };
}

/**
 * Poll `POST /token` until the user confirms the code. `authorization_pending` means "not
 * yet"; any other error (expired, denied, bad client) ends the wait. Aborting rejects.
 */
export async function pollDeviceToken(
  app: OAuthApp,
  code: DeviceCode,
  signal: AbortSignal,
  deps: OAuthDeps = {}
): Promise<OAuthTokens> {
  const f = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const deadline = now() + code.expiresIn * 1000;
  // The docs warn that requests faster than `interval` may be refused.
  const wait = Math.max(code.interval, 1) * 1000;
  for (;;) {
    if (signal.aborted) throw new OAuthError('cancelled');
    if (now() >= deadline) throw new OAuthError('expired_token', 'the code expired');
    try {
      return toTokens(
        await post(
          app,
          '/token',
          { grant_type: 'device_code', code: code.deviceCode, ...credentials(app) },
          f
        )
      );
    } catch (err) {
      if (!(err instanceof OAuthError) || err.code !== 'authorization_pending') throw err;
    }
    await sleep(wait);
  }
}

/** `POST /token` with a refresh token. The response may carry a new refresh token. */
export async function refreshAccessToken(
  app: OAuthApp,
  refreshToken: string,
  deps: OAuthDeps = {}
): Promise<OAuthTokens> {
  const tokens = toTokens(
    await post(
      app,
      '/token',
      { grant_type: 'refresh_token', refresh_token: refreshToken, ...credentials(app) },
      deps.fetch ?? fetch
    )
  );
  return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
}
