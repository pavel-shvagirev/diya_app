import { useEffect, useState, type ReactElement } from 'react';

import { agoText } from '../lib/ago.js';
import { formatSize, percent } from '../lib/format.js';
import { lang, t } from '../lib/strings.js';
import { useBrowserStore } from '../store/browserStore.js';
import { useSyncStore } from '../store/syncStore.js';
import { useTransferStore } from '../store/transferStore.js';
import { useUiStore } from '../store/uiStore.js';
import { Icon } from '../ui/Icon.js';

function SyncChip(): ReactElement {
  const config = useSyncStore(s => s.config);
  const p = useSyncStore(s => s.progress);
  const openSettings = useUiStore(s => s.openSettings);
  const [, tick] = useState(0);

  // Re-render so "5 min ago" stays fresh.
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  let icon: 'cloud' | 'sync' | 'check' | 'alert' = 'cloud';
  let text: string = t.syncNotConfigured;
  let cls = 'chip';
  let bar: number | null = null;

  if (config) {
    if (p.phase === 'error') {
      icon = 'alert';
      text = t.syncError;
      cls += ' chip--error';
    } else if (!config.enabled || p.phase === 'paused') {
      text = t.syncPaused;
    } else if (p.phase === 'scanning') {
      icon = 'sync';
      text = t.syncScanning;
    } else if (p.phase === 'syncing') {
      icon = 'sync';
      bar =
        p.totalBytes > 0 ? percent(p.doneBytes, p.totalBytes) : percent(p.doneFiles, p.totalFiles);
      text = t.syncing(p.doneFiles, p.totalFiles, bar);
    } else {
      icon = 'check';
      cls += ' chip--ok';
      text = p.lastSync ? t.syncUpToDate(agoText(p.lastSync)) : t.syncNever;
    }
  }

  const title = [
    t.tipSyncChip,
    p.error,
    p.current ? `${t.currentFile}: ${p.current.path}` : null,
    p.failures.length ? `${t.failuresTitle}: ${p.failures.length}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <button className={cls} onClick={openSettings} title={title}>
      <Icon name={icon} size={14} className={icon === 'sync' ? 'spin icon' : 'icon'} />
      <span className="chip__text">{text}</span>
      {bar !== null && (
        <span
          className="progress progress--thin"
          role="progressbar"
          aria-valuenow={bar}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: `${bar}%` }} />
        </span>
      )}
      {config && p.failures.length > 0 && p.phase !== 'syncing' && (
        <span style={{ color: 'var(--ui-danger)' }}>· {t.syncFailures(p.failures.length)}</span>
      )}
    </button>
  );
}

function TransferChip(): ReactElement | null {
  const transfers = useTransferStore(s => s.transfers);
  const clearFinished = useTransferStore(s => s.clearFinished);
  const [open, setOpen] = useState(false);

  if (transfers.length === 0) return null;
  const active = transfers.filter(x => x.status === 'active');
  const failed = transfers.filter(x => x.status === 'error').length;
  const label = active.length
    ? `${active[0]?.direction === 'upload' ? t.uploading : t.downloading}: ${active.length}`
    : failed
      ? `${t.transferFailed}: ${failed}`
      : t.transferDone;

  return (
    <>
      <button
        className={failed && !active.length ? 'chip chip--error' : 'chip'}
        onClick={() => setOpen(o => !o)}
      >
        <Icon name={active.length ? 'upload' : failed ? 'alert' : 'check'} size={14} />
        <span className="chip__text">{label}</span>
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label={t.transfers}>
          {[...transfers].reverse().map(x => {
            const pct = x.status === 'done' ? 100 : percent(x.done, x.total);
            return (
              <div className="transfer" key={x.id}>
                <div className="transfer__top">
                  <span className="transfer__name" title={x.name}>
                    {x.name}
                  </span>
                  <span
                    className={x.status === 'error' ? '' : 'muted'}
                    style={x.status === 'error' ? { color: 'var(--ui-danger)' } : undefined}
                  >
                    {x.status === 'error'
                      ? t.transferFailed
                      : x.status === 'done'
                        ? t.transferDone
                        : `${pct}%`}
                  </span>
                </div>
                {x.status === 'error' ? (
                  <div className="hint" style={{ color: 'var(--ui-danger)' }}>
                    {x.error}
                  </div>
                ) : (
                  <div className="progress" style={{ width: '100%' }}>
                    <span style={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>
            );
          })}
          <button className="btn" onClick={clearFinished}>
            {t.clearFinished}
          </button>
        </div>
      )}
    </>
  );
}

export function StatusBar(): ReactElement {
  const entries = useBrowserStore(s => s.entries);
  const selection = useBrowserStore(s => s.selection);
  const quota = useBrowserStore(s => s.quota);

  const selectedSize = entries
    .filter(e => selection.includes(e.path) && e.type !== 'dir')
    .reduce((n, e) => n + (e.size ?? 0), 0);
  const quotaPct = quota ? percent(quota.used, quota.total) : 0;

  return (
    <div className="statusbar">
      <span>
        {t.items(entries.length)}
        {selection.length > 0 && (
          <>
            {' · '}
            {t.selected(selection.length)}
            {selectedSize > 0 && ` (${formatSize(selectedSize, lang)})`}
          </>
        )}
      </span>
      <span className="statusbar__spacer" />
      <TransferChip />
      <SyncChip />
      {quota && (
        <span
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
          title={`${t.tipQuota}: ${quotaPct}%`}
        >
          <span
            className="progress"
            role="progressbar"
            aria-valuenow={quotaPct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span
              style={{
                width: `${quotaPct}%`,
                background: quotaPct > 90 ? 'var(--ui-danger)' : undefined,
              }}
            />
          </span>
          {t.quota(formatSize(quota.used, lang), formatSize(quota.total, lang))}
        </span>
      )}
    </div>
  );
}
