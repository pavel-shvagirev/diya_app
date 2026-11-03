import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';

import { oauthHost } from '../../shared/language.js';
import { lang, t } from '../lib/strings.js';
import { DiskLogo } from '../ui/DiskLogo.js';
import type { AuthConfigInfo, DeviceLogin, LoginFailure } from '../../shared/types.js';

const CLIENT_ID_OK = /^[A-Za-z0-9_-]{16,64}$/;
// oauth.yandex.ru for the Russian interface, oauth.yandex.com for English.
const REGISTER_URL = `${oauthHost(lang)}/client/new/`;
const tokenPageUrl = (clientId: string): string =>
  `${oauthHost(lang)}/authorize?response_type=token&client_id=${encodeURIComponent(clientId)}`;

/** Accepts a bare token or the whole address Yandex redirects to (…#access_token=…&expires_in=…). */
export const extractToken = (input: string): string =>
  /access_token=([^&\s]+)/.exec(input)?.[1] ?? input.trim();

const failureText = (f: LoginFailure, hasSecret: boolean): string =>
  ({
    expired: t.authFailedExpired,
    denied: t.authFailedDenied,
    bad_client: t.authFailedBadClient(f.detail ?? 'invalid_client', hasSecret),
    other: t.authFailedOther(f.detail ?? ''),
  })[f.kind];

/** Seconds left until `deadline` (epoch ms), ticking once a second. */
function useCountdown(deadline: number | null): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (deadline === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadline]);
  return deadline === null ? 0 : Math.max(0, Math.round((deadline - now) / 1000));
}

