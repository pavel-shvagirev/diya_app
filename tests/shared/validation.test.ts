import { resolve } from 'path';

import { describe, it, expect } from 'vitest';

import {
  resolveSafePath,
  validatePath,
  validateLocalPath,
  validateRemotePath,
  validateResourceName,
  validateUrl,
} from '../../src/shared/validation';

// ── resolveSafePath ────────────────────────────────────────────

describe('resolveSafePath', () => {
  it('resolves a simple file path within base', () => {
    const result = resolveSafePath('/sync/root', 'file.txt');
    expect(result).toBe(resolve('/sync/root/file.txt'));
  });

  it('blocks path traversal attempt', () => {
    expect(() => resolveSafePath('/sync/root', '../etc/passwd')).toThrow(
      'Path traversal attempt blocked'
    );
  });

  it('normalizes dot-dots within allowed range', () => {
    const result = resolveSafePath('/sync/root', 'dir/../dir2/file.txt');
    expect(result).toBe(resolve('/sync/root/dir2/file.txt'));
  });

  it('rejects empty base or target', () => {
    expect(() => resolveSafePath('', 'file.txt')).toThrow(
      'Path resolution requires non-empty base and target'
    );
    expect(() => resolveSafePath('/sync/root', '')).toThrow(
      'Path resolution requires non-empty base and target'
    );
  });

  it('handles absolute-like paths safely', () => {
    const result = resolveSafePath('/sync/root', './file.txt');
    expect(result).toBe(resolve('/sync/root/file.txt'));
  });
});

// ── validatePath ───────────────────────────────────────────────

describe('validatePath', () => {
  it('accepts a valid relative path', () => {
    expect(validatePath('folder/file.txt')).toBe('folder/file.txt');
  });

  it('trims whitespace', () => {
    expect(validatePath('  folder  ')).toBe('folder');
  });

  it('rejects empty string', () => {
    expect(() => validatePath('')).toThrow('Path cannot be empty');
  });

  it('rejects null/undefined', () => {
    // @ts-expect-error intentional test for invalid input
    expect(() => validatePath(null!)).toThrow('Path must be a non-empty string');
    expect(() => validatePath(undefined!)).toThrow('Path must be a non-empty string');
  });

  it('rejects paths starting with ..', () => {
    expect(() => validatePath('../../escape')).toThrow('Path cannot start with traversal');
  });

  it('rejects absolute paths', () => {
    expect(() => validatePath('/etc/passwd')).toThrow('Path cannot start with traversal');
  });
});

// ── validateRemotePath ────────────────────────────────────────

describe('validateLocalPath', () => {
  it('accepts an absolute POSIX path', () => {
    expect(validateLocalPath('/Users/me/SyncFolder')).toBe('/Users/me/SyncFolder');
  });

  it('accepts an absolute Windows path', () => {
    expect(validateLocalPath('C:\\Users\\me\\SyncFolder')).toBe('C:\\Users\\me\\SyncFolder');
  });

  it('trims whitespace', () => {
    expect(validateLocalPath('  /Users/me  ')).toBe('/Users/me');
  });

  it('rejects empty string', () => {
    expect(() => validateLocalPath('')).toThrow('Path cannot be empty');
  });

  it('rejects a relative path', () => {
    expect(() => validateLocalPath('SyncFolder')).toThrow('Local path must be absolute');
  });

  it('rejects traversal segments', () => {
    expect(() => validateLocalPath('/Users/me/../../etc')).toThrow(
      'Path cannot contain traversal segments'
    );
  });
});

describe('validateRemotePath', () => {
  it('accepts an absolute Yandex.Disk path', () => {
    expect(validateRemotePath('/Folder/file.txt')).toBe('/Folder/file.txt');
  });

  it('accepts a disk:/ prefixed path', () => {
    expect(validateRemotePath('disk:/Folder/file.txt')).toBe('disk:/Folder/file.txt');
  });

  it('trims whitespace', () => {
    expect(validateRemotePath('  /Folder  ')).toBe('/Folder');
  });

  it('rejects empty string', () => {
    expect(() => validateRemotePath('')).toThrow('Path cannot be empty');
  });

  it('rejects non-absolute paths', () => {
    expect(() => validateRemotePath('Folder/file.txt')).toThrow('Remote path must be absolute');
  });

  it('rejects traversal segments', () => {
    expect(() => validateRemotePath('/Folder/../../etc/passwd')).toThrow(
      'Path cannot contain traversal segments'
    );
  });

  it('rejects null bytes', () => {
    expect(() => validateRemotePath('/Folder/file\0.txt')).toThrow(
      'Path cannot contain traversal segments'
    );
  });
});

// ── validateUrl ────────────────────────────────────────────────

describe('validateUrl', () => {
  it('accepts https cloud-api.yandex.net', () => {
    expect(validateUrl('https://cloud-api.yandex.net/v1/disk')).toBe(
      'https://cloud-api.yandex.net/v1/disk'
    );
  });

  it('accepts https oauth.yandex.ru', () => {
    expect(validateUrl('https://oauth.yandex.ru/authorize')).toBe(
      'https://oauth.yandex.ru/authorize'
    );
  });

  it('rejects http urls', () => {
    expect(() => validateUrl('http://cloud-api.yandex.net/v1/disk')).toThrow(
      'Only HTTPS URLs are allowed'
    );
  });

  it('rejects javascript: URLs', () => {
    expect(() => validateUrl('javascript:alert(1)')).toThrow('Only HTTPS URLs are allowed');
  });

  it('rejects non-Yandex domains', () => {
    expect(() => validateUrl('http://evil.com')).toThrow('Only HTTPS URLs are allowed');
  });

  it('rejects non-Yandex https domains', () => {
    expect(() => validateUrl('https://evil.com')).toThrow('URL domain not allowed');
  });

  it('rejects malformed URLs', () => {
    expect(() => validateUrl('not-a-url')).toThrow('Invalid URL');
  });

  it('rejects empty string', () => {
    expect(() => validateUrl('')).toThrow('URL must be a non-empty string');
  });
});

describe('non-string input', () => {
  it('is rejected by every validator', () => {
    expect(() => validateLocalPath(5 as never)).toThrow('non-empty string');
    expect(() => validateRemotePath(null as never)).toThrow('non-empty string');
    expect(() => resolveSafePath(5 as never, 'a')).toThrow();
    expect(() => resolveSafePath('/base', 7 as never)).toThrow();
  });

  it('resolveSafePath returns the base itself for "."', () => {
    expect(resolveSafePath('/base', '.')).toBe(resolve('/base'));
  });
});

// ── validateResourceName ───────────────────────────────────────

describe('validateResourceName', () => {
  it('accepts an ordinary name and trims it', () => {
    expect(validateResourceName('  photo (1).png ')).toBe('photo (1).png');
    expect(validateResourceName('Отчёт 2026.docx')).toBe('Отчёт 2026.docx');
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['a slash', 'a/b'],
    ['a backslash', 'a\\b'],
    ['a dot', '.'],
    ['two dots', '..'],
    ['a null byte', 'a\0b'],
    ['a control character', 'a\nb'],
    ['a name longer than 255 characters', 'x'.repeat(256)],
    ['not a string', 42],
    ['undefined', undefined],
  ])('rejects %s', (_what, name) => {
    expect(() => validateResourceName(name as never)).toThrow();
  });
});
