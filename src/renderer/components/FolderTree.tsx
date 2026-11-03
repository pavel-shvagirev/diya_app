import { useMemo, useState, type DragEvent, type KeyboardEvent, type ReactElement } from 'react';

import { baseName, parentOf } from '../lib/entries.js';
import { t } from '../lib/strings.js';
import { useBrowserStore, type TreeNode } from '../store/browserStore.js';
import { useSyncStore } from '../store/syncStore.js';
import { DiskLogo } from '../ui/DiskLogo.js';
import { Icon } from '../ui/Icon.js';

export const DND_MIME = 'application/x-yadisk-paths';
const TRASH = '\u0000trash';

interface Row {
  path: string;
  depth: number;
}

/** Visible rows, depth-first, honouring which folders are expanded. */
export function flattenTree(
  tree: Record<string, TreeNode>,
  expanded: Record<string, boolean>,
  path = '/',
  depth = 0
): Row[] {
  const rows: Row[] = [{ path, depth }];
  if (expanded[path]) {
    for (const d of tree[path]?.dirs ?? []) rows.push(...flattenTree(tree, expanded, d, depth + 1));
  }
  return rows;
}

export function FolderTree(): ReactElement {
  const view = useBrowserStore(s => s.view);
  const tree = useBrowserStore(s => s.tree);
  const expanded = useBrowserStore(s => s.expanded);
  const syncRemote = useSyncStore(s => s.config?.remotePath);
  const [cursor, setCursor] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const b = useBrowserStore.getState;

  const rows = useMemo(() => flattenTree(tree, expanded), [tree, expanded]);
  const order = useMemo(() => [...rows.map(r => r.path), TRASH], [rows]);
  const currentKey = view.kind === 'trash' ? TRASH : view.path;

  const open = (key: string): void => {
    if (key === TRASH) void b().openTrash();
    else void b().openFolder(key);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const at = cursor ?? currentKey;
    const i = Math.max(0, order.indexOf(at));
    const at2 = (n: number): string => order[Math.max(0, Math.min(order.length - 1, n))] ?? at;
    if (e.key === 'ArrowDown') setCursor(at2(i + 1));
    else if (e.key === 'ArrowUp') setCursor(at2(i - 1));
    else if (e.key === 'ArrowRight' && at !== TRASH) {
      if (!expanded[at]) void b().toggleExpand(at);
      else setCursor(at2(i + 1));
    } else if (e.key === 'ArrowLeft' && at !== TRASH) {
      if (expanded[at] && at !== '/') void b().toggleExpand(at);
      else if (at !== '/') setCursor(parentOf(at));
    } else if (e.key === 'Enter') open(at);
    else return;
    e.preventDefault();
  };

  const onDragOver = (e: DragEvent, key: string): void => {
    if (key !== TRASH && e.dataTransfer.types.includes(DND_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropTarget(key);
    }
  };

  const onDrop = (e: DragEvent, key: string): void => {
    setDropTarget(null);
    const raw = e.dataTransfer.getData(DND_MIME);
    if (key === TRASH || !raw) return;
    e.preventDefault();
    void b().moveEntries(JSON.parse(raw) as string[], key);
  };

  const classFor = (key: string): string =>
    [
      'tree-item',
      key === currentKey ? 'tree-item--selected' : '',
      key === cursor ? 'tree-item--cursor' : '',
      key === dropTarget ? 'tree-item--drop' : '',
    ]
      .filter(Boolean)
      .join(' ');

  return (
    <div
      className="tree"
      role="tree"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onBlur={() => setCursor(null)}
    >
      {rows.map(({ path, depth }) => {
        const node = tree[path];
        const hasChildren = !node?.loaded || node.dirs.length > 0;
        return (
          <div
            key={path}
            role="treeitem"
            aria-selected={path === currentKey}
            aria-expanded={hasChildren ? Boolean(expanded[path]) : undefined}
            className={classFor(path)}
            style={{ paddingLeft: 6 + depth * 16 }}
            onClick={() => {
              setCursor(null);
              open(path);
            }}
            onDragOver={e => onDragOver(e, path)}
            onDragLeave={() => setDropTarget(null)}
            onDrop={e => onDrop(e, path)}
          >
            <span
              className="tree-chevron"
              title={hasChildren ? (expanded[path] ? t.tipCollapse : t.tipExpand) : undefined}
              onClick={e => {
                e.stopPropagation();
                if (hasChildren) void b().toggleExpand(path);
              }}
            >
              {hasChildren && (
                <Icon name={expanded[path] ? 'chevron-down' : 'chevron-right'} size={12} />
              )}
            </span>
            {path === '/' ? <DiskLogo /> : <Icon name="folder" className="icon--folder" />}
            <span className="tree-item__label">{path === '/' ? t.disk : baseName(path)}</span>
            {syncRemote === path && (
              <span className="badge-sync" title={t.syncFolderMarker}>
                <Icon name="sync" size={13} />
              </span>
            )}
          </div>
        );
      })}
      <div className="tree-sep" />
      <div
        role="treeitem"
        aria-selected={currentKey === TRASH}
        className={classFor(TRASH)}
        style={{ paddingLeft: 6 }}
        onClick={() => {
          setCursor(null);
          open(TRASH);
        }}
      >
        <span className="tree-chevron" />
        <Icon name="trash" className="icon--muted" />
        <span className="tree-item__label">{t.trash}</span>
      </div>
    </div>
  );
}
