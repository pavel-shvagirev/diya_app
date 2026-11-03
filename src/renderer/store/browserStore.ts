/**
 * File-manager state: current view (folder or trash), the folder tree,
 * the listing with sort / filter / selection, and every file operation.
 *
 * @module browserStore
 */
import { create } from 'zustand';

import {
  baseName,
  filterEntries,
  isDir,
  isInside,
  joinPath,
  parentOf,
  rangeBetween,
  sortEntries,
  type Entry,
  type SortDir,
  type SortField,
} from '../lib/entries.js';
import { t } from '../lib/strings.js';
import { useErrorStore } from './errorStore.js';
import type { FileMetadata } from '../../shared/types.js';

export type View = { kind: 'folder'; path: string } | { kind: 'trash' };

export interface TreeNode {
  /** Child folder paths. */
  dirs: string[];
  loaded: boolean;
  loading: boolean;
}

export interface Quota {
  used: number;
  total: number;
  trash: number;
}

export type SelectMode = 'replace' | 'toggle' | 'range';

interface BrowserState {
  view: View;
  history: View[];
  historyIndex: number;
  entries: Entry[];
  loading: boolean;
  error: string | null;
  selection: string[];
  anchor: string | null;
  sortBy: SortField;
  sortDir: SortDir;
  filter: string;
  tree: Record<string, TreeNode>;
  expanded: Record<string, boolean>;
  quota: Quota | null;

  openFolder: (path: string, opts?: { push?: boolean }) => Promise<void>;
  openTrash: (opts?: { push?: boolean }) => Promise<void>;
  refresh: () => Promise<void>;
  back: () => Promise<void>;
  forward: () => Promise<void>;
  up: () => Promise<void>;

  select: (path: string, mode: SelectMode) => void;
  selectAll: () => void;
  clearSelection: () => void;
  setSort: (field: SortField) => void;
  setFilter: (q: string) => void;

  toggleExpand: (path: string) => Promise<void>;
  loadTreeNode: (path: string) => Promise<void>;

  loadQuota: () => Promise<void>;
  createFolder: (name: string) => Promise<void>;
  renameEntry: (path: string, newName: string) => Promise<void>;
  deleteEntries: (paths: string[], permanently?: boolean) => Promise<void>;
  moveEntries: (paths: string[], destDir: string) => Promise<void>;
  copyEntries: (paths: string[], destDir: string) => Promise<void>;
  shareEntry: (path: string) => Promise<string | null>;
  unshareEntry: (path: string) => Promise<void>;
  downloadEntries: (paths: string[]) => Promise<void>;
  uploadFiles: (localPaths?: string[]) => Promise<void>;
  restoreEntries: (paths: string[]) => Promise<void>;
  emptyTrash: () => Promise<void>;
}

const toEntry = (f: FileMetadata): Entry => ({
  path: f.path,
  name: f.name,
  type: f.type,
  size: f.size,
  modified: f.modified,
  mime_type: f.mime_type,
  public_url: f.public_url,
});

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const reportError = (e: unknown): void => useErrorStore.getState().addError(errMsg(e));

let loadSeq = 0;

