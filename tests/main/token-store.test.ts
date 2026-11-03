import fs from 'fs';
import os from 'os';
import path from 'path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { SecretFile, TokenStore } from '../../src/main/token-store.js';

const crypto = {
  encrypt: (s: string) => Buffer.from(`enc:${s}`).toString('base64'),
  decrypt: (s: string) => Buffer.from(s, 'base64').toString().replace(/^enc:/, ''),
};

describe('TokenStore', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokstore-'));
    file = path.join(dir, 'token.bin');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('round-trips a token and never writes it in plaintext', () => {
    const store = new TokenStore(file, crypto);
    store.save({ accessToken: 'secret-token', refreshToken: 'secret-refresh' });
    const onDisk = fs.readFileSync(file, 'utf8');
    expect(onDisk).not.toContain('secret-token');
    expect(new TokenStore(file, crypto).load()).toEqual({
      accessToken: 'secret-token',
      refreshToken: 'secret-refresh',
    });
  });

  it('a session without a refresh token round-trips too', () => {
    const store = new TokenStore(file, crypto);
    store.save({ accessToken: 'only-access' });
    expect(store.load()).toEqual({ accessToken: 'only-access' });
  });

  it('reads the bare token string an older build wrote', () => {
    fs.writeFileSync(file, crypto.encrypt('legacy-token'));
    expect(new TokenStore(file, crypto).load()).toEqual({ accessToken: 'legacy-token' });
  });

  it('treats an empty or odd JSON payload as a bare token / nothing', () => {
    fs.writeFileSync(file, crypto.encrypt(''));
    expect(new TokenStore(file, crypto).load()).toBeNull();
    fs.writeFileSync(file, crypto.encrypt('{"v":1,"accessToken":5}'));
    expect(new TokenStore(file, crypto).load()).toEqual({ accessToken: '{"v":1,"accessToken":5}' });
  });

  it('load returns null when nothing is stored', () => {
    expect(new TokenStore(file, crypto).load()).toBeNull();
  });

  it('load returns null for a corrupt file', () => {
    fs.writeFileSync(file, '%%%not-base64-enc%%%');
    const bad = {
      ...crypto,
      decrypt: () => {
        throw new Error('bad');
      },
    };
    expect(new TokenStore(file, bad).load()).toBeNull();
  });

  it('clear removes the stored token', () => {
    const store = new TokenStore(file, crypto);
    store.save({ accessToken: 't' });
    store.clear();
    expect(fs.existsSync(file)).toBe(false);
    expect(store.load()).toBeNull();
  });
});

describe('SecretFile', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secfile-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('keeps the secret encrypted, returns it, and forgets it on clear', () => {
    const file = path.join(dir, 'nested', 'client-secret.bin');
    const store = new SecretFile(file, crypto);
    expect(store.get()).toBe('');
    store.set('s3cr3t');
    expect(fs.readFileSync(file, 'utf8')).not.toContain('s3cr3t');
    expect(new SecretFile(file, crypto).get()).toBe('s3cr3t');
    store.clear();
    expect(store.get()).toBe('');
    expect(() => store.clear()).not.toThrow();
  });

  it('lets set() fail when encryption is unavailable, and reads as empty when undecryptable', () => {
    const broken = {
      encrypt: () => {
        throw new Error('Encryption not available');
      },
      decrypt: () => {
        throw new Error('nope');
      },
    };
    const file = path.join(dir, 'client-secret.bin');
    expect(() => new SecretFile(file, broken).set('x')).toThrow('Encryption not available');
    fs.writeFileSync(file, 'garbage');
    expect(new SecretFile(file, broken).get()).toBe('');
  });
});
