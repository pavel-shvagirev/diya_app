/**
 * Sync engine: two-way reconciliation of a local folder with a Yandex.Disk
 * folder.
 *
 * Yandex.Disk's REST API has no change feed, so each run scans both trees and
 * compares them against `sync_state` — what both sides looked like right after
 * the previous run. That baseline is what tells "new on one side" apart from
 * "deleted on the other", and "changed on one side" from "changed on both"
 * (a conflict, which keeps both versions).
 *
 * @module sync-engine
 */
import { createHash } from 'crypto';
import { createReadStream, existsSync } from 'fs';
import { mkdir, readdir, rename, rm, stat } from 'fs/promises';
import * as path from 'path';

import { resolveSafePath } from '../shared/validation.js';
import { errorStatus } from './api-error.js';
import { FsWatcher } from './fs-watcher.js';
import { logger } from './logger.js';
import type { SyncDB, SyncStateEntry } from './sync-db.js';

// ── Public types ───────────────────────────────────────────────

export interface RemoteEntry {
  /** Absolute remote path, e.g. `/Docs/a.txt`. */
  path: string;
  name: string;
  isDir: boolean;
  size: number;
  modified: string;
  md5?: string;
}

/** What the engine needs from the remote side. Implemented over the Yandex.Disk client. */
export interface RemoteStorage {
  list(remoteDir: string): Promise<RemoteEntry[]>;
  stat(remotePath: string): Promise<RemoteEntry>;
  mkdir(remotePath: string): Promise<void>;
  upload(
    localPath: string,
    remotePath: string,
    overwrite: boolean,
    onProgress: (done: number, total: number) => void
  ): Promise<void>;
  download(
    remotePath: string,
    localPath: string,
    onProgress: (done: number, total: number) => void,
    mtime: Date,
    /** Size and md5 from the Disk's listing: the download is verified against them. */
    expected?: { size?: number; md5?: string }
  ): Promise<void>;
  /** Move to the remote trash. */
  remove(remotePath: string): Promise<void>;
}

export interface SyncPairPaths {
  id: string;
  localPath: string;
  remotePath: string;
}

export type SyncPhase = 'idle' | 'scanning' | 'syncing' | 'paused' | 'error';

export interface SyncProgress {
  phase: SyncPhase;
  totalFiles: number;
  doneFiles: number;
  totalBytes: number;
  doneBytes: number;
  current: {
    path: string;
    direction: 'upload' | 'download' | 'delete';
    done: number;
    total: number;
  } | null;
  lastSync: string | null;
  /** Fatal error of the last run (scan failed, guard tripped). */
  error: string | null;
  /** Per-file failures of the last run. */
  failures: string[];
  conflicts: number;
}

/** A conflict-copy marker in any interface language, so copies never pile up across a language switch. */
const CONFLICT_MARKER = /( \((?:conflict copy|конфликтная копия) [^)]*\))+$/;

export interface SyncEngineOptions {
  /** Poll interval for periodic runs. Default 60 000 ms. */
  intervalMs?: number;
  /** Minimum pause between the end of one run and the start of the next. Default 5000 ms. */
  minGapMs?: number;
  /** Delay before a file that got a server error (5xx, 429) is tried again; doubles with each failure. Default 60 000 ms. */
  retryBaseMs?: number;
  /** Longest delay of that kind. Default 30 minutes. */
  retryMaxMs?: number;
  /** Watch the local folder and sync shortly after changes. Default true. */
  watch?: boolean;
  /** How local deletions are performed (default: permanent `rm`). */
  removeLocal?: (localPath: string) => Promise<void>;
  /** A local file modified more recently than this is still being written and is left for the next run. Default 2000 ms. */
  settleMs?: number;
  /** Clock, for conflict-copy names. */
  now?: () => Date;
  /** Words in a conflict-copy name, e.g. "conflict copy" (the interface language decides). */
  conflictLabel?: () => string;
}

