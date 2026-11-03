/**
 * Sign-in orchestration: device-flow login, token refresh, client ID selection.
 * The renderer only ever sees the user code, the URL to open and success/failure.
 *
 * @module auth-service
 */
import { isValidClientId, isValidClientSecret, type ResolvedClientId } from './app-config.js';
import { logger } from './logger.js';
import {
  OAuthError,
  type OAuthApp,
  pollDeviceToken,
  refreshAccessToken,
  requestDeviceCode,
  type OAuthDeps,
  type OAuthTokens,
} from './oauth.js';
import type { LoginFailure } from '../shared/types.js';

export interface DeviceLoginInfo {
  userCode: string;
  verificationUrl: string;
  /** Seconds until the code expires. */
  expiresIn: number;
}

export interface AuthConfig {
  /** Where the active client ID comes from; `none` = sign-in by button is not possible yet. */
  source: ResolvedClientId['source'];
  clientId: string;
  /** A client secret is stored: the device-flow button can work. */
  hasSecret: boolean;
}

export type LoginResult = { ok: true } | ({ ok: false } & LoginFailure);

export interface AuthServiceDeps {
  /** Current API client: tokens are applied through it. */
  client: { setAccessToken(token: string): void };
  resolve: () => ResolvedClientId;
  saveClientId: (id: string) => void;
  /** The application's secret ("password"); '' = none. Yandex asks for it in the token exchange. */
  clientSecret: () => string;
  saveClientSecret: (secret: string) => void;
  /** OAuth site for the interface language (https://oauth.yandex.ru or .com). */
  base?: () => string;
  deviceId: () => string;
  deviceName: string;
  /** Open the verification page in the system browser (the caller checks the host). */
  openExternal: (url: string) => Promise<void>;
  /** Put the code on the clipboard: the browser takes focus, the user pastes it there. */
  copyText?: (text: string) => void;
  onResult: (result: LoginResult) => void;
  oauth?: OAuthDeps;
}

/** Hosts we are willing to open for the user to confirm the code. */
export function isTrustedVerificationUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /(^|\.)(yandex\.(com|ru)|ya\.ru)$/.test(u.hostname);
  } catch {
    return false;
  }
}

/** Map a documented OAuth error code onto what the sign-in screen can explain. */
export function classifyOAuthError(err: unknown): LoginFailure {
  if (!(err instanceof OAuthError)) {
    return { kind: 'other', detail: err instanceof Error ? err.message : String(err) };
  }
  switch (err.code) {
    case 'expired_token':
    case 'invalid_grant':
      return { kind: 'expired' };
    case 'access_denied':
      return { kind: 'denied' };
    case 'invalid_client':
    case 'unauthorized_client':
      return { kind: 'bad_client', detail: err.code };
    default:
      return { kind: 'other', detail: err.message };
  }
}

export class AuthService {
  private abort: AbortController | null = null;
  private refreshToken: string | undefined;
  private refreshing: Promise<boolean> | null = null;

  constructor(private readonly deps: AuthServiceDeps) {}

  config(): AuthConfig {
    const { source, clientId } = this.deps.resolve();
    return { source, clientId, hasSecret: Boolean(this.deps.clientSecret()) };
  }

  /** Save the application's ID and, when given, its secret ('' removes it; undefined keeps it). */
  setCredentials(id: string, secret?: string): void {
    const trimmed = id.trim();
    if (trimmed && !isValidClientId(trimmed)) throw new Error('Invalid Client ID');
    const secretTrimmed = secret?.trim();
    if (secretTrimmed && !isValidClientSecret(secretTrimmed))
      throw new Error('Invalid Client secret');
    this.deps.saveClientId(trimmed);
    if (secretTrimmed !== undefined) this.deps.saveClientSecret(secretTrimmed);
  }

  private app(clientId: string): OAuthApp {
    const clientSecret = this.deps.clientSecret();
    return {
      clientId,
      ...(clientSecret ? { clientSecret } : {}),
      ...(this.deps.base ? { base: this.deps.base() } : {}),
    };
  }

  getRefreshToken(): string | undefined {
    return this.refreshToken;
  }

  /** A token pasted by hand has no refresh token. */
  useManualToken(): void {
    this.refreshToken = undefined;
  }

  /** Restore the refresh token saved with the session at startup. */
  restore(refreshToken: string | undefined): void {
    this.refreshToken = refreshToken;
  }

  private apply(tokens: OAuthTokens): void {
    this.refreshToken = tokens.refreshToken;
    this.deps.client.setAccessToken(tokens.accessToken);
  }

  /** Request a code, open the browser and wait for the confirmation in the background. */
  async start(): Promise<DeviceLoginInfo> {
    const { clientId } = this.deps.resolve();
    if (!clientId) throw new Error('No Client ID configured');
    this.cancel();
    const app = this.app(clientId);
    const code = await requestDeviceCode(
      app,
      this.deps.deviceId(),
      this.deps.deviceName,
      this.deps.oauth
    );
    const abort = new AbortController();
    this.abort = abort;
    try {
      this.deps.copyText?.(code.userCode);
    } catch {
      // the clipboard is a convenience only
    }
    logger.info('app', 'sign-in started: waiting for the code to be confirmed', {
      expiresIn: code.expiresIn,
    });
    if (isTrustedVerificationUrl(code.verificationUrl)) {
      await this.deps.openExternal(code.verificationUrl).catch(err => {
        logger.warn('app', 'could not open the browser', err);
      });
    }
    void pollDeviceToken(app, code, abort.signal, this.deps.oauth)
      .then(tokens => {
        if (abort.signal.aborted) return;
        this.apply(tokens);
        logger.info('app', 'signed in', { refreshToken: Boolean(tokens.refreshToken) });
        this.deps.onResult({ ok: true });
      })
      .catch(err => {
        if (abort.signal.aborted) return;
        const failure = classifyOAuthError(err);
        logger.warn('app', `sign-in failed: ${failure.kind}`, {
          detail: failure.detail,
          secretSet: Boolean(this.deps.clientSecret()),
        });
        this.deps.onResult({ ok: false, ...failure });
      })
      .finally(() => {
        if (this.abort === abort) this.abort = null;
      });
    return {
      userCode: code.userCode,
      verificationUrl: code.verificationUrl,
      expiresIn: code.expiresIn,
    };
  }

  cancel(): void {
    this.abort?.abort();
    this.abort = null;
  }

  /**
   * Exchange the refresh token for a new access token (called by the API client after a
   * 401). Concurrent callers share one request. Returns false when refreshing is impossible.
   */
  refresh(): Promise<boolean> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<boolean> {
    const { clientId } = this.deps.resolve();
    if (!this.refreshToken || !clientId) return false;
    try {
      this.apply(await refreshAccessToken(this.app(clientId), this.refreshToken, this.deps.oauth));
      logger.info('app', 'access token refreshed');
      return true;
    } catch (err) {
      logger.warn('app', `token refresh failed: ${classifyOAuthError(err).kind}`);
      return false;
    }
  }
}
