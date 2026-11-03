import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assertSafeSyncFolder } from '../../src/main/sync-folder.js';

let root: string;
let home: string;
let userData: string;
let good: string;

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'syncfolder-')));
  home = path.join(root, 'home', 'me');
  userData = path.join(home, 'AppData', 'diya');
  good = path.join(home, 'Diya');
  for (const d of [home, userData, good]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(root, 'a-file.txt'), 'x');
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const rules = () => ({ home, protectedPaths: [userData] });

describe('assertSafeSyncFolder', () => {
  it('accepts a dedicated folder and returns its real path', () => {
    expect(assertSafeSyncFolder(good, rules())).toBe(fs.realpathSync(good));
  });

  it('refuses what does not exist or is not a folder', () => {
    expect(() => assertSafeSyncFolder(path.join(root, 'nope'), rules())).toThrow('existing folder');
    expect(() => assertSafeSyncFolder(path.join(root, 'a-file.txt'), rules())).toThrow(
      'existing folder'
    );
  });

  it('refuses the filesystem root', () => {
    expect(() => assertSafeSyncFolder(path.parse(root).root, rules())).toThrow('whole disk');
  });

  it('refuses the home folder and every folder above it', () => {
    expect(() => assertSafeSyncFolder(home, rules())).toThrow('home folder');
    expect(() => assertSafeSyncFolder(path.dirname(home), rules())).toThrow('home folder');
    expect(() => assertSafeSyncFolder(root, rules())).toThrow('home folder');
  });

  it('refuses the application data folder, anything inside it and anything containing it', () => {
    expect(() => assertSafeSyncFolder(userData, rules())).toThrow('own data');
    const inside = path.join(userData, 'logs');
    fs.mkdirSync(inside);
    expect(() => assertSafeSyncFolder(inside, rules())).toThrow('own data');
    const rules2 = { home: path.join(root, 'elsewhere'), protectedPaths: [good] };
    expect(() => assertSafeSyncFolder(home, rules2)).toThrow('own data');
  });

  it('compares real paths: a link to the home folder is still the home folder', () => {
    const link = path.join(root, 'link-to-home');
    fs.symlinkSync(home, link);
    expect(() => assertSafeSyncFolder(link, rules())).toThrow('home folder');
  });

  it('refuses system folders on POSIX (only checked where they exist)', () => {
    for (const sys of ['/usr', '/etc', '/System', '/Library'].filter(p => fs.existsSync(p))) {
      expect(() => assertSafeSyncFolder(sys, { home, platform: 'linux' })).toThrow(/system|home/i);
    }
  });

  it('a protected path that does not exist yet is compared as written', () => {
    const missing = path.join(root, 'not-created-yet');
    expect(assertSafeSyncFolder(good, { home, protectedPaths: [missing] })).toBe(
      fs.realpathSync(good)
    );
  });

  it('an unresolvable home folder is compared as written', () => {
    expect(assertSafeSyncFolder(good, { home: path.join(root, 'no-such-home') })).toBe(
      fs.realpathSync(good)
    );
  });
});