export const useBrowserStore = create<BrowserState>((set, get) => {
  /** Show `entries` for `view`, remembering history. */
  const show = (view: View, entries: Entry[], push: boolean): void => {
    set(s => {
      const history = push ? [...s.history.slice(0, s.historyIndex + 1), view] : s.history;
      return {
        view,
        entries,
        loading: false,
        error: null,
        history,
        historyIndex: push ? history.length - 1 : s.historyIndex,
      };
    });
  };

  /** Re-read tree nodes of these folders (after a change inside them). */
  const reloadTree = (dirs: string[]): void => {
    for (const d of new Set(dirs)) {
      if (!get().tree[d]) continue;
      set(s => ({
        tree: { ...s.tree, [d]: { dirs: s.tree[d]?.dirs ?? [], loading: false, loaded: false } },
      }));
      if (get().expanded[d]) void get().loadTreeNode(d);
    }
  };

  const refreshView = async (): Promise<void> => {
    const { view } = get();
    if (view.kind === 'folder') await get().openFolder(view.path, { push: false });
    else await get().openTrash({ push: false });
  };

  /** Run an operation; report failures; always re-read the listing afterwards. */
  const run = async (op: () => Promise<void>, touched: string[] = []): Promise<void> => {
    try {
      await op();
    } catch (e) {
      reportError(e);
    }
    reloadTree(touched);
    await refreshView();
    void get().loadQuota();
  };

  const currentFolder = (): string => {
    const v = get().view;
    return v.kind === 'folder' ? v.path : '/';
  };

  return {
    view: { kind: 'folder', path: '/' },
    history: [{ kind: 'folder', path: '/' }],
    historyIndex: 0,
    entries: [],
    loading: false,
    error: null,
    selection: [],
    anchor: null,
    sortBy: 'name',
    sortDir: 'asc',
    filter: '',
    tree: {},
    expanded: { '/': true },
    quota: null,

    openFolder: async (path, opts) => {
      const seq = ++loadSeq;
      const push = opts?.push ?? true;
      set({ loading: true, error: null, selection: [], anchor: null, filter: '' });
      // Make the folder visible in the tree: expand all ancestors.
      const expanded = { ...get().expanded };
      for (let p = path; ; p = parentOf(p)) {
        expanded[p] = true;
        if (p === '/') break;
      }
      set({ expanded });
      try {
        const res = await window.api.listFiles(path);
        if (seq !== loadSeq) return;
        const entries = res.items.map(toEntry);
        set(s => ({
          tree: {
            ...s.tree,
            [path]: {
              dirs: entries.filter(isDir).map(e => e.path),
              loaded: true,
              loading: false,
            },
          },
        }));
        show({ kind: 'folder', path }, entries, push);
        for (const p of Object.keys(expanded)) void get().loadTreeNode(p);
      } catch (e) {
        if (seq !== loadSeq) return;
        set({ loading: false, error: errMsg(e), view: { kind: 'folder', path }, entries: [] });
      }
    },

    openTrash: async opts => {
      const seq = ++loadSeq;
      set({ loading: true, error: null, selection: [], anchor: null, filter: '' });
      try {
        const res = await window.api.getTrashList();
        if (seq !== loadSeq) return;
        show({ kind: 'trash' }, res.items.map(toEntry), opts?.push ?? true);
      } catch (e) {
        if (seq !== loadSeq) return;
        set({ loading: false, error: errMsg(e), view: { kind: 'trash' }, entries: [] });
      }
    },

    refresh: refreshView,

    back: async () => {
      const { history, historyIndex } = get();
      if (historyIndex <= 0) return;
      const target = history[historyIndex - 1];
      if (!target) return;
      set({ historyIndex: historyIndex - 1 });
      if (target.kind === 'folder') await get().openFolder(target.path, { push: false });
      else await get().openTrash({ push: false });
    },

    forward: async () => {
      const { history, historyIndex } = get();
      if (historyIndex >= history.length - 1) return;
      const target = history[historyIndex + 1];
      if (!target) return;
      set({ historyIndex: historyIndex + 1 });
      if (target.kind === 'folder') await get().openFolder(target.path, { push: false });
      else await get().openTrash({ push: false });
    },

    up: async () => {
      const v = get().view;
      if (v.kind === 'folder' && v.path !== '/') await get().openFolder(parentOf(v.path));
    },

    select: (path, mode) => {
      const s = get();
      const visible = sortEntries(filterEntries(s.entries, s.filter), s.sortBy, s.sortDir);
      if (mode === 'replace') set({ selection: [path], anchor: path });
      else if (mode === 'toggle') {
        const has = s.selection.includes(path);
        set({
          selection: has ? s.selection.filter(p => p !== path) : [...s.selection, path],
          anchor: path,
        });
      } else set({ selection: rangeBetween(visible, s.anchor, path) });
    },

    selectAll: () => {
      const s = get();
      set({ selection: filterEntries(s.entries, s.filter).map(e => e.path) });
    },
    clearSelection: () => set({ selection: [], anchor: null }),

    setSort: field =>
      set(s => ({
        sortBy: field,
        sortDir: s.sortBy === field && s.sortDir === 'asc' ? 'desc' : 'asc',
      })),
    setFilter: q => set({ filter: q }),

    toggleExpand: async path => {
      const open = !get().expanded[path];
      set(s => ({ expanded: { ...s.expanded, [path]: open } }));
      if (open) await get().loadTreeNode(path);
    },

    loadTreeNode: async path => {
      const node = get().tree[path];
      if (node?.loaded || node?.loading) return;
      set(s => ({
        tree: { ...s.tree, [path]: { dirs: node?.dirs ?? [], loaded: false, loading: true } },
      }));
      try {
        const res = await window.api.listFiles(path);
        set(s => ({
          tree: {
            ...s.tree,
            [path]: {
              dirs: res.items.filter(f => f.type === 'dir').map(f => f.path),
              loaded: true,
              loading: false,
            },
          },
        }));
      } catch {
        // A tree node that cannot be read simply shows no children.
        set(s => ({
          tree: { ...s.tree, [path]: { dirs: node?.dirs ?? [], loaded: true, loading: false } },
        }));
      }
    },

    loadQuota: async () => {
      try {
        const q = await window.api.getQuota();
        set({ quota: { used: q.used_space, total: q.total_space, trash: q.trash_size } });
      } catch {
        // Quota is informational; the status bar just hides it.
      }
    },

    createFolder: name =>
      run(() => window.api.mkdir(joinPath(currentFolder(), name.trim())), [currentFolder()]),

    renameEntry: (path, newName) =>
      run(
        () => window.api.moveFile(path, joinPath(parentOf(path), newName.trim())),
        [parentOf(path), path]
      ),

    deleteEntries: (paths, permanently = false) =>
      run(async () => {
        for (const p of paths) await window.api.deleteFile(p, permanently);
      }, [...paths.map(parentOf), ...paths]),

    moveEntries: (paths, destDir) => {
      const movable = paths.filter(p => parentOf(p) !== destDir && !isInside(destDir, p));
      if (movable.length === 0) return Promise.resolve();
      return run(async () => {
        for (const p of movable) await window.api.moveFile(p, joinPath(destDir, baseName(p)));
      }, [destDir, ...movable.map(parentOf), ...movable]);
    },

    copyEntries: (paths, destDir) =>
      run(async () => {
        for (const p of paths) {
          const dest =
            parentOf(p) === destDir
              ? joinPath(destDir, `${t.copyPrefix}${baseName(p)}`)
              : joinPath(destDir, baseName(p));
          await window.api.copyFile(p, dest);
        }
      }, [destDir]),

    shareEntry: async path => {
      try {
        const url = await window.api.publish(path);
        await refreshView();
        return url;
      } catch (e) {
        reportError(e);
        return null;
      }
    },

    unshareEntry: path =>
      run(async () => {
        await window.api.unpublish(path);
      }),

    downloadEntries: async paths => {
      try {
        await window.api.downloadFiles(paths);
      } catch (e) {
        reportError(e);
      }
    },

    uploadFiles: async localPaths => {
      try {
        await window.api.uploadFiles(currentFolder(), localPaths);
      } catch (e) {
        reportError(e);
      }
      reloadTree([currentFolder()]);
      await refreshView();
      void get().loadQuota();
    },

    restoreEntries: paths =>
      run(async () => {
        for (const p of paths) await window.api.restoreFromTrash(p);
      }, Object.keys(get().tree)),

    emptyTrash: () => run(() => window.api.emptyTrash()),
  };
});

/** Entries as displayed: filtered and sorted. */
export function selectVisible(
  s: Pick<BrowserState, 'entries' | 'filter' | 'sortBy' | 'sortDir'>
): Entry[] {
  return sortEntries(filterEntries(s.entries, s.filter), s.sortBy, s.sortDir);
}
