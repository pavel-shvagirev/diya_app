import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthPage, extractToken } from '../../src/renderer/pages/AuthPage.js';
import { t } from '../../src/renderer/lib/strings.js';
import type { LoginFailure } from '../../src/shared/types.js';

const ID = 'a'.repeat(32);
const SECRET = 'f'.repeat(32);
const secretLabel = new RegExp(t.authClientSecretLabel.replace(/[()]/g, String.raw`\$&`));
let failCb: (f: LoginFailure) => void = () => undefined;
const api = {
  authConfig: vi.fn(),
  authLogin: vi.fn(),
  authLoginCancel: vi.fn().mockResolvedValue(undefined),
  authSetClientId: vi.fn(),
  authSetToken: vi.fn(),
  openExternal: vi.fn().mockResolvedValue(undefined),
  onAuthLoginFailed: vi.fn((cb: typeof failCb) => {
    failCb = cb;
    return () => undefined;
  }),
};

beforeEach(() => {
  vi.clearAllMocks();
  api.authConfig.mockResolvedValue({ source: 'custom', clientId: ID, hasSecret: true });
  api.authLogin.mockResolvedValue({
    userCode: 'ABCD1234',
    verificationUrl: 'https://oauth.yandex.com/device',
    expiresIn: 300,
  });
  (window as unknown as { api: unknown }).api = api;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const ready = async () => {
  render(<AuthPage />);
  await waitFor(() => expect(api.authConfig).toHaveBeenCalled());
  await screen.findByText(t.authSignIn);
};

describe('AuthPage sign-in', () => {
  it('one button starts the sign-in and shows the code, the countdown and a cancel button', async () => {
    await ready();
    fireEvent.click(screen.getByText(t.authSignIn));
    expect(await screen.findByTestId('user-code')).toHaveTextContent('ABCD1234');
    expect(screen.getByText(/5:00/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(t.authCopyCode));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('ABCD1234');
    fireEvent.click(screen.getByText(t.authOpenAgain));
    expect(api.openExternal).toHaveBeenCalledWith('https://oauth.yandex.com/device');
    fireEvent.click(screen.getByText(t.authCancel));
    expect(api.authLoginCancel).toHaveBeenCalled();
    await screen.findByText(t.authSignIn);
  });

  it('the countdown ticks', async () => {
    await ready();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(screen.getByText(t.authSignIn));
    await screen.findByTestId('user-code');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    expect(screen.getByText(/3:5\d|4:0\d/)).toBeInTheDocument();
  });

  it.each([
    ['expired', t.authFailedExpired],
    ['denied', t.authFailedDenied],
    ['bad_client', t.authFailedBadClient('boom', true)],
    ['other', t.authFailedOther('boom')],
  ] as const)(
    'a %s failure is explained and the button offers to try again',
    async (kind, text) => {
      await ready();
      fireEvent.click(screen.getByText(t.authSignIn));
      await screen.findByTestId('user-code');
      act(() => failCb({ kind, detail: 'boom' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(text);
      expect(screen.getByText(t.authTryAgain)).toBeEnabled();
      expect(screen.queryByTestId('user-code')).toBeNull();
    }
  );

  it('a request that fails right away shows the reason', async () => {
    api.authLogin.mockRejectedValue(new Error('No Client ID configured'));
    await ready();
    fireEvent.click(screen.getByText(t.authSignIn));
    expect(await screen.findByRole('alert')).toHaveTextContent('No Client ID configured');
    api.authLogin.mockRejectedValue('plain');
    fireEvent.click(screen.getByText(t.authTryAgain));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('plain'));
  });
});

describe('AuthPage without a Client ID', () => {
  beforeEach(() =>
    api.authConfig.mockResolvedValue({ source: 'none', clientId: '', hasSecret: false })
  );

  it('explains the situation, hides the sign-in button and opens the setup guide', async () => {
    render(<AuthPage />);
    expect(await screen.findByText(t.authNoClientId)).toBeInTheDocument();
    expect(screen.queryByText(t.authSignIn)).toBeNull();
    expect(document.querySelector('details')).toHaveAttribute('open');
  });

  it('saves the typed Client ID and secret without any environment variable, then offers the button', async () => {
    api.authSetClientId.mockResolvedValue({ source: 'custom', clientId: ID, hasSecret: true });
    render(<AuthPage />);
    await screen.findByText(t.authNoClientId);
    fireEvent.change(screen.getByLabelText(t.authClientIdLabel), { target: { value: ID } });
    fireEvent.change(screen.getByLabelText(secretLabel), {
      target: { value: SECRET },
    });
    fireEvent.click(screen.getByText(t.authClientIdSave));
    await waitFor(() => expect(api.authSetClientId).toHaveBeenCalledWith(ID, SECRET));
    expect(await screen.findByText(t.authSignIn)).toBeEnabled();
    expect(screen.getByLabelText(t.authClientIdLabel)).toHaveValue(ID);
    expect(screen.getByLabelText(secretLabel)).toHaveValue(''); // never echoed back
    expect(screen.getByLabelText(new RegExp(t.authSecretSaved))).toBeInTheDocument();
    api.authSetClientId.mockResolvedValue({ source: 'none', clientId: '', hasSecret: false });
    fireEvent.click(screen.getByText(t.authClientIdClear));
    await waitFor(() => expect(api.authSetClientId).toHaveBeenLastCalledWith('', ''));
    await screen.findByText(t.authNoClientId);
  });

  it('the button waits for both values: an ID alone is not enough', async () => {
    api.authConfig.mockResolvedValue({ source: 'custom', clientId: ID, hasSecret: false });
    render(<AuthPage />);
    await screen.findByText(t.authNoClientId);
    expect(screen.queryByText(t.authSignIn)).toBeNull();
  });

  it('an empty secret field keeps the saved secret', async () => {
    api.authConfig.mockResolvedValue({ source: 'custom', clientId: ID, hasSecret: true });
    api.authSetClientId.mockResolvedValue({ source: 'custom', clientId: ID, hasSecret: true });
    render(<AuthPage />);
    await screen.findByText(t.authSignIn);
    fireEvent.click(screen.getByText(t.authClientIdSave));
    await waitFor(() => expect(api.authSetClientId).toHaveBeenCalledWith(ID, undefined));
  });

  it('rejects a malformed Client secret before asking the main process', async () => {
    render(<AuthPage />);
    await screen.findByText(t.authNoClientId);
    fireEvent.change(screen.getByLabelText(secretLabel), {
      target: { value: 'has space in it' },
    });
    fireEvent.click(screen.getByText(t.authClientIdSave));
    expect(await screen.findByRole('alert')).toHaveTextContent(t.authClientSecretInvalid);
    expect(api.authSetClientId).not.toHaveBeenCalled();
  });

  it('rejects a malformed Client ID before asking the main process', async () => {
    render(<AuthPage />);
    await screen.findByText(t.authNoClientId);
    fireEvent.change(screen.getByLabelText(t.authClientIdLabel), { target: { value: 'short' } });
    fireEvent.click(screen.getByText(t.authClientIdSave));
    expect(await screen.findByRole('alert')).toHaveTextContent(t.authClientIdInvalid);
    expect(api.authSetClientId).not.toHaveBeenCalled();
  });

  it('shows the main process error when saving fails', async () => {
    api.authSetClientId.mockRejectedValue(new Error('disk full'));
    render(<AuthPage />);
    await screen.findByText(t.authNoClientId);
    fireEvent.change(screen.getByLabelText(t.authClientIdLabel), { target: { value: ID } });
    fireEvent.click(screen.getByText(t.authClientIdSave));
    expect(await screen.findByRole('alert')).toHaveTextContent('disk full');
  });
});

describe('AuthPage token', () => {
  it('signs in with a pasted token and tells the app', async () => {
    api.authSetToken.mockResolvedValue(undefined);
    const done = vi.fn();
    render(<AuthPage onAuthenticated={done} />);
    await screen.findByText(t.authSignIn);
    const submit = screen.getByText(t.authTokenSubmit).closest('button')!;
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('OAuth token'), { target: { value: 'y0_x' } });
    fireEvent.click(submit);
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(api.authSetToken).toHaveBeenCalledWith('y0_x');
  });

  it('shows why a token was refused', async () => {
    api.authSetToken.mockRejectedValue(new Error('Token rejected by Yandex.Disk'));
    render(<AuthPage />);
    await screen.findByText(t.authSignIn);
    fireEvent.change(screen.getByLabelText('OAuth token'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByText(t.authTokenSubmit));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      `${t.authTokenFailed}: Token rejected by Yandex.Disk`
    );
  });
});

describe('AuthPage setup guide', () => {
  it('opens the app registration page and the token page for the saved Client ID', async () => {
    render(<AuthPage />);
    await screen.findByText(t.authSignIn);
    fireEvent.click(screen.getByText(t.authOpenRegister));
    expect(api.openExternal).toHaveBeenCalledWith('https://oauth.yandex.com/client/new/');
    fireEvent.click(screen.getByText(t.authOpenTokenPage));
    expect(api.openExternal).toHaveBeenLastCalledWith(
      `https://oauth.yandex.com/authorize?response_type=token&client_id=${ID}`
    );
  });

  it('cannot open the token page before a Client ID is saved', async () => {
    api.authConfig.mockResolvedValue({ source: 'none', clientId: '', hasSecret: false });
    render(<AuthPage />);
    await screen.findByText(t.authNoClientId);
    expect(screen.getByText(t.authOpenTokenPage).closest('button')).toBeDisabled();
  });

  it('lists every step of the registration', async () => {
    render(<AuthPage />);
    await screen.findByText(t.authSignIn);
    for (const step of t.authSteps) expect(screen.getByText(step)).toBeInTheDocument();
  });

  it('takes the token out of a pasted redirect address', async () => {
    api.authSetToken.mockResolvedValue(undefined);
    render(<AuthPage />);
    await screen.findByText(t.authSignIn);
    fireEvent.change(screen.getByLabelText('OAuth token'), {
      target: {
        value: 'https://oauth.yandex.com/verification_code#access_token=y0_abc&expires_in=31536000',
      },
    });
    fireEvent.click(screen.getByText(t.authTokenSubmit));
    await waitFor(() => expect(api.authSetToken).toHaveBeenCalledWith('y0_abc'));
  });

  it('extractToken keeps a bare token and trims it', () => {
    expect(extractToken('  y0_plain \n')).toBe('y0_plain');
    expect(extractToken('#access_token=T1')).toBe('T1');
  });
});

describe('AuthPage OAuth site follows the interface language', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it.each([
    ['ru', 'https://oauth.yandex.ru'],
    ['en', 'https://oauth.yandex.com'],
  ])('%s interface opens %s', async (language, host) => {
    window.history.replaceState(null, '', `/?lang=${language}`);
    vi.resetModules();
    const { AuthPage: Page } = await import('../../src/renderer/pages/AuthPage.js');
    const { t: dict } = await import('../../src/renderer/lib/strings.js');
    render(<Page />);
    await screen.findByText(dict.authSignIn);
    fireEvent.click(screen.getByText(dict.authOpenRegister));
    expect(api.openExternal).toHaveBeenCalledWith(`${host}/client/new/`);
    fireEvent.click(screen.getByText(dict.authOpenTokenPage));
    expect(api.openExternal).toHaveBeenLastCalledWith(
      `${host}/authorize?response_type=token&client_id=${ID}`
    );
  });
});

describe('AuthPage failure explains the cause', () => {
  it('a rejected application shows the server code and hints at a missing secret', async () => {
    api.authConfig.mockResolvedValue({ source: 'custom', clientId: ID, hasSecret: true });
    await ready();
    fireEvent.click(screen.getByText(t.authSignIn));
    await screen.findByTestId('user-code');
    act(() => failCb({ kind: 'bad_client', detail: 'invalid_client' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('invalid_client');
    expect(alert).not.toHaveTextContent(/no secret entered/);
  });
});
