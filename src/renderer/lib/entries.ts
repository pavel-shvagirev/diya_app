/**
 * Pure helpers for folder entries: paths, sorting, filtering, selection.
 *
 * @module entries
 */

export interface Entry {
  path: string;
  name: string;
  type: 'file' | 'dir' | 'shortcut';
  size?: number;
  modified?: string;
  mime_type?: string;
  public_url?: string;
}

export type SortField = 'name' | 'modified' | 'size' | 'type';
export type SortDir = 'asc' | 'desc';

export const isDir = (e: Entry): boolean => e.type === 'dir';

export function parentOf(p: string): string {
  if (p === '/' || !p.includes('/')) return '/';
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

export function baseName(p: string): string {
  return p === '/' ? '' : p.slice(p.lastIndexOf('/') + 1);
}

export function joinPath(dir: string, name: string): string {
  return `${dir === '/' ? '' : dir}/${name}`;
}

/** `/a/b` → [{name:'a', path:'/a'}, {name:'b', path:'/a/b'}] (root excluded). */
export function breadcrumbs(p: string): Array<{ name: string; path: string }> {
  const parts = p.split('/').filter(Boolean);
  return parts.map((name, i) => ({ name, path: '/' + parts.slice(0, i + 1).join('/') }));
}

export function isInside(path: string, folder: string): boolean {
  return path === folder || path.startsWith(folder === '/' ? '/' : folder + '/');
}

/** Why a file or folder name is not acceptable, or null if it is fine. */
export function nameProblem(name: string): 'empty' | 'slash' | 'dots' | null {
  const n = name.trim();
  if (!n) return 'empty';
  if (n.includes('/')) return 'slash';
  if (n === '.' || n === '..') return 'dots';
  return null;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Extension without dot, lowercase ('' for folders and extensionless files). */
export function extensionOf(e: Pick<Entry, 'name' | 'type'>): string {
  if (e.type === 'dir') return '';
  const i = e.name.lastIndexOf('.');
  return i > 0 ? e.name.slice(i + 1).toLowerCase() : '';
}

/** Folders always come first; then by the chosen column. */
export function sortEntries(entries: Entry[], by: SortField, dir: SortDir): Entry[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...entries].sort((a, b) => {
    if (isDir(a) !== isDir(b)) return isDir(a) ? -1 : 1;
    let c = 0;
    if (by === 'size') c = (a.size ?? 0) - (b.size ?? 0);
    else if (by === 'modified') c = (a.modified ?? '').localeCompare(b.modified ?? '');
    else if (by === 'type') c = collator.compare(extensionOf(a), extensionOf(b));
    if (c === 0) c = collator.compare(a.name, b.name);
    return c * sign;
  });
}

export function filterEntries(entries: Entry[], query: string): Entry[] {
  const q = query.trim().toLowerCase();
  return q ? entries.filter(e => e.name.toLowerCase().includes(q)) : entries;
}

/** Paths between `anchor` and `target` (inclusive) in the visible order. */
export function rangeBetween(visible: Entry[], anchor: string | null, target: string): string[] {
  const a = anchor ? visible.findIndex(e => e.path === anchor) : -1;
  const b = visible.findIndex(e => e.path === target);
  if (b < 0) return [];
  if (a < 0) return [target];
  const [from, to] = a < b ? [a, b] : [b, a];
  return visible.slice(from, to + 1).map(e => e.path);
}