export function AuthPage({ onAuthenticated }: { onAuthenticated?: () => void }): ReactElement {
  const [config, setConfig] = useState<AuthConfigInfo | null>(null);
  const [login, setLogin] = useState<DeviceLogin | null>(null);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [token, setToken] = useState('');
  const hasSecretRef = useRef(false);
  const left = useCountdown(deadline);

  useEffect(() => {
    void window.api.authConfig().then(c => {
      hasSecretRef.current = c.hasSecret;
      setConfig(c);
      setClientId(c.source === 'custom' ? c.clientId : '');
    });
    return window.api.onAuthLoginFailed(f => {
      setLogin(null);
      setDeadline(null);
      setBusy(false);
      setError(failureText(f, hasSecretRef.current));
    });
  }, []);

  // The button needs both values: Yandex wants the application's secret in the token exchange.
  const ready = Boolean(config?.clientId && config.hasSecret);
  const needSetup = config !== null && !ready;

  const start = (): void => {
    setBusy(true);
    setError('');
    window.api
      .authLogin()
      .then(info => {
        setLogin(info);
        setDeadline(Date.now() + info.expiresIn * 1000);
      })
      .catch((e: unknown) =>
        setError(failureText({ kind: 'other', detail: errorText(e) }, hasSecretRef.current))
      )
      .finally(() => setBusy(false));
  };

  const cancel = (): void => {
    void window.api.authLoginCancel();
    setLogin(null);
    setDeadline(null);
  };

  const applyConfig = (c: AuthConfigInfo): void => {
    hasSecretRef.current = c.hasSecret;
    setConfig(c);
    setClientId(c.source === 'custom' ? c.clientId : '');
    setClientSecret('');
  };

  /** Save the ID and the secret together; an empty secret field keeps the one already saved. */
  const saveCredentials = (id: string, secret: string): void => {
    setError('');
    if (id && !CLIENT_ID_OK.test(id.trim())) {
      setError(t.authClientIdInvalid);
      return;
    }
    if (secret && !CLIENT_ID_OK.test(secret.trim())) {
      setError(t.authClientSecretInvalid);
      return;
    }
    window.api
      .authSetClientId(id.trim(), secret.trim() || undefined)
      .then(applyConfig)
      .catch((e: unknown) => setError(errorText(e)));
  };

  const resetCredentials = (): void => {
    setError('');
    window.api
      .authSetClientId('', '')
      .then(applyConfig)
      .catch((e: unknown) => setError(errorText(e)));
  };

  const submitToken = (e: FormEvent): void => {
    e.preventDefault();
    setBusy(true);
    setError('');
    window.api
      .authSetToken(extractToken(token))
      .then(() => {
        setToken('');
        onAuthenticated?.();
      })
      .catch((err: unknown) => setError(`${t.authTokenFailed}: ${errorText(err)}`))
      .finally(() => setBusy(false));
  };

  return (
    <main className="auth">
      <h1 className="auth__title">Diya</h1>
      <p className="auth__lead">{t.authLead}</p>
      <p className="auth__brand">
        <DiskLogo size={20} />
        {t.authIntegration}
      </p>

      {login ? (
        <section className="auth__code" aria-live="polite">
          <p>{t.authCodeIntro}</p>
          <div className="auth__usercode" data-testid="user-code">
            {login.userCode}
          </div>
          <div className="auth__row">
            <button
              className="btn"
              title={t.authCopyCode}
              onClick={() => void navigator.clipboard.writeText(login.userCode)}
            >
              {t.authCopyCode}
            </button>
            <button
              className="btn"
              onClick={() => void window.api.openExternal(login.verificationUrl)}
            >
              {t.authOpenAgain}
            </button>
            <button className="btn btn--outline" onClick={cancel}>
              {t.authCancel}
            </button>
          </div>
          <p className="auth__hint">
            {t.authWaiting} {t.authCodeLeft(Math.floor(left / 60), left % 60)}
          </p>
        </section>
      ) : (
        <>
          {ready && (
            <button
              className="btn btn--primary auth__signin"
              disabled={busy || !config}
              onClick={start}
            >
              {busy ? t.authStarting : error ? t.authTryAgain : t.authSignIn}
            </button>
          )}
          {needSetup && <p className="auth__hint">{t.authNoClientId}</p>}
        </>
      )}

      {error && (
        <p role="alert" className="auth__error">
          {error}
        </p>
      )}

      <details className="auth__more" open={needSetup}>
        <summary>{t.authAdvanced}</summary>
        <div className="auth__section">
          <strong>{t.authSetupTitle}</strong>
          <ol className="auth__steps">
            {t.authSteps.map(step => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <div className="auth__row">
            <button
              className="btn btn--outline"
              onClick={() => void window.api.openExternal(REGISTER_URL)}
            >
              {t.authOpenRegister}
            </button>
          </div>
          <label htmlFor="client-id">{t.authClientIdLabel}</label>
          <input
            id="client-id"
            value={clientId}
            onChange={e => setClientId(e.target.value)}
            placeholder="0123456789abcdef0123456789abcdef"
            spellCheck={false}
            autoComplete="off"
          />
          <label htmlFor="client-secret">
            {t.authClientSecretLabel}
            {config?.hasSecret ? ` — ${t.authSecretSaved}` : ''}
          </label>
          <input
            id="client-secret"
            type="password"
            value={clientSecret}
            onChange={e => setClientSecret(e.target.value)}
            placeholder={
              config?.hasSecret ? '••••••••••••••••' : 'fedcba9876543210fedcba9876543210'
            }
            spellCheck={false}
            autoComplete="off"
          />
          <div className="auth__row">
            <button
              className="btn btn--outline"
              onClick={() => saveCredentials(clientId, clientSecret)}
            >
              {t.authClientIdSave}
            </button>
            {(config?.source === 'custom' || config?.hasSecret) && (
              <button className="btn btn--outline" onClick={resetCredentials}>
                {t.authClientIdClear}
              </button>
            )}
          </div>
          {config && <p className="auth__hint">Client ID: {t.authClientIdFrom(config.source)}</p>}
        </div>
        <form className="auth__section" onSubmit={submitToken}>
          <label htmlFor="oauth-token">{t.authTokenLabel}</label>
          <div className="auth__row">
            <button
              type="button"
              className="btn btn--outline"
              disabled={!config?.clientId}
              onClick={() => void window.api.openExternal(tokenPageUrl(config?.clientId ?? ''))}
            >
              {t.authOpenTokenPage}
            </button>
          </div>
          <div className="auth__row">
            <input
              id="oauth-token"
              type="password"
              aria-label="OAuth token"
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder="y0_…"
              autoComplete="off"
            />
            <button className="btn btn--outline" type="submit" disabled={busy || !token.trim()}>
              {busy && token ? t.authTokenChecking : t.authTokenSubmit}
            </button>
          </div>
          <p className="auth__hint">{t.authTokenHint}</p>
        </form>
      </details>
    </main>
  );
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
