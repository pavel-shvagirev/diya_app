import { beforeEach, describe, expect, it, vi } from 'vitest';

let _isEncryptionAvailable = true;
let _backend: string | undefined = 'gnome_libsecret';
const permissionHandlers: { request?: (...a: unknown[]) => void; check?: () => boolean } = {};
const constructed: Array<{
  options: Record<string, unknown>;
  headersCb?: (d: unknown, cb: (r: unknown) => void) => void;
}> = [];

vi.mock('electron', () => {
  class _BrowserWindow {
    meta: (typeof constructed)[number];
    webContents = {
      session: {
        setPermissionRequestHandler: (cb: (...a: unknown[]) => void) => {
          permissionHandlers.request = cb;
        },
        setPermissionCheckHandler: (cb: () => boolean) => {
          permissionHandlers.check = cb;
        },
        webRequest: {
          onHeadersReceived: (cb: (d: unknown, c: (r: unknown) => void) => void) => {
            this.meta.headersCb = cb;
          },
        },
      },
    };
    constructor(options: Record<string, unknown>) {
      this.meta = { options };
      constructed.push(this.meta);
    }
  }
  return {
    safeStorage: {
      isEncryptionAvailable: () => _isEncryptionAvailable,
      getSelectedStorageBackend: () => _backend,
      encryptString: () => Buffer.from('encrypted-token'),
      decryptString: () => 'plaintext-token',
    },
    BrowserWindow: _BrowserWindow,
  };
});

import {
  createSecureWindow,
  initAppSecurity,
  isAllowedNavigation,
  isTrustedSender,
  trusted,
  safeStorage,
} from '../../src/main/security.js';
import { CSP_HEADERS } from '../../src/shared/constants.js';

describe('safeStorage', () => {
  beforeEach(() => {
    _isEncryptionAvailable = true;
  });

  it('encrypts to base64 and decrypts back', () => {
    const encrypted = safeStorage.encrypt('secret');
    expect(Buffer.from(encrypted, 'base64').toString()).toBe('encrypted-token');
    expect(safeStorage.decrypt(encrypted)).toBe('plaintext-token');
  });

  it('refuses to work without OS encryption instead of storing plaintext', () => {
    _isEncryptionAvailable = false;
    expect(() => safeStorage.encrypt('x')).toThrow('Encryption not available');
    expect(() => safeStorage.decrypt('x')).toThrow('Encryption not available');
  });
});

describe('safeStorage backend', () => {
  beforeEach(() => {
    _isEncryptionAvailable = true;
    _backend = 'gnome_libsecret';
  });

  it('refuses the Linux plain-text fallback: obfuscation is not encryption', () => {
    for (const weak of ['basic_text', 'unknown']) {
      _backend = weak;
      expect(() => safeStorage.encrypt('x')).toThrow('Encryption not available');
      expect(() => safeStorage.decrypt('x')).toThrow('Encryption not available');
    }
  });

  it('accepts a real keyring and platforms that report no backend', () => {
    for (const ok of ['gnome_libsecret', 'kwallet5', 'kwallet6', undefined]) {
      _backend = ok;
      expect(() => safeStorage.encrypt('x')).not.toThrow();
    }
  });
});

