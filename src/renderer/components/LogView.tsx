import { useEffect, useMemo, useRef, useState } from 'react';

import {
  LOG_CATEGORIES,
  LOG_LEVELS,
  visibleAt,
  type LogCategory,
  type LogEntry,
  type LogLevel,
} from '../../shared/log';
import { t } from '../lib/strings';

const MAX_SHOWN = 5000;
const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

export function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** One entry as plain text — what "Copy" puts on the clipboard. */
export function formatEntry(e: LogEntry): string {
  const data = e.data === undefined ? '' : ` ${JSON.stringify(e.data)}`;
  return `${formatTime(e.ts)} ${e.level.toUpperCase().padEnd(5)} ${e.cat.padEnd(8)} ${e.msg}${data}`;
}

/** Entries that pass the category, verbosity and text filters. */
export function filterEntries(
  entries: LogEntry[],
  cats: Set<LogCategory>,
  verbosity: LogLevel,
  query: string
): LogEntry[] {
  const q = query.trim().toLowerCase();
  return entries.filter(
    e =>
      cats.has(e.cat) &&
      visibleAt(e, verbosity) &&
      (q === '' ||
        `${e.msg} ${e.data === undefined ? '' : JSON.stringify(e.data)}`.toLowerCase().includes(q))
  );
}

export function LogView(): JSX.Element {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [verbosity, setVerbosity] = useState<LogLevel>('info');
  const [recordLevel, setRecordLevel] = useState<LogLevel>('debug');
  const [cats, setCats] = useState<Set<LogCategory>>(new Set(LOG_CATEGORIES));
  const [query, setQuery] = useState('');
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let off = (): void => undefined;
    void window.api.logGet().then(r => {
      setEntries(r.entries);
      setRecordLevel(r.recordLevel);
    });
    off = window.api.onLogEntry(e => setEntries(prev => [...prev.slice(-(MAX_SHOWN - 1)), e]));
    return () => off();
  }, []);

  const shown = useMemo(
    () => filterEntries(entries, cats, verbosity, query),
    [entries, cats, verbosity, query]
  );

  useEffect(() => {
    if (follow && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [shown, follow]);

  // The file gets whatever is recorded: trace holds full Disk answers (names and paths of files).
  const sensitive = recordLevel === 'trace' || entries.some(x => x.level === 'trace');

  const toggleCat = (c: LogCategory): void =>
    setCats(prev => {
      const next = new Set(prev);
      if (!next.delete(c)) next.add(c);
      return next;
    });

  return (
    <div className="logview">
      <div className="toolbar logview__bar">
        <div className="logview__filters">
          <span className="logview__label">{t.logFilterCats}</span>
          {LOG_CATEGORIES.map(c => (
            <label
              key={c}
              className={`chip chip--toggle${cats.has(c) ? ' is-on' : ''}`}
              title={t.logTipCategory}
            >
              <input type="checkbox" checked={cats.has(c)} onChange={() => toggleCat(c)} />
              {t.logCat[c]}
            </label>
          ))}
          <span className="toolbar__sep" />
          <label className="logview__label" title={t.logTipVerbosity}>
            {t.logVerbosity}
            <select value={verbosity} onChange={e => setVerbosity(e.target.value as LogLevel)}>
              {LOG_LEVELS.map(l => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="logview__label" title={t.logTipRecording}>
            {t.logRecording}
            <select
              value={recordLevel}
              onChange={e => {
                const level = e.target.value as LogLevel;
                setRecordLevel(level);
                void window.api.logSetRecordLevel(level);
              }}
            >
              {LOG_LEVELS.map(l => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="logview__actions">
          <label className="logview__label" title={t.logTipAutoscroll}>
            <input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} />
            {t.logAutoscroll}
          </label>
          <button
            className="btn btn--outline"
            title={t.logTipCopy}
            onClick={() => {
              void navigator.clipboard.writeText(shown.map(formatEntry).join('\n')).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? t.logCopied : t.logCopy}
          </button>
          <button
            className="btn btn--outline"
            title={t.logTipOpenFile}
            onClick={() => void window.api.logReveal()}
          >
            {t.logOpenFile}
          </button>
          <button
            className="btn btn--outline"
            title={t.logTipClear}
            onClick={() => {
              void window.api.logClear().then(() => setEntries([]));
            }}
          >
            {t.logClear}
          </button>
        </div>
        <input
          className="search__input"
          placeholder={t.logSearch}
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>
      {sensitive && (
        <div className="logview__warn" role="alert">
          {t.logTraceWarning}
        </div>
      )}
      <div className="logview__list" ref={listRef}>
        {shown.length === 0 ? (
          <div className="logview__empty">{t.logEmpty}</div>
        ) : (
          shown.map(e => (
            <div key={e.id} className={`logrow logrow--${e.level}`}>
              <span className="logrow__time">{formatTime(e.ts)}</span>
              <span className="logrow__level">{e.level}</span>
              <span className="logrow__cat">{e.cat}</span>
              <span className="logrow__msg">
                {e.msg}
                {e.data !== undefined && (
                  <code className="logrow__data">{JSON.stringify(e.data)}</code>
                )}
              </span>
            </div>
          ))
        )}
      </div>
      <div className="statusbar">{t.logShown(shown.length, entries.length)}</div>
    </div>
  );
}
