import { describe, expect, it, vi } from 'vitest';

import {
  OAuthError,
  pollDeviceToken,
  refreshAccessToken,
  requestDeviceCode,
  type DeviceCode,
} from '../../src/main/oauth.js';

// Response shapes are copied from the official examples:
// https://yandex.com/dev/id/doc/en/codes/screen-code-oauth
const CODE_ANSWER = {
  device_code: '3e2a5a5c0e02439aa78a23442721848c',
  user_code: 'h5nbcr6c',
  verification_url: 'https://oauth.yandex.com/device',
  interval: 5,
  expires_in: 300,
};
const TOKEN_ANSWER = {
  token_type: 'bearer',
  access_token: 'test-access-token-0001',
  expires_in: 124234123534,
  refresh_token: 'test-refresh-token-0001',
};

const reply = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: () => Promise.resolve(body) }) as Response;

const code: DeviceCode = {
  deviceCode: 'dc',
  userCode: 'uc',
  verificationUrl: 'https://oauth.yandex.com/device',
  interval: 5,
  expiresIn: 300,
};

describe('requestDeviceCode', () => {
  it('posts client_id/device_id/device_name as a form and parses the response', async () => {
    const f = vi.fn().mockResolvedValue(reply(200, CODE_ANSWER));
    const out = await requestDeviceCode({ clientId: 'cid' }, 'dev-1', 'My PC', { fetch: f });
    expect(out).toEqual({
      deviceCode: CODE_ANSWER.device_code,
      userCode: 'h5nbcr6c',
      verificationUrl: 'https://oauth.yandex.com/device',
      interval: 5,
      expiresIn: 300,
    });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://oauth.yandex.com/device/code');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(new URLSearchParams(init.body).get('client_id')).toBe('cid');
    expect(new URLSearchParams(init.body).get('device_name')).toBe('My PC');
    expect(init.body).not.toContain('client_secret'); // public client: no secret
  });

  it('falls back to defaults for optional fields', async () => {
    const f = vi.fn().mockResolvedValue(reply(200, { device_code: 'a', user_code: 'b' }));
    const out = await requestDeviceCode({ clientId: 'c' }, 'd', 'n', { fetch: f });
    expect(out).toMatchObject({
      verificationUrl: 'https://oauth.yandex.com/device',
      interval: 5,
      expiresIn: 300,
    });
  });

  it('turns documented error responses into OAuthError with the code', async () => {
    const f = vi
      .fn()
      .mockResolvedValue(reply(400, { error: 'invalid_client', error_description: 'not found' }));
    await expect(
      requestDeviceCode({ clientId: 'x' }, 'd', 'n', { fetch: f })
    ).rejects.toMatchObject({
      name: 'OAuthError',
      code: 'invalid_client',
    });
  });

  it('rejects a response without codes and a non-JSON failure', async () => {
    await expect(
      requestDeviceCode({ clientId: 'c' }, 'd', 'n', {
        fetch: vi.fn().mockResolvedValue(reply(200, {})),
      })
    ).rejects.toMatchObject({ code: 'invalid_response' });
    const broken = { ok: false, status: 502, json: () => Promise.reject(new Error('html')) };
    await expect(
      requestDeviceCode({ clientId: 'c' }, 'd', 'n', { fetch: vi.fn().mockResolvedValue(broken) })
    ).rejects.toMatchObject({ code: 'http_502' });
  });
});