describe('IPC sender check', () => {
  it('trusts our own pages only', () => {
    expect(isTrustedSender({ senderFrame: { url: 'file:///app/dist/renderer/index.html' } })).toBe(
      true
    );
    for (const bad of [
      {},
      { senderFrame: null },
      { senderFrame: { url: '' } },
      { senderFrame: { url: 'https://oauth.yandex.com/device' } },
      { senderFrame: { url: 'data:text/html,<script>1</script>' } },
    ])
      expect(isTrustedSender(bad)).toBe(false);
  });

  it('trusted() runs the handler for a trusted sender and throws for others', () => {
    const fn = vi.fn().mockReturnValue(7);
    const wrapped = trusted(fn);
    expect(wrapped({ senderFrame: { url: 'file:///x/renderer/index.html' } }, 1, 2)).toBe(7);
    expect(fn).toHaveBeenCalledWith(
      { senderFrame: { url: 'file:///x/renderer/index.html' } },
      1,
      2
    );
    expect(() => wrapped({ senderFrame: { url: 'https://evil.example/' } }, 1)).toThrow(
      'Untrusted IPC sender'
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('isAllowedNavigation', () => {
  it("allows the app's own files only", () => {
    for (const ok of [
      'file:///app/dist/renderer/index.html?lang=en',
      'file:///app/dist/renderer/log.html',
      'file:///C:/Users/u/AppData/Local/Programs/Diya/resources/app.asar/dist/renderer/index.html',
    ])
      expect(isAllowedNavigation(ok, undefined), ok).toBe(true);
    for (const bad of [
      // any other file on the disk, even one that looks like a page, is not the app
      'file:///etc/passwd',
      'file:///tmp/evil.html',
      'file:///app/dist/renderer/other.html',
      'file:///app/dist/renderer/../../../tmp/evil.html',
      'file:///tmp/renderer/index.html.txt',
      'https://oauth.yandex.com/device',
      'https://evil-yandex.net.attacker.example/',
      'http://localhost:5173/',
      'javascript:alert(1)',
      'not a url',
    ])
      expect(isAllowedNavigation(bad, undefined)).toBe(false);
  });

  it('allows the dev server origin while developing', () => {
    expect(isAllowedNavigation('http://localhost:5173/log.html', 'http://localhost:5173')).toBe(
      true
    );
    expect(isAllowedNavigation('http://localhost:9999/', 'http://localhost:5173')).toBe(false);
  });
});

describe('createSecureWindow', () => {
  it('forces the hardened web preferences over whatever the caller passes', () => {
    constructed.length = 0;
    createSecureWindow({
      width: 800,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
        preload: '/p.js',
      },
    });
    expect(constructed[0]!.options).toMatchObject({
      width: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        preload: '/p.js',
      },
    });
  });

  it('denies every permission request and check (camera, microphone, notifications …)', () => {
    createSecureWindow({});
    const answer = vi.fn();
    permissionHandlers.request!({}, 'media', answer);
    expect(answer).toHaveBeenCalledWith(false);
    expect(permissionHandlers.check!()).toBe(false);
  });

  it('adds the CSP header to every response', () => {
    constructed.length = 0;
    createSecureWindow({});
    const cb = vi.fn();
    constructed[0]!.headersCb!({ responseHeaders: { 'X-A': ['1'] } }, cb);
    expect(cb).toHaveBeenCalledWith({ responseHeaders: { 'X-A': ['1'], ...CSP_HEADERS } });
  });

  it('the CSP forbids remote scripts, plugins, forms and base-URI changes', () => {
    const csp = CSP_HEADERS['Content-Security-Policy'];
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toMatch(/https?:\/\/(?!\*)/);
  });
});

describe('initAppSecurity', () => {
  function setup() {
    let created: (e: unknown, c: unknown) => void = () => undefined;
    const app = {
      on: vi.fn(
        (ev: string, cb: typeof created) => ev === 'web-contents-created' && (created = cb)
      ),
    };
    initAppSecurity(app as never);
    const handlers: Record<string, (e: { preventDefault: () => void }, u?: string) => void> = {};
    let openHandler: (() => { action: string }) | undefined;
    created(
      {},
      {
        on: (ev: string, cb: never) => (handlers[ev] = cb),
        setWindowOpenHandler: (h: typeof openHandler) => (openHandler = h),
      }
    );
    return { handlers, openHandler: () => openHandler! };
  }

  it("blocks navigation away from the app, allows the app's own page", () => {
    const { handlers } = setup();
    const block = { preventDefault: vi.fn() };
    handlers['will-navigate']!(block, 'https://evil.example/');
    expect(block.preventDefault).toHaveBeenCalled();
    const ok = { preventDefault: vi.fn() };
    handlers['will-navigate']!(ok, 'file:///app/dist/renderer/index.html');
    expect(ok.preventDefault).not.toHaveBeenCalled();
  });

  it('refuses webviews and denies every new window', () => {
    const { handlers, openHandler } = setup();
    const e = { preventDefault: vi.fn() };
    handlers['will-attach-webview']!(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(openHandler()()).toEqual({ action: 'deny' });
  });
});
