import { describe, expect, it } from 'vitest';

import {
  baseName,
  breadcrumbs,
  filterEntries,
  isInside,
  joinPath,
  nameProblem,
  parentOf,
  rangeBetween,
  sortEntries,
  type Entry,
} from '../../src/renderer/lib/entries.js';
import { formatSize, kindOf, percent } from '../../src/renderer/lib/format.js';

const f = (name: string, extra: Partial<Entry> = {}): Entry => ({
  path: `/${name}`,
  name,
  type: 'file',
  ...extra,
});
const d = (name: string): Entry => ({ path: `/${name}`, name, type: 'dir' });

describe('paths', () => {
  it('parentOf / baseName / joinPath', () => {
    expect(parentOf('/a/b')).toBe('/a');
    expect(parentOf('/a')).toBe('/');
    expect(parentOf('/')).toBe('/');
    expect(baseName('/a/b.txt')).toBe('b.txt');
    expect(joinPath('/', 'x')).toBe('/x');
    expect(joinPath('/a', 'x')).toBe('/a/x');
  });
  it('breadcrumbs', () => {
    expect(breadcrumbs('/')).toEqual([]);
    expect(breadcrumbs('/a/b')).toEqual([
      { name: 'a', path: '/a' },
      { name: 'b', path: '/a/b' },
    ]);
  });
  it('isInside does not confuse prefixes', () => {
    expect(isInside('/a/b', '/a')).toBe(true);
    expect(isInside('/ab', '/a')).toBe(false);
    expect(isInside('/a', '/a')).toBe(true);
    expect(isInside('/x', '/')).toBe(true);
  });
  it('nameProblem', () => {
    expect(nameProblem('  ')).toBe('empty');
    expect(nameProblem('a/b')).toBe('slash');
    expect(nameProblem('..')).toBe('dots');
    expect(nameProblem('ok name.txt')).toBeNull();
  });
});

describe('sortEntries', () => {
  const list = [
    f('b.txt', { size: 5 }),
    d('Zdir'),
    f('a10.txt', { size: 50 }),
    f('a2.txt', { size: 1 }),
    d('adir'),
  ];
  it('keeps folders first and sorts names naturally', () => {
    expect(sortEntries(list, 'name', 'asc').map(e => e.name)).toEqual([
      'adir',
      'Zdir',
      'a2.txt',
      'a10.txt',
      'b.txt',
    ]);
  });
  it('descending still keeps folders first', () => {
    expect(sortEntries(list, 'name', 'desc').map(e => e.name)).toEqual([
      'Zdir',
      'adir',
      'b.txt',
      'a10.txt',
      'a2.txt',
    ]);
  });
  it('sorts by size both ways', () => {
    expect(
      sortEntries(list, 'size', 'asc')
        .filter(e => e.type === 'file')
        .map(e => e.size)
    ).toEqual([1, 5, 50]);
    expect(
      sortEntries(list, 'size', 'desc')
        .filter(e => e.type === 'file')
        .map(e => e.size)
    ).toEqual([50, 5, 1]);
  });
  it('sorts by modified date', () => {
    const l = [f('x', { modified: '2026-02-01' }), f('y', { modified: '2026-01-01' })];
    expect(sortEntries(l, 'modified', 'asc').map(e => e.name)).toEqual(['y', 'x']);
  });
  it('does not mutate the input', () => {
    const copy = [...list];
    sortEntries(list, 'size', 'desc');
    expect(list).toEqual(copy);
  });
});

describe('filter and range selection', () => {
  it('filters case-insensitively', () => {
    expect(filterEntries([f('Report.PDF'), f('x.txt')], 'rep').map(e => e.name)).toEqual([
      'Report.PDF',
    ]);
    expect(filterEntries([f('a')], '  ')).toHaveLength(1);
  });
  it('rangeBetween works in either direction and without anchor', () => {
    const v = [f('a'), f('b'), f('c'), f('d')];
    expect(rangeBetween(v, '/b', '/d')).toEqual(['/b', '/c', '/d']);
    expect(rangeBetween(v, '/d', '/b')).toEqual(['/b', '/c', '/d']);
    expect(rangeBetween(v, null, '/c')).toEqual(['/c']);
    expect(rangeBetween(v, '/a', '/zzz')).toEqual([]);
  });
});

describe('format', () => {
  it('formatSize', () => {
    expect(formatSize(0)).toBe('0 Б');
    expect(formatSize(1536)).toBe('1,5 КБ');
    expect(formatSize(5 * 1024 ** 3, 'en')).toBe('5.0 GB');
    expect(formatSize(undefined)).toBe('');
  });
  it('percent clamps and handles unknown totals', () => {
    expect(percent(5, 10)).toBe(50);
    expect(percent(5, 0)).toBe(0);
    expect(percent(20, 10)).toBe(100);
  });
  it('kindOf', () => {
    expect(kindOf({ name: 'x.PNG', type: 'file' })).toBe('image');
    expect(kindOf({ name: 'x', type: 'dir' })).toBe('folder');
    expect(kindOf({ name: 'noext', type: 'file' })).toBe('file');
  });
});
