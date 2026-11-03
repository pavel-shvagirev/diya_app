import {
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
} from 'react';

import {
  copyEntriesTo,
  deleteForever,
  moveEntriesTo,
  openEntry,
  removeEntries,
  renameEntry,
  canShare,
  shareEntry,
} from '../lib/actions.js';
import { extensionOf, isDir, type Entry, type SortField } from '../lib/entries.js';
import { formatDate, formatSize, kindOf, type Kind } from '../lib/format.js';
import { lang, t } from '../lib/strings.js';
import { selectVisible, useBrowserStore } from '../store/browserStore.js';
import { ContextMenu, type MenuItem } from '../ui/ContextMenu.js';
import { Icon, type IconName } from '../ui/Icon.js';
import { DND_MIME } from './FolderTree.js';

const ICON_BY_KIND: Record<Kind, IconName> = {
  folder: 'folder',
  image: 'image',
  audio: 'audio',
  video: 'video',
  archive: 'archive',
  text: 'text',
  doc: 'doc',
  file: 'file',
};

const typeLabel = (e: Entry): string =>
  isDir(e) ? t.folder : extensionOf(e).toUpperCase() || t.file;

export function FileTable(): ReactElement {
  const entries = useBrowserStore(s => s.entries);
  const filter = useBrowserStore(s => s.filter);
  const sortBy = useBrowserStore(s => s.sortBy);
  const sortDir = useBrowserStore(s => s.sortDir);
  const selection = useBrowserStore(s => s.selection);
  const loading = useBrowserStore(s => s.loading);
  const error = useBrowserStore(s => s.error);
  const view = useBrowserStore(s => s.view);
  const b = useBrowserStore.getState;
  const wrapRef = useRef<HTMLDivElement>(null);

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [osDrag, setOsDrag] = useState(false);
  const [dropRow, setDropRow] = useState<string | null>(null);

  const visible = useMemo(
    () => selectVisible({ entries, filter, sortBy, sortDir }),
    [entries, filter, sortBy, sortDir]
  );
  const inTrash = view.kind === 'trash';
  const selected = useMemo(
    () => visible.filter(e => selection.includes(e.path)),
    [visible, selection]
  );

  // ── Selection ──────────────────────────────────────────────

  const onRowClick = (e: MouseEvent, entry: Entry): void => {
    wrapRef.current?.focus();
    b().select(entry.path, e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'replace');
  };

  const move = (delta: number, extend: boolean): void => {
    if (visible.length === 0) return;
    const lastSel = selection.length ? selection[selection.length - 1] : null;
    const at = lastSel ? visible.findIndex(v => v.path === lastSel) : -1;
    const next = visible[Math.max(0, Math.min(visible.length - 1, at + delta))];
    if (!next) return;
    b().select(next.path, extend ? 'range' : 'replace');
    wrapRef.current
      ?.querySelector(`[data-path="${CSS.escape(next.path)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'ArrowDown') move(1, e.shiftKey);
    else if (e.key === 'ArrowUp') move(-1, e.shiftKey);
    else if (e.key === 'Home') move(-visible.length, e.shiftKey);
    else if (e.key === 'End') move(visible.length, e.shiftKey);
    else if (mod && e.key.toLowerCase() === 'a') b().selectAll();
    else if (e.key === 'Escape') b().clearSelection();
    else if (e.key === 'Enter' && selected[0] && selected.length === 1 && !inTrash)
      void openEntry(selected[0]);
    else if (e.key === 'F2' && selected[0] && selected.length === 1 && !inTrash)
      void renameEntry(selected[0]);
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length > 0) {
      void (inTrash ? deleteForever(selected) : removeEntries(selected));
    } else return;
    e.preventDefault();
  };

  // ── Context menu ───────────────────────────────────────────

  const menuItems = (): MenuItem[] => {
    if (inTrash) {
      return [
        {
          label: t.restore,
          icon: 'restore',
          onClick: () => void b().restoreEntries(selected.map(e => e.path)),
        },
        'sep',
        {
          label: t.deleteForever,
          icon: 'trash',
          danger: true,
          onClick: () => void deleteForever(selected),
        },
      ];
    }
    const one = selected.length === 1 ? selected[0] : undefined;
    const items: MenuItem[] = [];
    if (one) {
      items.push({
        label: isDir(one) ? t.open : t.download,
        icon: isDir(one) ? 'folder' : 'download',
        onClick: () => void openEntry(one),
      });
    }
    if (one && isDir(one)) {
      items.push({
        label: t.download,
        icon: 'download',
        onClick: () => void b().downloadEntries([one.path]),
      });
    } else if (selected.length > 1) {
      items.push({
        label: t.download,
        icon: 'download',
        onClick: () => void b().downloadEntries(selected.map(e => e.path)),
      });
    }
    items.push('sep');
    if (one) items.push({ label: t.rename, icon: 'edit', onClick: () => void renameEntry(one) });
    items.push(
      { label: t.copyTo, icon: 'copy', onClick: () => void copyEntriesTo(selected) },
      { label: t.moveTo, icon: 'move', onClick: () => void moveEntriesTo(selected) }
    );
    if (one && canShare(one))
      items.push({ label: t.share, icon: 'link', onClick: () => void shareEntry(one) });
    items.push('sep', {
      label: t.delete,
      icon: 'trash',
      danger: true,
      onClick: () => void removeEntries(selected),
    });
    return items;
  };

  const onContextMenu = (e: MouseEvent, entry: Entry | null): void => {
    e.preventDefault();
    if (entry && !selection.includes(entry.path)) b().select(entry.path, 'replace');
    if (!entry) b().clearSelection();
    if (entry || selected.length) setMenu({ x: e.clientX, y: e.clientY });
  };

  // ── Drag & drop ────────────────────────────────────────────

  const onRowDragStart = (e: DragEvent, entry: Entry): void => {
    const paths = selection.includes(entry.path) ? selection : [entry.path];
    if (!selection.includes(entry.path)) b().select(entry.path, 'replace');
    e.dataTransfer.setData(DND_MIME, JSON.stringify(paths));
    e.dataTransfer.effectAllowed = 'move';
  };

  const hasFiles = (e: DragEvent): boolean => e.dataTransfer.types.includes('Files');

  const onWrapDragOver = (e: DragEvent): void => {
    if (!inTrash && hasFiles(e)) {
      e.preventDefault();
      setOsDrag(true);
    }
  };

  const onWrapDrop = (e: DragEvent): void => {
    setOsDrag(false);
    if (inTrash || !hasFiles(e)) return;
    e.preventDefault();
    const paths = Array.from(e.dataTransfer.files)
      .map(f => window.api.pathForFile(f))
      .filter(Boolean);
    if (paths.length) void b().uploadFiles(paths);
  };

  const onRowDragOver = (e: DragEvent, entry: Entry): void => {
    if (isDir(entry) && e.dataTransfer.types.includes(DND_MIME)) {
      e.preventDefault();
      e.stopPropagation();
      setDropRow(entry.path);
    }
  };

  const onRowDrop = (e: DragEvent, entry: Entry): void => {
    setDropRow(null);
    const raw = e.dataTransfer.getData(DND_MIME);
    if (!isDir(entry) || !raw) return;
    e.preventDefault();
    e.stopPropagation();
    void b().moveEntries(JSON.parse(raw) as string[], entry.path);
  };

  // ── Render ─────────────────────────────────────────────────

  const header = (field: SortField, label: string, cls = ''): ReactElement => (
    <th
      role="columnheader"
      className={cls}
      title={t.tipSortBy(label)}
      aria-sort={sortBy === field ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      onClick={() => b().setSort(field)}
    >
      {label}
      {sortBy === field && (
        <Icon name={sortDir === 'asc' ? 'chevron-up' : 'chevron-down'} size={12} />
      )}
    </th>
  );

  let body: ReactElement | null = null;
  if (error) {
    body = (
      <div className="state state--error" role="alert">
        <Icon name="alert" size={28} />
        <div>{t.loadError}</div>
        <div className="muted">{error}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn--outline" onClick={() => void b().refresh()}>
            {t.retry}
          </button>
          {view.kind === 'folder' && view.path !== '/' && (
            <button className="btn btn--outline" onClick={() => void b().openFolder('/')}>
              {t.toRoot}
            </button>
          )}
        </div>
      </div>
    );
  } else if (loading && entries.length === 0) {
    body = (
      <div className="state">
        <div className="spinner" />
        {t.loading}
      </div>
    );
  } else if (visible.length === 0) {
    body = (
      <div className="state">
        <Icon name={inTrash ? 'trash' : 'folder'} size={32} />
        {filter ? t.noMatches : inTrash ? t.emptyTrashMsg : t.emptyFolder}
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      className="table-wrap"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onClick={e => {
        if (e.target === e.currentTarget) b().clearSelection();
      }}
      onContextMenu={e => onContextMenu(e, null)}
      onDragOver={onWrapDragOver}
      onDragLeave={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOsDrag(false);
      }}
      onDrop={onWrapDrop}
    >
      {osDrag && <div className="dropzone">{t.dropToUpload}</div>}
      {body ?? (
        <table className="table" role="grid" aria-multiselectable="true">
          <thead>
            <tr>
              {header('name', t.colName)}
              {header('modified', t.colModified, 'col-modified')}
              {header('size', t.colSize, 'col-size num')}
              {header('type', t.colType, 'col-type')}
            </tr>
          </thead>
          <tbody>
            {visible.map(entry => {
              const isSel = selection.includes(entry.path);
              return (
                <tr
                  key={entry.path}
                  data-path={entry.path}
                  className={`row${isSel ? ' row--selected' : ''}${dropRow === entry.path ? ' row--drop' : ''}`}
                  aria-selected={isSel}
                  draggable={!inTrash}
                  onClick={e => onRowClick(e, entry)}
                  onDoubleClick={() => !inTrash && void openEntry(entry)}
                  onContextMenu={e => {
                    e.stopPropagation();
                    onContextMenu(e, entry);
                  }}
                  onDragStart={e => onRowDragStart(e, entry)}
                  onDragOver={e => onRowDragOver(e, entry)}
                  onDragLeave={() => setDropRow(null)}
                  onDrop={e => onRowDrop(e, entry)}
                >
                  <td role="gridcell">
                    <div className="name-cell">
                      <Icon
                        name={ICON_BY_KIND[kindOf(entry)]}
                        className={isDir(entry) ? 'icon--folder' : 'icon--muted'}
                      />
                      <span className="name-cell__text" title={entry.name}>
                        {entry.name}
                      </span>
                      {entry.public_url && <Icon name="link" size={12} className="icon--muted" />}
                    </div>
                  </td>
                  <td role="gridcell" className="muted">
                    {formatDate(entry.modified, lang)}
                  </td>
                  <td role="gridcell" className="muted num">
                    {isDir(entry) ? '' : formatSize(entry.size, lang)}
                  </td>
                  <td role="gridcell" className="muted">
                    {typeLabel(entry)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}
