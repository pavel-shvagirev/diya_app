import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LOG_CATEGORIES, type LogEntry } from '../../src/shared/log';
import { filterEntries, formatEntry, LogView } from '../../src/renderer/components/LogView';
import { t } from '../../src/renderer/lib/strings';

const e = (
  id: number,
  level: LogEntry['level'],
  cat: LogEntry['cat'],
  msg: string,
  data?: unknown
): LogEntry => ({
  id,
  ts: Date.UTC(2026, 10, 3, 10, 0, id),
  level,
  cat,
  msg,
  ...(data === undefined ? {} : { data }),
});
const ALL = new Set(LOG_CATEGORIES);
const sample = [
  e(1, 'error', 'sync', '✗ upload a.txt: boom'),
  e(2, 'info', 'sync', 'run started'),
  e(3, 'debug', 'api', 'GET /v1/disk → 200'),
  e(4, 'trace', 'api', 'response', { body: { total_space: 1 } }),
];

describe('filterEntries', () => {
  it('verbosity shows that level and everything more important', () => {
    expect(filterEntries(sample, ALL, 'info', '').map(x => x.id)).toEqual([1, 2]);
    expect(filterEntries(sample, ALL, 'trace', '').map(x => x.id)).toEqual([1, 2, 3, 4]);
  });
  it('category filter and text search (also inside data)', () => {
    expect(filterEntries(sample, new Set(['api']), 'trace', '').map(x => x.id)).toEqual([3, 4]);
    expect(filterEntries(sample, ALL, 'trace', 'total_space').map(x => x.id)).toEqual([4]);
    expect(filterEntries(sample, ALL, 'trace', 'RUN STARTED').map(x => x.id)).toEqual([2]);
  });
  it('formats an entry as one text line', () => {
    expect(formatEntry(sample[3]!)).toMatch(
      /TRACE\s+api\s+response \{"body":\{"total_space":1\}\}$/
    );
  });
});

describe('LogView', () => {
  it('keeps the actions together in one group, apart from the wrapping filters', () => {
    const { container } = render(<LogView />);
    const actions = container.querySelector('.logview__actions') as HTMLElement;
    const filters = container.querySelector('.logview__filters') as HTMLElement;
    expect(
      within(actions)
        .getAllByRole('button')
        .map(b => b.textContent)
    ).toEqual([t.logCopy, t.logOpenFile, t.logClear]);
    expect(within(actions).getByLabelText(t.logAutoscroll)).toBeInTheDocument();
    expect(within(filters).getByPlaceholderText(t.logSearch)).toBeInTheDocument();
    expect(within(filters).queryByText(t.logClear)).toBeNull();
  });

  let push: (x: LogEntry) => void;
  beforeEach(() => {
    window.api = {
      logGet: vi.fn().mockResolvedValue({ entries: sample, recordLevel: 'debug', file: '/x/log' }),
      logClear: vi.fn().mockResolvedValue(undefined),
      logSetRecordLevel: vi.fn().mockResolvedValue(undefined),
      logReveal: vi.fn(),
      onLogEntry: vi.fn(cb => {
        push = cb;
        return () => undefined;
      }),
    } as never;
    Element.prototype.scrollTo = vi.fn();
  });

  it('shows entries at info by default, more when verbosity is raised, and live entries', async () => {
    render(<LogView />);
    expect(await screen.findByText('run started')).toBeInTheDocument();
    expect(screen.queryByText('GET /v1/disk → 200')).toBeNull();
    fireEvent.change(screen.getByTitle(t.logTipVerbosity).querySelector('select')!, {
      target: { value: 'debug' },
    });
    expect(screen.getByText('GET /v1/disk → 200')).toBeInTheDocument();
    act(() => push(e(5, 'error', 'api', 'live failure')));
    expect(screen.getByText('live failure')).toBeInTheDocument();
  });

  it('warns in red while the recording level is trace, and when trace entries are in the log', async () => {
    window.api.logGet = vi
      .fn()
      .mockResolvedValue({ entries: [sample[1]!], recordLevel: 'debug', file: '/x/log' });
    render(<LogView />);
    await screen.findByText('run started');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.change(screen.getByTitle(t.logTipRecording).querySelector('select')!, {
      target: { value: 'trace' },
    });
    expect(screen.getByRole('alert').textContent).toBe(t.logTraceWarning);
    fireEvent.change(screen.getByTitle(t.logTipRecording).querySelector('select')!, {
      target: { value: 'debug' },
    });
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => push(e(9, 'trace', 'api', 'response', { body: {} })));
    expect(screen.getByRole('alert')).toBeInTheDocument(); // what is already in the file stays there
  });

  it('warns at once when the window opens with trace already being recorded', async () => {
    window.api.logGet = vi
      .fn()
      .mockResolvedValue({ entries: [], recordLevel: 'trace', file: '/x/log' });
    render(<LogView />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('hides a category, changes the recording level and clears', async () => {
    render(<LogView />);
    await screen.findByText('run started');
    fireEvent.click(screen.getByText(t.logCat.sync!));
    expect(screen.queryByText('run started')).toBeNull();
    fireEvent.change(screen.getByTitle(t.logTipRecording).querySelector('select')!, {
      target: { value: 'trace' },
    });
    expect(window.api.logSetRecordLevel).toHaveBeenCalledWith('trace');
    fireEvent.click(screen.getByText(t.logClear));
    expect(window.api.logClear).toHaveBeenCalled();
  });
});