// ── Internals ──────────────────────────────────────────────────

interface LocalEntry {
  isDir: boolean;
  size: number;
  mtimeMs: number;
  /** A symbolic link: never followed, never synced, and what it hides is never deleted. */
  link?: boolean;
}

type Op =
  | { kind: 'mkdirRemote'; rel: string }
  | { kind: 'mkdirLocal'; rel: string }
  | { kind: 'upload'; rel: string; size: number }
  | { kind: 'download'; rel: string; size: number }
  | { kind: 'deleteRemote'; rel: string }
  | { kind: 'deleteLocal'; rel: string }
  | { kind: 'conflict'; rel: string; size: number };

const MTIME_TOLERANCE_MS = 2;
/** Longest file-name stem we keep when building a conflict-copy name (filesystems cap names at 255 bytes). */
const MAX_STEM = 100;
const MAX_DELETE_RATIO = 0.5;
const DEFAULT_MIN_GAP_MS = 5000;
const DEFAULT_RETRY_BASE_MS = 60_000;
const DEFAULT_RETRY_MAX_MS = 30 * 60_000;
const MIN_GUARDED_DELETES = 10;

/** Files the engine never syncs: dotfiles, partial downloads, OS noise. */
function isIgnored(name: string): boolean {
  return name.startsWith('.') || name.endsWith('.part');
}

function md5File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('md5');
    createReadStream(file)
      .on('data', c => hash.update(c))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

function directionOf(op: Op): 'upload' | 'download' | 'delete' {
  if (op.kind === 'upload') return 'upload';
  if (op.kind === 'deleteLocal' || op.kind === 'deleteRemote') return 'delete';
  return 'download';
}

const toPosix = (p: string): string => p.split(path.sep).join('/');

function emptyProgress(lastSync: string | null = null): SyncProgress {
  return {
    phase: 'idle',
    totalFiles: 0,
    doneFiles: 0,
    totalBytes: 0,
    doneBytes: 0,
    current: null,
    lastSync,
    error: null,
    failures: [],
    conflicts: 0,
  };
}

export class SyncEngine {
  private pair: SyncPairPaths | null = null;
  private progress: SyncProgress = emptyProgress();
  private listeners: Array<(p: SyncProgress) => void> = [];
  private timer: NodeJS.Timeout | null = null;
  private watcher: FsWatcher | null = null;
  private running = false;
  private rerun = false;
  /** True when the last plan skipped files that were still changing. */
  private deferred = false;
  private deferTimer: NodeJS.Timeout | null = null;
  private enabled = false;
  /** When the last run ended (ms since epoch): runs keep `minGapMs` apart. */
  private lastFinished = 0;
  /** A manual run is waiting: the next run skips the pause. */
  private immediate = false;
  /** Ends the pause before a run early (set only while a run is waiting out the pause). */
  private endPause: (() => void) | null = null;
  /** Files the Disk answered with a server error: when to try them again. */
  private readonly retries = new Map<string, { attempts: number; until: number }>();
  private readonly opts: Required<SyncEngineOptions>;

  constructor(
    private readonly remote: RemoteStorage,
    private readonly db: SyncDB,
    options: SyncEngineOptions = {}
  ) {
    this.opts = {
      intervalMs: options.intervalMs ?? 60_000,
      minGapMs: options.minGapMs ?? DEFAULT_MIN_GAP_MS,
      retryBaseMs: options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS,
      retryMaxMs: options.retryMaxMs ?? DEFAULT_RETRY_MAX_MS,
      watch: options.watch ?? true,
      removeLocal: options.removeLocal ?? (p => rm(p, { recursive: true, force: true })),
      settleMs: options.settleMs ?? 2000,
      now: options.now ?? (() => new Date()),
      conflictLabel: options.conflictLabel ?? (() => 'conflict copy'),
    };
  }

  // ── Control ──────────────────────────────────────────────────

