import { useMemo, type ReactElement } from 'react';

import {
  canShare as canShareEntry,
  deleteForever,
  emptyTrash,
  newFolder,
  removeEntries,
  restoreEntryAs,
  shareEntry,
} from '../lib/actions.js';
import { breadcrumbs } from '../lib/entries.js';
import { t } from '../lib/strings.js';
import { useBrowserStore } from '../store/browserStore.js';
import { useUiStore } from '../store/uiStore.js';
import { Icon } from '../ui/Icon.js';

/** The id the Disk appends to the name of a trashed item (`foo_1408546879`); not shown in the path bar. */
const TRASH_ID = /_\d{6,}$/;

export function Toolbar(): ReactElement {
  const view = useBrowserStore(s => s.view);
  const entries = useBrowserStore(s => s.entries);
  const selection = useBrowserStore(s => s.selection);
  const filter = useBrowserStore(s => s.filter);
  const historyIndex = useBrowserStore(s => s.historyIndex);
  const historyLength = useBrowserStore(s => s.history.length);
  const loading = useBrowserStore(s => s.loading);
  const b = useBrowserStore.getState;
  const openSettings = useUiStore(s => s.openSettings);

  const selected = useMemo(
    () => entries.filter(e => selection.includes(e.path)),
    [entries, selection]
  );
  const canShare = selected.length === 1 && canShareEntry(selected[0]);

  const inTrash = view.kind === 'trash';
  const crumbs = view.kind === 'folder' ? breadcrumbs(view.path) : [];
  const trashCrumbs = view.kind === 'trash' && view.path ? breadcrumbs(view.path) : [];

  return (
    <div className="toolbar" role="toolbar">
      <button
        className="btn btn--icon"
        title={t.back}
        aria-label={t.back}
        disabled={historyIndex <= 0}
        onClick={() => void b().back()}
      >
        <Icon name="arrow-left" />
      </button>
      <button
        className="btn btn--icon"
        title={t.forward}
        aria-label={t.forward}
        disabled={historyIndex >= historyLength - 1}
        onClick={() => void b().forward()}
      >
        <Icon name="arrow-right" />
      </button>
      <button
        className="btn btn--icon"
        title={t.up}
        aria-label={t.up}
        disabled={inTrash ? trashCrumbs.length === 0 : crumbs.length === 0}
        onClick={() => void b().up()}
      >
        <Icon name="arrow-up" />
      </button>

      <nav className="pathbar" aria-label="path" title={t.tipPathbar}>
        {inTrash ? (
          trashCrumbs.length === 0 ? (
            <span className="crumb">{t.trash}</span>
          ) : (
            <>
              <button className="btn crumb" title={t.trash} onClick={() => void b().openTrash()}>
                {t.trash}
              </button>
              {trashCrumbs.map((c, i) => (
                <span key={c.path} style={{ display: 'contents' }}>
                  <Icon name="chevron-right" size={12} className="crumb-sep" />
                  <button
                    className="btn crumb"
                    title={c.path}
                    onClick={() => void b().openTrash({ path: c.path })}
                  >
                    {i === 0 ? c.name.replace(TRASH_ID, '') : c.name}
                  </button>
                </span>
              ))}
            </>
          )
        ) : (
          <>
            <button className="btn crumb" title={t.toRoot} onClick={() => void b().openFolder('/')}>
              {t.disk}
            </button>
            {crumbs.map(c => (
              <span key={c.path} style={{ display: 'contents' }}>
                <Icon name="chevron-right" size={12} className="crumb-sep" />
                <button
                  className="btn crumb"
                  title={c.path}
                  onClick={() => void b().openFolder(c.path)}
                >
                  {c.name}
                </button>
              </span>
            ))}
          </>
        )}
      </nav>

      <label className="search" title={t.tipFilter}>
        <Icon name="search" size={14} />
        <input
          type="search"
          value={filter}
          placeholder={t.search}
          aria-label={t.search}
          onChange={e => b().setFilter(e.target.value)}
        />
      </label>

      <span className="toolbar__sep" />

      {inTrash ? (
        <>
          <button
            className="btn"
            title={selected.length === 0 ? `${t.tipRestore} — ${t.hintSelect}` : t.tipRestore}
            disabled={selected.length === 0}
            onClick={() => void b().restoreEntries(selected.map(e => e.path))}
          >
            <Icon name="restore" /> <span className="btn__label">{t.restore}</span>
          </button>
          <button
            className="btn"
            title={
              selected.length === 1 ? t.tipRestoreAs : `${t.tipRestoreAs} — ${t.hintSelectOne}`
            }
            disabled={selected.length !== 1}
            onClick={() => selected[0] && void restoreEntryAs(selected[0])}
          >
            <Icon name="restore" /> <span className="btn__label">{t.restoreAs}</span>
          </button>
          <button
            className="btn btn--danger"
            title={
              selected.length === 0 ? `${t.tipDeleteForever} — ${t.hintSelect}` : t.tipDeleteForever
            }
            disabled={selected.length === 0}
            onClick={() => void deleteForever(selected)}
          >
            <Icon name="trash" /> <span className="btn__label">{t.deleteForever}</span>
          </button>
          <button
            className="btn"
            title={t.tipEmptyTrash}
            disabled={entries.length === 0}
            onClick={() => void emptyTrash()}
          >
            {t.emptyTrash}
          </button>
        </>
      ) : (
        <>
          <button
            className="btn btn--primary"
            title={t.tipUpload}
            onClick={() => void b().uploadFiles()}
          >
            <Icon name="upload" /> <span className="btn__label">{t.upload}</span>
          </button>
          <button className="btn" title={t.tipNewFolder} onClick={() => void newFolder()}>
            <Icon name="folder-plus" /> <span className="btn__label">{t.newFolder}</span>
          </button>
          <button
            className="btn"
            title={selected.length === 0 ? `${t.tipDownload} — ${t.hintSelect}` : t.tipDownload}
            disabled={selected.length === 0}
            onClick={() => void b().downloadEntries(selected.map(e => e.path))}
          >
            <Icon name="download" /> <span className="btn__label">{t.download}</span>
          </button>
          <button
            className="btn"
            title={
              selected.length !== 1
                ? `${t.tipShare} — ${t.hintSelectOne}`
                : canShare
                  ? t.tipShare
                  : t.tipShareDisabled
            }
            disabled={!canShare}
            onClick={() => selected[0] && void shareEntry(selected[0])}
          >
            <Icon name="link" /> <span className="btn__label">{t.share}</span>
          </button>
          <button
            className="btn btn--danger"
            title={selected.length === 0 ? `${t.tipDelete} — ${t.hintSelect}` : t.tipDelete}
            disabled={selected.length === 0}
            onClick={() => void removeEntries(selected)}
          >
            <Icon name="trash" /> <span className="btn__label">{t.delete}</span>
          </button>
        </>
      )}

      <span className="toolbar__sep" />
      <button
        className="btn btn--icon"
        title={t.refresh}
        aria-label={t.refresh}
        onClick={() => void b().refresh()}
      >
        <Icon name="refresh" className={loading ? 'spin' : undefined} />
      </button>
      <button
        className="btn btn--icon"
        title={t.settings}
        aria-label={t.settings}
        onClick={openSettings}
      >
        <Icon name="settings" />
      </button>
    </div>
  );
}
