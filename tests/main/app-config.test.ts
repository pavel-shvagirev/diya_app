import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isValidClientId, resolveClientId, SettingsStore } from '../../src/main/app-config.js';

const ID_A = 'a'.repeat(32);
const ID_B = 'b0123456789abcdef0123456789abcde';

describe('resolveClientId', () => {
  it('prefers the custom ID, then the environment', () => {
    expect(resolveClientId({ custom: ID_A, env: ID_B })).toEqual({
      clientId: ID_A,
      source: 'custom',
    });
    expect(resolveClientId({ env: ID_B }).source).toBe('env');
  });

  it('skips malformed values and reports "none" when nothing is usable', () => {
    expect(resolveClientId({ custom: 'short', env: 'has space in it 1234' })).toEqual({
      clientId: '',
      source: 'none',
    });
    expect(resolveClientId({ custom: 'bad', env: ID_B }).source).toBe('env');
    expect(resolveClientId({}).source).toBe('none');
  });

  it('trims surrounding whitespace', () => {
    expect(resolveClientId({ custom: `  ${ID_A}\n` }).clientId).toBe(ID_A);
  });

  it('validates the shape', () => {
    expect(isValidClientId(ID_A)).toBe(true);
    for (const bad of ['', 'x'.repeat(15), 'x'.repeat(65), 'a b'.padEnd(20, 'c'), 'ключ'.repeat(6)])
      expect(isValidClientId(bad)).toBe(false);
  });
});

describe('files', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appcfg-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('SettingsStore keeps a custom client ID and removes it again', () => {
    const store = new SettingsStore(path.join(dir, 'nested', 'settings.json'));
    expect(store.getClientId()).toBe('');
    store.setClientId(` ${ID_A} `);
    expect(new SettingsStore(path.join(dir, 'nested', 'settings.json')).getClientId()).toBe(ID_A);
    store.setClientId('');
    expect(store.getClientId()).toBe('');
  });

  it('SettingsStore refuses a malformed client ID', () => {
    const store = new SettingsStore(path.join(dir, 's.json'));
    expect(() => store.setClientId('nope')).toThrow('Invalid Client ID');
  });

  it('the device ID is generated once and then stable; client ID changes do not reset it', () => {
    const file = path.join(dir, 's.json');
    const store = new SettingsStore(file);
    const id = store.getDeviceId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    store.setClientId(ID_A);
    expect(new SettingsStore(file).getDeviceId()).toBe(id);
  });

  it('survives a corrupt settings file', () => {
    const file = path.join(dir, 's.json');
    fs.writeFileSync(file, 'garbage');
    const store = new SettingsStore(file);
    expect(store.getClientId()).toBe('');
    expect(store.getDeviceId()).toBeTruthy();
    fs.writeFileSync(file, 'null');
    expect(store.getClientId()).toBe('');
  });
});

describe('SettingsStore language', () => {
  it('defaults to the system language, keeps a choice and ignores junk in the file', () => {
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'lang-'));
    try {
      const file = path.join(dir2, 'settings.json');
      const store = new SettingsStore(file);
      expect(store.getLanguage()).toBe('system');
      store.setClientId(ID_A);
      store.setLanguage('ru');
      expect(new SettingsStore(file).getLanguage()).toBe('ru');
      expect(new SettingsStore(file).getClientId()).toBe(ID_A); // other settings survive
      fs.writeFileSync(file, JSON.stringify({ language: 'klingon' }));
      expect(new SettingsStore(file).getLanguage()).toBe('system');
    } finally {
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  });
});
