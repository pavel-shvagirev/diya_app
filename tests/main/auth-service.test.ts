import { describe, expect, it, vi } from 'vitest';

import {
  AuthService,
  classifyOAuthError,
  isTrustedVerificationUrl,
  type LoginResult,
} from '../../src/main/auth-service.js';
import { OAuthError } from '../../src/main/oauth.js';

const CODE = {
  device_code: 'dc',
  user_code: 'ABCD1234',
  verification_url: 'https://oauth.yandex.com/device',
  interval: 1,
  expires_in: 300,
};
const reply = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: () => Promise.resolve(body) }) as Response;
const flush = () => new Promise(r => setTimeout(r, 0));

function make(
  opts: {
    clientId?: string;
    secret?: string;
    base?: string;
    fetchImpl?: ReturnType<typeof vi.fn>;
  } = {}
) {
  const results: LoginResult[] = [];
  const client = { setAccessToken: vi.fn() };
  const fetchImpl = opts.fetchImpl ?? vi.fn();
  const deps = {
    client,
    resolve: () =>
      opts.clientId === ''
        ? { clientId: '', source: 'none' as const }
        : { clientId: opts.clientId ?? 'c'.repeat(32), source: 'env' as const },
    saveClientId: vi.fn(),
    clientSecret: () => opts.secret ?? '',
    saveClientSecret: vi.fn(),
    ...(opts.base ? { base: () => opts.base as string } : {}),
    deviceId: () => 'dev-1',
    deviceName: 'Test (linux)',
    openExternal: vi.fn().mockResolvedValue(undefined),
    copyText: vi.fn(),
    onResult: (r: LoginResult) => results.push(r),
    oauth: { fetch: fetchImpl as never, sleep: () => Promise.resolve() },
  };
  return { auth: new AuthService(deps), deps, client, results, fetchImpl };
}

describe('AuthService.start', () => {
  it('shows the code, opens the browser, and applies the tokens once confirmed', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(reply(200, CODE))
      .mockResolvedValueOnce(reply(400, { error: 'authorization_pending' }))
      .mockResolvedValueOnce(reply(200, { access_token: 'AT', refresh_token: 'RT' }));
    const { auth, deps, client, results } = make({ fetchImpl: f });
    const info = await auth.start();
    expect(info).toEqual({
      userCode: 'ABCD1234',
      verificationUrl: 'https://oauth.yandex.com/device',
      expiresIn: 300,
    });
    expect(deps.openExternal).toHaveBeenCalledWith('https://oauth.yandex.com/device');
    expect(deps.copyText).toHaveBeenCalledWith('ABCD1234'); // ready to paste in the browser
    await vi.waitFor(() => expect(results).toEqual([{ ok: true }]));
    expect(client.setAccessToken).toHaveBeenCalledWith('AT');
    expect(auth.getRefreshToken()).toBe('RT');
  });

  it('refuses to start without a client ID', async () => {
    const { auth, fetchImpl } = make({ clientId: '' });
    await expect(auth.start()).rejects.toThrow('No Client ID');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not open an untrusted verification page, but still shows the code', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(
        reply(200, { ...CODE, verification_url: 'https://evil.example/device' })
      )
      .mockResolvedValue(reply(400, { error: 'authorization_pending' }));
    const { auth, deps } = make({ fetchImpl: f });
    const info = await auth.start();
    expect(info.userCode).toBe('ABCD1234');
    expect(deps.openExternal).not.toHaveBeenCalled();
    auth.cancel();
  });

  it('a clipboard failure does not break the sign-in', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(reply(200, CODE))
      .mockResolvedValue(reply(200, { access_token: 'AT' }));
    const { auth, deps, results } = make({ fetchImpl: f });
    deps.copyText.mockImplementation(() => {
      throw new Error('no clipboard');
    });
    await auth.start();
    await vi.waitFor(() => expect(results[0]).toEqual({ ok: true }));
  });

  it('a browser that cannot be opened does not break the sign-in', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(reply(200, CODE))
      .mockResolvedValue(reply(200, { access_token: 'AT' }));
    const { auth, deps, results } = make({ fetchImpl: f });
    deps.openExternal.mockRejectedValue(new Error('no browser'));
    await auth.start();
    await vi.waitFor(() => expect(results[0]).toEqual({ ok: true }));
  });

  it.each([
    ['expired_token', 'expired'],
    ['access_denied', 'denied'],
    ['invalid_client', 'bad_client'],
  ])('reports %s as %s', async (error, kind) => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(reply(200, CODE))
      .mockResolvedValue(reply(400, { error }));
    const { auth, results } = make({ fetchImpl: f });
    await auth.start();
    await vi.waitFor(() => expect(results).toHaveLength(1));
    expect(results[0]).toMatchObject({ ok: false, kind });
  });

  it('cancel stops polling quietly: no result, no token', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(reply(200, CODE))
      .mockResolvedValue(reply(400, { error: 'authorization_pending' }));
    const { auth, results, client } = make({ fetchImpl: f });
    await auth.start();
    auth.cancel();
    await flush();
    await flush();
    expect(results).toEqual([]);
    expect(client.setAccessToken).not.toHaveBeenCalled();
  });

  it('starting again cancels the previous attempt', async () => {
    const f = vi.fn((url: string) =>
      Promise.resolve(
        url.endsWith('/device/code')
          ? reply(200, CODE)
          : reply(400, { error: 'authorization_pending' })
      )
    );
    const { auth, results } = make({ fetchImpl: f as never });
    await auth.start();
    await auth.start();
    auth.cancel();
    await flush();
    expect(results).toEqual([]);
  });

  it('fails cleanly when the code request itself is rejected', async () => {
    const f = vi.fn().mockResolvedValue(reply(400, { error: 'invalid_client' }));
    const { auth } = make({ fetchImpl: f });
    await expect(auth.start()).rejects.toBeInstanceOf(OAuthError);
  });
});