  getProgress(): SyncProgress {
    return { ...this.progress, failures: [...this.progress.failures] };
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  onProgress(cb: (p: SyncProgress) => void): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter(l => l !== cb);
    };
  }

  /** Point the engine at a pair. Stops any running schedule; does not start it. */
  configure(pair: SyncPairPaths | null): void {
    this.stop();
    this.pair = pair;
    this.retries.clear();
    const last = pair ? (this.db.getPair(pair.id)?.lastSync ?? null) : null;
    this.progress = emptyProgress(last);
    this.emit();
  }

  /** Run now, then periodically and after local changes. */
  start(): void {
    if (!this.pair || this.enabled) return;
    this.enabled = true;
    this.progress = { ...this.progress, phase: 'idle', error: null };
    this.timer = setInterval(() => {
      // A run that outlasts the interval must not be followed at once by another full scan.
      if (this.running) return;
      logger.debug('sync', 'scheduled run');
      void this.syncNow();
    }, this.opts.intervalMs);
    if (this.opts.watch) {
      this.watcher = new FsWatcher(this.pair.localPath, { debounceMs: 1500 });
      this.watcher.onEvent(ev => {
        logger.debug(
          'sync',
          `local ${ev.type}: ${path.relative(this.pair?.localPath ?? '', ev.path)}`
        );
        void this.syncNow();
      });
      try {
        this.watcher.start();
      } catch (err) {
        logger.error('sync', 'file watcher failed to start; relying on the timer', err);
        this.watcher = null;
      }
    }
    void this.syncNow();
  }

  /** Pause: stop the schedule and the watcher; a run in flight finishes its current file. */
  stop(): void {
    this.enabled = false;
    if (this.deferTimer) clearTimeout(this.deferTimer);
    this.deferTimer = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    void this.watcher?.stop();
    this.watcher = null;
    if (this.pair && this.progress.phase !== 'error') {
      this.progress = { ...this.progress, phase: 'paused' };
      this.emit();
    }
  }

  private emit(): void {
    const snapshot = this.getProgress();
    for (const l of this.listeners) l(snapshot);
  }

  private patch(p: Partial<SyncProgress>): void {
    this.progress = { ...this.progress, ...p };
    this.emit();
  }

  // ── One reconciliation run ───────────────────────────────────

  /**
   * Reconcile once. Concurrent calls collapse into one follow-up run. Runs keep `minGapMs` apart
   * unless `immediate` is set (the user pressed "Sync now").
   */
  async syncNow(options: { immediate?: boolean } = {}): Promise<void> {
    if (!this.pair) return;
    if (options.immediate) {
      this.immediate = true;
      this.endPause?.();
    }
    if (this.running) {
      this.rerun = true;
      logger.debug('sync', 'run requested while one is in progress — will repeat once it ends');
      return;
    }
    this.running = true;
    try {
      do {
        this.rerun = false;
        const wait = this.immediate ? 0 : this.lastFinished + this.opts.minGapMs - Date.now();
        this.immediate = false;
        if (wait > 0) {
          await new Promise<void>(resolve => {
            const timer = setTimeout(resolve, wait);
            this.endPause = () => {
              clearTimeout(timer);
              resolve();
            };
          });
          this.endPause = null;
        }
        const pair = this.pair;
        if (!pair) break;
        try {
          await this.runOnce(pair);
        } finally {
          this.lastFinished = Date.now();
        }
      } while (this.rerun && this.enabled);
    } finally {
      this.running = false;
    }
  }

  private async runOnce(pair: SyncPairPaths): Promise<void> {
    const base = { ...emptyProgress(this.progress.lastSync), phase: 'scanning' as SyncPhase };
    this.progress = base;
    this.deferred = false;
    this.emit();
    const runStarted = Date.now();
    logger.info('sync', 'run started', { local: pair.localPath, remote: pair.remotePath });

    let ops: Op[];
    let local: Map<string, LocalEntry>;
    let remote: Map<string, RemoteEntry>;
    const state = this.db.getSyncStates(pair.id);
    let rootExisted = true;
    try {
      rootExisted = await stat(pair.localPath).then(
        st => st.isDirectory(),
        () => false
      );
      await mkdir(pair.localPath, { recursive: true });
      local = await this.scanLocal(pair.localPath);
      remote = await this.scanRemote(pair.remotePath);
      logger.debug('sync', `scan: ${local.size} local, ${remote.size} remote, ${state.size} known`);
      ops = await this.plan(pair, local, remote, state);
      this.guardDeletes(ops, state, rootExisted);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('sync', `run aborted: ${message}`);
      this.patch({ phase: 'error', error: message });
      return;
    }

    const transfers = ops.filter(o => o.kind !== 'mkdirLocal' && o.kind !== 'mkdirRemote');
    this.patch({
      phase: 'syncing',
      totalFiles: transfers.length,
      totalBytes: ops.reduce(
        (n, o) =>
          n + (o.kind === 'upload' || o.kind === 'download' || o.kind === 'conflict' ? o.size : 0),
        0
      ),
    });

    const failures: string[] = [];
    let conflicts = 0;
    let doneBytes = 0;
    let doneFiles = 0;

    const done = (op: Op): void => {
      if (op.kind !== 'mkdirLocal' && op.kind !== 'mkdirRemote') doneFiles++;
      this.patch({ doneFiles, doneBytes, current: null, failures: [...failures], conflicts });
    };

    for (const op of ops) {
      const hold = this.retryHold(op.rel);
      if (hold > 0) {
        // The Disk is failing on this file: no request until its delay is over.
        failures.push(`${op.rel}: server error, next try in ${Math.ceil(hold / 1000)} s`);
        logger.debug('sync', `${op.rel}: held back, next try in ${Math.ceil(hold / 1000)} s`);
        done(op);
        continue;
      }
      const opStarted = Date.now();
      logger.info('sync', `▶ ${op.kind} ${op.rel}${'size' in op ? ` (${op.size} B)` : ''}`);
      try {
        const bytes = await this.execute(pair, op, local, remote, (done, total) =>
          this.patch({
            doneBytes: doneBytes + done,
            current: {
              path: op.rel,
              direction: directionOf(op),
              done,
              total,
            },
          })
        );
        doneBytes += bytes;
        this.retries.delete(op.rel);
        if (op.kind === 'conflict') conflicts++;
        logger.debug('sync', `✓ ${op.kind} ${op.rel} (${Date.now() - opStarted} ms)`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push(`${op.rel}: ${message}`);
        logger.error('sync', `✗ ${op.kind} ${op.rel}: ${message}`);
        this.noteFailure(op.rel, err);
      }
      done(op);
    }

    // Files that were still being written: look again shortly after they settle.
    if (this.deferred && this.enabled && !this.deferTimer) {
      this.deferTimer = setTimeout(() => {
        this.deferTimer = null;
        void this.syncNow();
      }, this.opts.settleMs + 500);
    }

    logger.info('sync', `run finished in ${Date.now() - runStarted} ms`, {
      operations: ops.length,
      bytes: doneBytes,
      failures: failures.length,
      conflicts,
      deferred: this.deferred,
    });
    const lastSync = this.opts.now().toISOString();
    if (failures.length === 0) this.db.updateSyncTime(pair.id, lastSync);
    this.patch({
      phase: this.enabled ? 'idle' : 'paused',
      current: null,
      lastSync: failures.length === 0 ? lastSync : this.progress.lastSync,
    });
  }

  /** Milliseconds left before `rel` may be tried again (0 when it may be tried now). */
  private retryHold(rel: string): number {
    const entry = this.retries.get(rel);
    return entry ? Math.max(0, entry.until - Date.now()) : 0;
  }

  /** A server error (5xx, 429) delays the next try for this file, doubling each time; anything else clears it. */
  private noteFailure(rel: string, err: unknown): void {
    const status = errorStatus(err);
    if (status === undefined || (status < 500 && status !== 429)) {
      this.retries.delete(rel);
      return;
    }
    const attempts = (this.retries.get(rel)?.attempts ?? 0) + 1;
    const delay = Math.min(this.opts.retryBaseMs * 2 ** (attempts - 1), this.opts.retryMaxMs);
    this.retries.set(rel, { attempts, until: Date.now() + delay });
  }

  // ── Scanning ─────────────────────────────────────────────────

  private async scanLocal(root: string): Promise<Map<string, LocalEntry>> {
    const out = new Map<string, LocalEntry>();
    const walk = async (dir: string): Promise<void> => {
      for (const ent of await readdir(dir, { withFileTypes: true })) {
        if (isIgnored(ent.name)) continue;
        const full = path.join(dir, ent.name);
        const rel = toPosix(path.relative(root, full));
        if (ent.isSymbolicLink()) {
          out.set(rel, { isDir: false, size: 0, mtimeMs: 0, link: true });
        } else if (ent.isDirectory()) {
          out.set(rel, { isDir: true, size: 0, mtimeMs: 0 });
          await walk(full);
        } else if (ent.isFile()) {
          const st = await stat(full);
          out.set(rel, { isDir: false, size: st.size, mtimeMs: st.mtimeMs });
        }
      }
    };
    await walk(root);
    return out;
  }

  private async scanRemote(root: string): Promise<Map<string, RemoteEntry>> {
    const out = new Map<string, RemoteEntry>();
    const rootPrefix = root === '/' ? '' : root;
    const queue = [root];
    // A missing remote root is created; any other listing error aborts the run
    // (treating a failed listing as "empty" would delete local files).
    if (root !== '/') {
      try {
        await this.remote.list(root);
      } catch (err) {
        if (errorStatus(err) !== 404) throw err;
        await this.remote.mkdir(root);
      }
    }
    while (queue.length) {
      const dir = queue.shift() as string;
      for (const e of await this.remote.list(dir)) {
        if (isIgnored(e.name)) continue;
        out.set(e.path.slice(rootPrefix.length + 1), e);
        if (e.isDir) queue.push(e.path);
      }
    }
    return out;
  }

  // ── Planning ─────────────────────────────────────────────────

  private async plan(
    pair: SyncPairPaths,
    local: Map<string, LocalEntry>,
    remote: Map<string, RemoteEntry>,
    state: ReturnType<SyncDB['getSyncStates']>
  ): Promise<Op[]> {
    const dirsUp: Op[] = [];
    const dirsDown: Op[] = [];
    const files: Op[] = [];
    const deletes: Op[] = [];
    const rels = new Set([...local.keys(), ...remote.keys(), ...state.keys()]);

    /** Add an operation and record why it was chosen. */
    const decide = (list: Op[], op: Op, why: string): void => {
      list.push(op);
      logger.debug('sync', `${op.rel}: ${op.kind} — ${why}`);
    };
    const note = (rel: string, why: string): void => logger.debug('sync', `${rel}: ${why}`);

    // Something the user swapped for a link looks "gone" here; the Disk copy must stay untouched.
    const links = [...local].filter(([, e]) => e.link).map(([rel]) => rel);
    const behindLink = (rel: string): boolean =>
      links.some(link => rel === link || rel.startsWith(link + '/'));

    for (const rel of [...rels].sort()) {
      if (behindLink(rel)) {
        note(rel, 'symbolic link (or inside one): not synced, nothing deleted');
        continue;
      }
      const l = local.get(rel);
      const r = remote.get(rel);
      const s = state.get(rel);
      logger.trace('sync', `${rel}: inspect`, {
        local: l && { size: l.size, mtimeMs: l.mtimeMs, dir: l.isDir },
        remote: r && { size: r.size, modified: r.modified, md5: r.md5, dir: r.isDir },
        state: s,
      });

      if ((l?.isDir ?? false) || (r?.isDir ?? false) || (s?.isDir ?? false)) {
        // Directories are only created (never deleted) — deleting a folder
        // that holds unsynced files on the other side would lose data.
        if (l?.isDir && !r)
          decide(dirsUp, { kind: 'mkdirRemote', rel }, 'folder exists only locally');
        if (r?.isDir && !l)
          decide(dirsDown, { kind: 'mkdirLocal', rel }, 'folder exists only on the Disk');
        continue;
      }

      if (l && r) {
        if (this.stillChanging(l)) {
          this.deferred = true;
          note(
            rel,
            `wait — modified ${Math.round((Date.now() - l.mtimeMs) / 100) / 10}s ago, still being written`
          );
          continue;
        }
        if (!s) {
          // Seen on both sides for the first time.
          if (l.size !== r.size) {
            decide(
              files,
              { kind: 'conflict', rel, size: r.size },
              `first sight, sizes differ (local ${l.size} B, Disk ${r.size} B)`
            );
          } else if (!r.md5) {
            // The Disk has not hashed the file yet (typical right after a big upload):
            // we cannot tell, so wait instead of inventing a conflict.
            this.deferred = true;
            note(rel, 'wait — same size, but the Disk has no md5 yet');
          } else if (r.md5 === (await md5File(path.join(pair.localPath, rel)))) {
            this.record(pair, rel, l, r);
            note(rel, 'identical on both sides (md5 match) — now tracked, nothing to transfer');
          } else {
            decide(
              files,
              { kind: 'conflict', rel, size: r.size },
              'first sight, same size but different content (md5)'
            );
          }
          continue;
        }
        const known = this.adoptRemote(pair, rel, r, s);
        if (known !== s) note(rel, 'adopted the Disk timestamp of an earlier upload');
        const lChanged = this.localChanged(l, known);
        const rChanged = this.remoteChanged(r, known);
        if (lChanged && rChanged) {
          decide(
            files,
            { kind: 'conflict', rel, size: r.size },
            'changed on both sides since the last sync'
          );
        } else if (lChanged) {
          decide(files, { kind: 'upload', rel, size: l.size }, 'changed locally');
        } else if (rChanged) {
          decide(files, { kind: 'download', rel, size: r.size }, 'changed on the Disk');
        } else {
          logger.trace('sync', `${rel}: in sync`);
        }
      } else if (l && !r) {
        if (!s || this.localChanged(l, s)) {
          if (this.stillChanging(l)) {
            this.deferred = true;
            note(rel, 'wait — new/changed locally but still being written');
          } else {
            decide(
              files,
              { kind: 'upload', rel, size: l.size },
              s ? 'changed locally, missing on the Disk' : 'new locally'
            );
          }
        } else
          decide(
            deletes,
            { kind: 'deleteLocal', rel },
            'was synced, now gone from the Disk and unchanged locally'
          );
      } else if (r && !l) {
        if (!s) decide(files, { kind: 'download', rel, size: r.size }, 'new on the Disk');
        else if (this.remoteChanged(r, s))
          decide(
            files,
            { kind: 'download', rel, size: r.size },
            'changed on the Disk, missing locally'
          );
        else
          decide(
            deletes,
            { kind: 'deleteRemote', rel },
            'was synced, now gone locally and unchanged on the Disk'
          );
      } else if (s) {
        // Gone from both sides.
        this.db.removeSyncState(pair.id, rel);
        note(rel, 'gone from both sides — forgotten');
      }
    }
    return [...dirsUp, ...dirsDown, ...files, ...deletes];
  }

  private localChanged(l: LocalEntry, s: { localSize: number; localMtimeMs: number }): boolean {
    return l.size !== s.localSize || Math.abs(l.mtimeMs - s.localMtimeMs) > MTIME_TOLERANCE_MS;
  }

  /** Modified a moment ago: probably still being written (cp, dd, a download…). */
  private stillChanging(l: LocalEntry): boolean {
    return this.opts.settleMs > 0 && Date.now() - l.mtimeMs < this.opts.settleMs;
  }

  /**
   * After an upload the Disk may not have shown us the file yet, so its state was
   * saved with an unknown remote timestamp (''). The first time the file is listed
   * with the size we uploaded, adopt the real timestamp — that is not a remote edit.
   */
  private adoptRemote(
    pair: SyncPairPaths,
    rel: string,
    r: RemoteEntry,
    s: SyncStateEntry
  ): SyncStateEntry {
    if (s.remoteModified !== '' || r.size !== s.remoteSize) return s;
    const adopted = { ...s, remoteModified: r.modified };
    this.db.setSyncState(pair.id, adopted);
    return adopted;
  }

  private remoteChanged(
    r: RemoteEntry,
    s: { remoteSize: number; remoteModified: string }
  ): boolean {
    return r.size !== s.remoteSize || r.modified !== s.remoteModified;
  }

  /**
   * Refuse a run whose deletions look like a lost folder rather than a decision.
   *
   * - Files that vanished from the Disk (`deleteLocal`) are always checked: an empty or
   *   half-empty listing is far more likely to be an API hiccup than the user deleting
   *   everything in the cloud.
   * - Files the user removed locally (`deleteRemote`) are carried to the Disk (its trash,
   *   so reversible) — unless the whole sync folder was missing at the start of the run
   *   (unmounted drive, renamed or moved folder), where "everything is gone" is not a decision.
   */
  private guardDeletes(ops: Op[], state: Map<string, unknown>, rootExisted: boolean): void {
    const count = (kind: Op['kind']): number => ops.filter(o => o.kind === kind).length;
    const suspicious = (n: number): boolean =>
      n >= MIN_GUARDED_DELETES && n > state.size * MAX_DELETE_RATIO;
    const fromDisk = count('deleteLocal');
    const fromLocal = rootExisted ? 0 : count('deleteRemote');
    if (suspicious(fromDisk) || suspicious(fromLocal)) {
      const n = fromDisk + fromLocal;
      logger.error('sync', `guard: ${n} deletions of ${state.size} synced files`, { rootExisted });
      throw new Error(
        `Refusing to delete ${n} of ${state.size} synced files — check that both folders are available`
      );
    }
  }

  // ── Execution ────────────────────────────────────────────────

  private record(pair: SyncPairPaths, rel: string, l: LocalEntry, r: RemoteEntry): void {
    this.db.setSyncState(pair.id, {
      relPath: rel,
      isDir: false,
      localSize: l.size,
      localMtimeMs: l.mtimeMs,
      remoteSize: r.size,
      remoteModified: r.modified,
    });
  }

  private localFull(pair: SyncPairPaths, rel: string): string {
    return resolveSafePath(pair.localPath, rel);
  }

  private remoteFull(pair: SyncPairPaths, rel: string): string {
    return `${pair.remotePath === '/' ? '' : pair.remotePath}/${rel}`;
  }

  /** After a download: local file as written, remote as listed. */
  private async recordDownloaded(pair: SyncPairPaths, rel: string, r: RemoteEntry): Promise<void> {
    const st = await stat(this.localFull(pair, rel));
    this.record(pair, rel, { isDir: false, size: st.size, mtimeMs: st.mtimeMs }, r);
  }

  /**
   * After an upload: remember the local file as it was when the upload started, so an
   * edit made during the transfer is picked up (and re-uploaded) by the next run.
   * The remote side is read back if the Disk already shows the file; if not (large
   * uploads can lag), its timestamp is recorded as unknown and adopted later.
   */
  private async recordUploaded(pair: SyncPairPaths, rel: string, l: LocalEntry): Promise<void> {
    let r: RemoteEntry;
    try {
      r = await this.remote.stat(this.remoteFull(pair, rel));
    } catch {
      r = { path: this.remoteFull(pair, rel), name: rel, isDir: false, size: l.size, modified: '' };
    }
    if (r.modified !== '' && r.size !== l.size && (await this.localUnchanged(pair, rel, l))) {
      // The Disk holds a different number of bytes than we sent and the file did not change
      // meanwhile: the transfer was damaged. Do not keep it — a wrong remote copy would be
      // read as a conflict on the next run. Removing it moves it to the Disk trash.
      await this.remote.remove(this.remoteFull(pair, rel)).catch(() => undefined);
      throw new Error(
        `Upload verification failed: Disk has ${r.size} B, local file is ${l.size} B`
      );
    }
    this.record(pair, rel, l, r);
  }

  private async localUnchanged(pair: SyncPairPaths, rel: string, l: LocalEntry): Promise<boolean> {
    try {
      const now = await stat(this.localFull(pair, rel));
      return now.size === l.size && Math.abs(now.mtimeMs - l.mtimeMs) <= MTIME_TOLERANCE_MS;
    } catch {
      return false;
    }
  }

  /** Returns the bytes this op moved. */
  private async execute(
    pair: SyncPairPaths,
    op: Op,
    local: Map<string, LocalEntry>,
    remote: Map<string, RemoteEntry>,
    onProgress: (done: number, total: number) => void
  ): Promise<number> {
    const full = this.localFull(pair, op.rel);
    const rfull = this.remoteFull(pair, op.rel);

    switch (op.kind) {
      case 'mkdirLocal':
        await mkdir(full, { recursive: true });
        return 0;
      case 'mkdirRemote':
        await this.remote.mkdir(rfull);
        return 0;
      case 'upload': {
        const existed = remote.has(op.rel);
        const l = local.get(op.rel) as LocalEntry;
        await this.remote.upload(full, rfull, existed, onProgress);
        await this.recordUploaded(pair, op.rel, l);
        return op.size;
      }
      case 'download': {
        const r = remote.get(op.rel) as RemoteEntry;
        await mkdir(path.dirname(full), { recursive: true });
        await this.remote.download(rfull, full, onProgress, new Date(r.modified), {
          size: r.size,
          md5: r.md5,
        });
        await this.recordDownloaded(pair, op.rel, r);
        return op.size;
      }
      case 'conflict': {
        // Keep both: the local version moves aside under a conflict name
        // (uploaded on the next pass), the remote version takes the original name.
        const r = remote.get(op.rel) as RemoteEntry;
        const copy = this.conflictName(full);
        await rename(full, copy);
        await this.remote.download(rfull, full, onProgress, new Date(r.modified), {
          size: r.size,
          md5: r.md5,
        });
        await this.recordDownloaded(pair, op.rel, r);
        return op.size;
      }
      case 'deleteRemote':
        await this.remote.remove(rfull);
        this.db.removeSyncState(pair.id, op.rel);
        return 0;
      case 'deleteLocal':
        await this.opts.removeLocal(full);
        this.db.removeSyncState(pair.id, op.rel);
        local.delete(op.rel);
        return 0;
    }
  }

  /**
   * `name (conflict copy YYYY-MM-DD HH-mm).ext` (the label follows the interface language). A
   * name that already carries the marker, in any language, is reused, not extended — copies must never keep growing — and an existing
   * file is never overwritten.
   */
  private conflictName(full: string): string {
    const d = this.opts.now();
    const pad = (n: number): string => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}`;
    const ext = path.extname(full);
    const dir = path.dirname(full);
    const base = path.basename(full, ext).replace(CONFLICT_MARKER, '');
    const stem = base.length > MAX_STEM ? base.slice(0, MAX_STEM) : base;
    for (let n = 1; ; n++) {
      const suffix = n === 1 ? '' : ` ${n}`;
      const candidate = path.join(
        dir,
        `${stem} (${this.opts.conflictLabel()} ${stamp}${suffix})${ext}`
      );
      if (!existsSync(candidate)) return candidate;
    }
  }
}