describe('pollDeviceToken', () => {
  const pending = () => reply(400, { error: 'authorization_pending' });

  it('keeps asking while the response is authorization_pending, then returns the tokens', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(pending())
      .mockResolvedValueOnce(pending())
      .mockResolvedValueOnce(reply(200, TOKEN_ANSWER));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const out = await pollDeviceToken({ clientId: 'cid' }, code, new AbortController().signal, {
      fetch: f,
      sleep,
    });
    expect(out.accessToken).toBe(TOKEN_ANSWER.access_token);
    expect(out.refreshToken).toBe(TOKEN_ANSWER.refresh_token);
    expect(f).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledWith(5000); // never faster than the server's interval
    const body = new URLSearchParams(f.mock.calls[0]![1].body);
    expect(body.get('grant_type')).toBe('device_code');
    expect(body.get('code')).toBe('dc');
  });

  it.each(['invalid_grant', 'access_denied', 'invalid_client', 'unauthorized_client'])(
    'stops on %s',
    async error => {
      const f = vi.fn().mockResolvedValue(reply(400, { error }));
      await expect(
        pollDeviceToken({ clientId: 'c' }, code, new AbortController().signal, { fetch: f })
      ).rejects.toMatchObject({ code: error });
      expect(f).toHaveBeenCalledTimes(1);
    }
  );

  it('gives up when the code lifetime is over', async () => {
    let t = 0;
    const f = vi.fn().mockResolvedValue(pending());
    const out = pollDeviceToken(
      { clientId: 'c' },
      { ...code, expiresIn: 10, interval: 5 },
      new AbortController().signal,
      {
        fetch: f,
        sleep: () => {
          t += 6000;
          return Promise.resolve();
        },
        now: () => t,
      }
    );
    await expect(out).rejects.toMatchObject({ code: 'expired_token' });
  });

  it('can be cancelled', async () => {
    const ac = new AbortController();
    const f = vi.fn().mockResolvedValue(pending());
    const out = pollDeviceToken({ clientId: 'c' }, code, ac.signal, {
      fetch: f,
      sleep: () => {
        ac.abort();
        return Promise.resolve();
      },
    });
    await expect(out).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('rejects a response that has no access_token', async () => {
    const f = vi.fn().mockResolvedValue(reply(200, { token_type: 'bearer' }));
    await expect(
      pollDeviceToken({ clientId: 'c' }, code, new AbortController().signal, { fetch: f })
    ).rejects.toBeInstanceOf(OAuthError);
  });
});

describe('refreshAccessToken', () => {
  it('exchanges the refresh token and keeps the old one if no new one comes back', async () => {
    const f = vi.fn().mockResolvedValue(reply(200, { access_token: 'new', expires_in: 100 }));
    const out = await refreshAccessToken({ clientId: 'cid' }, 'old-refresh', { fetch: f });
    expect(out).toEqual({ accessToken: 'new', refreshToken: 'old-refresh', expiresIn: 100 });
    const body = new URLSearchParams(f.mock.calls[0]![1].body);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('old-refresh');
  });

  it('adopts a rotated refresh token and reports rejection', async () => {
    const ok = vi
      .fn()
      .mockResolvedValue(reply(200, { access_token: 'n', refresh_token: 'rotated' }));
    expect((await refreshAccessToken({ clientId: 'c' }, 'r', { fetch: ok })).refreshToken).toBe(
      'rotated'
    );
    const bad = vi.fn().mockResolvedValue(reply(400, { error: 'invalid_grant' }));
    await expect(refreshAccessToken({ clientId: 'c' }, 'r', { fetch: bad })).rejects.toMatchObject({
      code: 'invalid_grant',
    });
  });
});

describe('application secret and OAuth site', () => {
  const pendingThenToken = () =>
    vi
      .fn()
      .mockResolvedValueOnce(reply(200, TOKEN_ANSWER))
      .mockResolvedValue(reply(200, TOKEN_ANSWER));
  const bodyOf = (f: ReturnType<typeof vi.fn>, call = 0) =>
    new URLSearchParams(f.mock.calls[call]![1].body);

  it('the token exchange carries the secret next to the ID — Yandex asks for both', async () => {
    const f = pendingThenToken();
    await pollDeviceToken(
      { clientId: 'cid', clientSecret: 'sec' },
      code,
      new AbortController().signal,
      { fetch: f }
    );
    expect(bodyOf(f).get('client_id')).toBe('cid');
    expect(bodyOf(f).get('client_secret')).toBe('sec');
  });

  it('refreshing carries the secret too; without a secret the field is simply absent', async () => {
    const f = pendingThenToken();
    await refreshAccessToken({ clientId: 'cid', clientSecret: 'sec' }, 'r', { fetch: f });
    expect(bodyOf(f).get('client_secret')).toBe('sec');
    await refreshAccessToken({ clientId: 'cid' }, 'r', { fetch: f });
    expect(bodyOf(f, 1).has('client_secret')).toBe(false);
  });

  it('the code request never carries the secret', async () => {
    const f = vi.fn().mockResolvedValue(reply(200, CODE_ANSWER));
    await requestDeviceCode({ clientId: 'cid', clientSecret: 'sec' }, 'd', 'n', { fetch: f });
    expect(bodyOf(f).has('client_secret')).toBe(false);
  });

  it('talks to the OAuth site it is given (.ru for the Russian interface)', async () => {
    const f = vi.fn().mockResolvedValue(reply(200, { ...CODE_ANSWER, verification_url: '' }));
    const out = await requestDeviceCode(
      { clientId: 'c', base: 'https://oauth.yandex.ru' },
      'd',
      'n',
      { fetch: f }
    );
    expect(f.mock.calls[0]![0]).toBe('https://oauth.yandex.ru/device/code');
    expect(out.verificationUrl).toBe('https://oauth.yandex.ru/device');
  });
});