describe('AuthService.refresh', () => {
  it('exchanges the refresh token and applies the new access token', async () => {
    const f = vi.fn().mockResolvedValue(reply(200, { access_token: 'NEW', refresh_token: 'R2' }));
    const { auth, client } = make({ fetchImpl: f });
    auth.restore('R1');
    expect(await auth.refresh()).toBe(true);
    expect(client.setAccessToken).toHaveBeenCalledWith('NEW');
    expect(auth.getRefreshToken()).toBe('R2');
  });

  it('shares one request between concurrent callers', async () => {
    const f = vi.fn().mockResolvedValue(reply(200, { access_token: 'NEW' }));
    const { auth } = make({ fetchImpl: f });
    auth.restore('R1');
    const [a, b] = await Promise.all([auth.refresh(), auth.refresh()]);
    expect([a, b]).toEqual([true, true]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('returns false without a refresh token, without a client ID, or when Yandex refuses', async () => {
    const none = make();
    expect(await none.auth.refresh()).toBe(false);
    const noId = make({ clientId: '' });
    noId.auth.restore('R');
    expect(await noId.auth.refresh()).toBe(false);
    const refused = make({
      fetchImpl: vi.fn().mockResolvedValue(reply(400, { error: 'invalid_grant' })),
    });
    refused.auth.restore('R');
    expect(await refused.auth.refresh()).toBe(false);
    expect(refused.client.setAccessToken).not.toHaveBeenCalled();
  });

  it('a pasted token drops the refresh token', () => {
    const { auth } = make();
    auth.restore('R');
    auth.useManualToken();
    expect(auth.getRefreshToken()).toBeUndefined();
  });
});

describe('AuthService config', () => {
  it('reports where the client ID comes from and validates a new one', () => {
    const { auth, deps } = make();
    expect(auth.config()).toEqual({ source: 'env', clientId: 'c'.repeat(32), hasSecret: false });
    auth.setCredentials(` ${'d'.repeat(32)} `);
    expect(deps.saveClientId).toHaveBeenCalledWith('d'.repeat(32));
    expect(deps.saveClientSecret).not.toHaveBeenCalled(); // undefined keeps the saved secret
    auth.setCredentials('');
    expect(deps.saveClientId).toHaveBeenLastCalledWith('');
    expect(() => auth.setCredentials('bad id')).toThrow('Invalid Client ID');
  });

  it('saves, replaces and removes the secret, and says whether one is stored', () => {
    const { auth, deps } = make({ secret: 's'.repeat(32) });
    expect(auth.config().hasSecret).toBe(true);
    auth.setCredentials('d'.repeat(32), ` ${'e'.repeat(32)} `);
    expect(deps.saveClientSecret).toHaveBeenCalledWith('e'.repeat(32));
    auth.setCredentials('d'.repeat(32), '');
    expect(deps.saveClientSecret).toHaveBeenLastCalledWith('');
    expect(() => auth.setCredentials('d'.repeat(32), 'with space 123456')).toThrow(
      'Invalid Client secret'
    );
    expect(deps.saveClientId).toHaveBeenCalledTimes(2); // the bad secret saved nothing
  });
});

describe('helpers', () => {
  it('only Yandex https pages are opened for the code', () => {
    for (const ok of [
      'https://oauth.yandex.com/device',
      'https://oauth.yandex.ru/device',
      'https://ya.ru/device',
    ])
      expect(isTrustedVerificationUrl(ok)).toBe(true);
    for (const bad of [
      'http://oauth.yandex.com/device',
      'https://yandex.com.evil.example/device',
      'https://evilya.ru/',
      'javascript:alert(1)',
      'not a url',
    ])
      expect(isTrustedVerificationUrl(bad)).toBe(false);
  });

  it('classifies errors', () => {
    expect(classifyOAuthError(new OAuthError('invalid_grant'))).toEqual({ kind: 'expired' });
    expect(classifyOAuthError(new OAuthError('unauthorized_client'))).toEqual({
      kind: 'bad_client',
      detail: 'unauthorized_client',
    });
    expect(classifyOAuthError(new OAuthError('weird', 'x'))).toEqual({
      kind: 'other',
      detail: 'weird: x',
    });
    expect(classifyOAuthError(new Error('boom'))).toEqual({ kind: 'other', detail: 'boom' });
    expect(classifyOAuthError('str')).toEqual({ kind: 'other', detail: 'str' });
  });
});

describe('AuthService credentials in the exchange', () => {
  const bodyOf = (f: ReturnType<typeof vi.fn>, call: number) =>
    new URLSearchParams(f.mock.calls[call]![1].body as string);

  it('sends the stored secret with the token request and uses the OAuth site of the language', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(reply(200, CODE))
      .mockResolvedValue(reply(200, { access_token: 'AT' }));
    const { auth, results } = make({
      fetchImpl: f,
      secret: 's'.repeat(32),
      base: 'https://oauth.yandex.ru',
    });
    await auth.start();
    await vi.waitFor(() => expect(results[0]).toEqual({ ok: true }));
    expect(f.mock.calls[0]![0]).toBe('https://oauth.yandex.ru/device/code');
    expect(f.mock.calls[1]![0]).toBe('https://oauth.yandex.ru/token');
    expect(bodyOf(f, 1).get('client_secret')).toBe('s'.repeat(32));
    expect(bodyOf(f, 1).get('client_id')).toBe('c'.repeat(32));
  });

  it('a refresh carries the secret as well', async () => {
    const f = vi.fn().mockResolvedValue(reply(200, { access_token: 'NEW' }));
    const { auth } = make({ fetchImpl: f, secret: 's'.repeat(32) });
    auth.restore('RT');
    expect(await auth.refresh()).toBe(true);
    expect(bodyOf(f, 0).get('client_secret')).toBe('s'.repeat(32));
  });

  it('a rejected application reports the server code so the screen can show it', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(reply(200, CODE))
      .mockResolvedValue(reply(400, { error: 'invalid_client' }));
    const { auth, results } = make({ fetchImpl: f });
    await auth.start();
    await vi.waitFor(() =>
      expect(results[0]).toEqual({ ok: false, kind: 'bad_client', detail: 'invalid_client' })
    );
  });
});
