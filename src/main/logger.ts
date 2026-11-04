/**
 * Application log: an in-memory ring buffer (what the log window shows), an
 * optional file (moved aside to `diya.log.1` at 5 MB, at start and while running), and live
 * subscribers. Everything is redacted first:
 * tokens and signed URLs never reach the buffer, the file or the window.
 *
 * @module logger
 */
import { createWriteStream, mkdirSync, renameSync, statSync, type WriteStream } from 'fs';
import * as path from 'path';

import { LEVEL_ORDER, type LogCategory, type LogEntry, type LogLevel } from '../shared/log.js';

const MAX_ENTRIES = 5000;
const MAX_DATA_CHARS = 4000;
/** Size limit of the log file; exported so that tests can shrink it. */
export const logTuning = { maxFileBytes: 5 * 1024 * 1024 };
const SECRET_KEY = /token|authorization|password|secret|cookie|signature/i;

/** Hide the query string of any non-API URL (upload/download links carry signed tokens). */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === 'cloud-api.yandex.net') return `${u.pathname}${u.search}`;
    return `${u.protocol}//${u.hostname}${u.pathname}${u.search ? '?…' : ''}`;
  } catch {
    return url;
  }
}

/** JSON-safe copy with secrets masked and the size capped. */
export function sanitize(value: unknown): unknown {
  const seen = new WeakSet<object>();
  const walk = (v: unknown, depth: number): unknown => {
    if (v === null || typeof v !== 'object') {
      if (typeof v === 'string' && /^https?:\/\//.test(v)) return redactUrl(v);
      if (typeof v === 'bigint') return String(v);
      if (typeof v === 'function' || typeof v === 'symbol') return undefined;
      return v;
    }
    if (v instanceof Error) return { name: v.name, message: v.message };
    if (seen.has(v) || depth > 5) return '[…]';
    seen.add(v);
    if (Array.isArray(v)) return v.slice(0, 50).map(x => walk(x, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v))
      out[k] = SECRET_KEY.test(k) ? '***' : walk(x, depth + 1);
    return out;
  };
  const clean = walk(value, 0);
  const text = JSON.stringify(clean);
  if (text !== undefined && text.length > MAX_DATA_CHARS) {
    return {
      truncated: `${text.slice(0, MAX_DATA_CHARS)}… (+${text.length - MAX_DATA_CHARS} chars)`,
    };
  }
  return clean;
}

class Logger {
  private entries: LogEntry[] = [];
  private nextId = 1;
  private listeners = new Set<(e: LogEntry) => void>();
  private stream: WriteStream | null = null;
  private filePath: string | null = null;
  /** Bytes in the current file, so that it can be moved aside while the app runs. */
  private fileBytes = 0;
  /** Entries more verbose than this are dropped. `trace` is expensive, so it is opt-in. */
  private recordLevel: LogLevel = 'debug';

  log(level: LogLevel, cat: LogCategory, msg: string, data?: unknown): void {
    if (LEVEL_ORDER[level] > LEVEL_ORDER[this.recordLevel]) return;
    const entry: LogEntry = {
      id: this.nextId++,
      ts: Date.now(),
      level,
      cat,
      msg,
      ...(data === undefined ? {} : { data: sanitize(data) }),
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES)
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    this.writeLine(`${JSON.stringify(entry)}\n`);
    for (const l of this.listeners) l(entry);
  }

  error(cat: LogCategory, msg: string, data?: unknown): void {
    this.log('error', cat, msg, data);
  }
  warn(cat: LogCategory, msg: string, data?: unknown): void {
    this.log('warn', cat, msg, data);
  }
  info(cat: LogCategory, msg: string, data?: unknown): void {
    this.log('info', cat, msg, data);
  }
  debug(cat: LogCategory, msg: string, data?: unknown): void {
    this.log('debug', cat, msg, data);
  }
  trace(cat: LogCategory, msg: string, data?: unknown): void {
    this.log('trace', cat, msg, data);
  }

  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }

  setRecordLevel(level: LogLevel): void {
    this.recordLevel = level;
  }

  getRecordLevel(): LogLevel {
    return this.recordLevel;
  }

  /** Subscribe to new entries. Returns the unsubscribe function. */
  onEntry(cb: (e: LogEntry) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private writeLine(line: string): void {
    if (!this.stream) return;
    this.stream.write(line);
    this.fileBytes += Buffer.byteLength(line);
    if (this.fileBytes > logTuning.maxFileBytes) this.rotate();
  }

  /** Keep one older generation (`diya.log.1`); never let a failure here break the app. */
  private rotate(): void {
    const file = this.filePath;
    if (!file) return;
    try {
      this.stream?.end();
      renameSync(file, `${file}.1`);
    } catch {
      // the file stays where it is and keeps growing; logging goes on
    }
    this.fileBytes = 0;
    this.openStream(file);
  }

  private openStream(file: string): void {
    this.stream = createWriteStream(file, { flags: 'a' });
    this.stream.on('error', () => {
      this.stream = null; // never let logging break the app
    });
  }

  /** Also write entries (JSON lines) to `<dir>/diya.log`; a file over 5 MB is moved aside. */
  attachFile(dir: string): string {
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'diya.log');
    try {
      if (statSync(file).size > logTuning.maxFileBytes) renameSync(file, `${file}.1`);
    } catch {
      // no previous file
    }
    this.stream?.end();
    this.openStream(file);
    try {
      this.fileBytes = statSync(file).size;
    } catch {
      this.fileBytes = 0;
    }
    this.filePath = file;
    return file;
  }

  getFilePath(): string | null {
    return this.filePath;
  }

  close(): void {
    this.stream?.end();
    this.stream = null;
  }
}

export const logger = new Logger();
export type { Logger };
