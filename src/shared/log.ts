/** Log entry shape shared by the main process and the log window. */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';
export type LogCategory = 'app' | 'api' | 'sync' | 'transfer' | 'ipc';

export interface LogEntry {
  id: number;
  /** Epoch milliseconds. */
  ts: number;
  level: LogLevel;
  cat: LogCategory;
  msg: string;
  /** Extra structured details (already redacted and size-limited). */
  data?: unknown;
}

/** Lower number = more important. */
export const LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

export const LOG_LEVELS: LogLevel[] = ['error', 'warn', 'info', 'debug', 'trace'];
export const LOG_CATEGORIES: LogCategory[] = ['app', 'api', 'sync', 'transfer', 'ipc'];

/** True if an entry should be shown at the given verbosity. */
export const visibleAt = (entry: Pick<LogEntry, 'level'>, verbosity: LogLevel): boolean =>
  LEVEL_ORDER[entry.level] <= LEVEL_ORDER[verbosity];
