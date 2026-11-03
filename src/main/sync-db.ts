/**
 * Sync metadata database backed by better-sqlite3.
 *
 * Manages sync pairs, per-file metadata (hashes, modification times, status),
 * a pending operations queue, and Yandex.Disk /changes delta positions.
 *
 * @module sync-db
 */

import { copyFileSync } from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';

import type { SyncFileMeta, SyncDBOperation, SyncPosition, SyncConflict } from '../shared/types.js';

// ── Public return types ────────────────────────────────────────

interface SyncPairPublic {
  id: string;
  localPath: string;
  remotePath: string;
  isActive: boolean;
  lastSync?: string;
}

interface FileMetaPublic {
  id: string;
  localPath: string;
  remotePath: string;
  size: number;
  modified: string;
  localHash: string;
  remoteHash: string;
  lastSyncedLocal: string;
  lastSyncedRemote: string;
  status: 'synced' | 'conflicted' | 'pending';
  conflictType?: 'both-modified' | 'only-local-modified' | 'only-remote-modified';
}

interface OpPublic {
  id: string;
  pairId: string;
  type: 'upload' | 'download';
  status: 'pending' | 'completed' | 'failed';
  filePath: string;
  remotePath: string;
  errorMessage?: string;
  retryCount: number;
  createdAt: string;
  completedAt?: string;
}

export interface SyncStateEntry {
  relPath: string;
  isDir: boolean;
  localSize: number;
  localMtimeMs: number;
  remoteSize: number;
  remoteModified: string;
}

// ── Internal SQLite row types (snake_case) ─────────────────────

interface SDBPair {
  id: string;
  localPath: string;
  remotePath: string;
  isActive: number;
  lastSync: string | null;
}

interface SDBFileMeta {
  local_path: string;
  id: string;
  remote_path: string;
  size: number;
  modified: string;
  local_hash: string;
  remote_hash: string;
  last_synced_local: string;
  last_synced_remote: string;
  status: string;
  conflict_type: string | null;
}

interface SDBOperation {
  id: string;
  pair_id: string;
  op_type: 'upload' | 'download';
  status: string;
  file_path: string;
  remote_path: string;
  error_message: string | null;
  retry_count: number;
  created_at: string;
  completed_at: string | null;
}

export class SyncDB {
  private readonly db: Database.Database;

  constructor(databasePath: string) {
    this.db = new Database(databasePath);
    this.db.pragma('journal_mode = WAL');
    // No foreign keys — tests create positions/ops without pairs
    this.db.pragma('foreign_keys = OFF');
    this.initSchema();
  }

  // ── Schema ───────────────────────────────────────────────────

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_pairs (
        id      TEXT PRIMARY KEY,
        local   TEXT NOT NULL,
        remote  TEXT NOT NULL,
        active  INTEGER NOT NULL DEFAULT 1,
        last_sync TEXT
      );

      CREATE TABLE IF NOT EXISTS file_meta (
        local_path           TEXT PRIMARY KEY,
        id                   TEXT    NOT NULL,
        remote_path          TEXT    NOT NULL,
        size                 INTEGER NOT NULL DEFAULT 0,
        modified             TEXT    NOT NULL,
        local_hash           TEXT    NOT NULL,
        remote_hash          TEXT    NOT NULL,
        last_synced_local    TEXT    NOT NULL,
        last_synced_remote   TEXT    NOT NULL,
        status               TEXT    NOT NULL DEFAULT 'synced',
        conflict_type        TEXT
      );

      CREATE TABLE IF NOT EXISTS operations (
        id              TEXT PRIMARY KEY,
        pair_id         TEXT    NOT NULL,
        op_type         TEXT    NOT NULL,
        status          TEXT    NOT NULL DEFAULT 'pending',
        file_path       TEXT    NOT NULL,
        remote_path     TEXT    NOT NULL,
        error_message   TEXT,
        retry_count     INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT    NOT NULL,
        completed_at    TEXT
      );

      CREATE TABLE IF NOT EXISTS sync_state (
        pair_id          TEXT NOT NULL,
        rel_path         TEXT NOT NULL,
        is_dir           INTEGER NOT NULL DEFAULT 0,
        local_size       INTEGER NOT NULL DEFAULT 0,
        local_mtime_ms   REAL NOT NULL DEFAULT 0,
        remote_size      INTEGER NOT NULL DEFAULT 0,
        remote_modified  TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (pair_id, rel_path)
      );

      CREATE TABLE IF NOT EXISTS sync_positions (
        pair_id     TEXT PRIMARY KEY,
        from_token  TEXT,
        from_id     TEXT,
        last_poll   TEXT
      );
    `);
  }

  // ── Helpers ──────────────────────────────────────────────────

  private toSyncPair(row: SDBPair): SyncPairPublic {
    return {
      id: row.id,
      localPath: row.localPath,
      remotePath: row.remotePath,
      isActive: !!row.isActive,
      lastSync: row.lastSync ?? undefined,
    };
  }

  private toFileMeta(row: SDBFileMeta): FileMetaPublic {
    return {
      id: row.id,
      localPath: row.local_path,
      remotePath: row.remote_path,
      size: row.size,
      modified: row.modified,
      localHash: row.local_hash,
      remoteHash: row.remote_hash,
      lastSyncedLocal: row.last_synced_local,
      lastSyncedRemote: row.last_synced_remote,
      status: row.status as FileMetaPublic['status'],
      conflictType: row.conflict_type
        ? (row.conflict_type as FileMetaPublic['conflictType'])
        : undefined,
    };
  }

  private toOp(row: SDBOperation): OpPublic {
    return {
      id: row.id,
      pairId: row.pair_id,
      type: row.op_type,
      status: row.status as OpPublic['status'],
      filePath: row.file_path,
      remotePath: row.remote_path,
      errorMessage: row.error_message ?? undefined,
      retryCount: row.retry_count,
      createdAt: row.created_at,
      completedAt: row.completed_at ?? undefined,
    };
  }

  // ── SyncPair CRUD ────────────────────────────────────────────

  /** Add a new sync pair. Returns its id. */
  addSyncPair(localPath: string, remotePath: string): string {
    const id = crypto.randomUUID();
    this.db
      .prepare(
        'INSERT INTO sync_pairs (id, local, remote, active, last_sync) VALUES (?, ?, ?, 1, NULL)'
      )
      .run(id, localPath, remotePath);
    return id;
  }

  /** Retrieve all sync pairs. */
  getPairs(): SyncPairPublic[] {
    const rows = this.db
      .prepare(
        'SELECT id, local AS localPath, remote AS remotePath, CAST(active AS INTEGER) AS isActive, last_sync AS lastSync FROM sync_pairs'
      )
      .all() as SDBPair[];
    return rows.map(this.toSyncPair.bind(this));
  }

  /** Get a single sync pair by id, or null. */
  getPair(id: string): SyncPairPublic | null {
    const row = this.db
      .prepare(
        'SELECT id, local AS localPath, remote AS remotePath, CAST(active AS INTEGER) AS isActive, last_sync AS lastSync FROM sync_pairs WHERE id = ?'
      )
      .get(id) as SDBPair | undefined;
    return row ? this.toSyncPair(row) : null;
  }

  /** Remove a sync pair (cascades file_meta / operations). */
  removePair(id: string): void {
    this.db.prepare('DELETE FROM sync_pairs WHERE id = ?').run(id);
  }

  /** Toggle whether a sync pair is active. */
  togglePairActive(id: string, active: boolean): void {
    this.db.prepare('UPDATE sync_pairs SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  }

  /** Update the last successful sync timestamp. */
  updateSyncTime(id: string, timestamp: string): void {
    this.db.prepare('UPDATE sync_pairs SET last_sync = ? WHERE id = ?').run(timestamp, id);
  }

  // ── Sync state (what both sides looked like after the last sync) ──

  /** Replace the stored state of one path. */
  setSyncState(pairId: string, st: SyncStateEntry): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO sync_state
         (pair_id, rel_path, is_dir, local_size, local_mtime_ms, remote_size, remote_modified)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        pairId,
        st.relPath,
        st.isDir ? 1 : 0,
        st.localSize,
        st.localMtimeMs,
        st.remoteSize,
        st.remoteModified
      );
  }

  /** Stored state of every path of a pair, keyed by relative path. */
  getSyncStates(pairId: string): Map<string, SyncStateEntry> {
    const rows = this.db
      .prepare(
        `SELECT rel_path AS relPath, is_dir AS isDir, local_size AS localSize,
                local_mtime_ms AS localMtimeMs, remote_size AS remoteSize,
                remote_modified AS remoteModified
         FROM sync_state WHERE pair_id = ?`
      )
      .all(pairId) as Array<Omit<SyncStateEntry, 'isDir'> & { isDir: number }>;
    return new Map(rows.map(r => [r.relPath, { ...r, isDir: !!r.isDir }]));
  }

  removeSyncState(pairId: string, relPath: string): void {
    this.db
      .prepare('DELETE FROM sync_state WHERE pair_id = ? AND rel_path = ?')
      .run(pairId, relPath);
  }

  clearSyncState(pairId: string): void {
    this.db.prepare('DELETE FROM sync_state WHERE pair_id = ?').run(pairId);
  }

  // ── File Metadata ────────────────────────────────────────────

  /** Insert or update file metadata for a local path. */
  upsertFileMeta(meta: SyncFileMeta): void {
    this.db
      .prepare(
        `
        INSERT INTO file_meta
          (local_path, id, remote_path, size, modified, local_hash, remote_hash,
           last_synced_local, last_synced_remote, status, conflict_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(local_path) DO UPDATE SET
          id                 = excluded.id,
          remote_path        = excluded.remote_path,
          size               = excluded.size,
          modified           = excluded.modified,
          local_hash         = excluded.local_hash,
          remote_hash        = excluded.remote_hash,
          last_synced_local  = excluded.last_synced_local,
          last_synced_remote = excluded.last_synced_remote,
          status             = excluded.status,
          conflict_type      = excluded.conflict_type
      `
      )
      .run(
        meta.localPath,
        meta.id,
        meta.remotePath,
        meta.size,
        meta.modified,
        meta.localHash,
        meta.remoteHash,
        meta.lastSyncedLocal,
        meta.lastSyncedRemote,
        meta.status,
        meta.conflictType ?? null
      );
  }

  /** Get file metadata by local path, or null. */
  getFileMeta(localPath: string): FileMetaPublic | null {
    const row = this.db.prepare('SELECT * FROM file_meta WHERE local_path = ?').get(localPath) as
      SDBFileMeta | undefined;
    return row ? this.toFileMeta(row) : null;
  }

  /** List all file metadata rows. */
  listFileMeta(): FileMetaPublic[] {
    const rows = this.db.prepare('SELECT * FROM file_meta').all() as SDBFileMeta[];
    return rows.map(this.toFileMeta.bind(this));
  }

  /** Delete file metadata for a local path. */
  removeFileMeta(localPath: string): void {
    this.db.prepare('DELETE FROM file_meta WHERE local_path = ?').run(localPath);
  }

  /**
   * Detect whether a file has a conflict (localHash ≠ remoteHash).
   * Returns a SyncConflict description or null.
   */
  detectConflict(localPath: string): SyncConflict | null {
    const meta = this.getFileMeta(localPath);
    if (!meta) return null;
    if (meta.localHash !== meta.remoteHash) {
      return {
        type: meta.conflictType ?? 'both-modified',
        localHash: meta.localHash,
        remoteHash: meta.remoteHash,
        localModified: meta.modified,
        remoteModified: meta.modified,
        localPath: meta.localPath,
        remotePath: meta.remotePath,
      };
    }
    return null;
  }

  /** Mark a file as conflicted and record the conflict type. */
  markConflict(localPath: string, conflictType: SyncConflict['type']): FileMetaPublic | null {
    this.db
      .prepare("UPDATE file_meta SET status = 'conflicted', conflict_type = ? WHERE local_path = ?")
      .run(conflictType, localPath);
    return this.getFileMeta(localPath);
  }

  /**
   * Create a "(conflicted copy TIMESTAMP)" sibling of a local file,
   * preserving its content. Used when both the local and remote
   * copies of a file changed since the last sync, so neither change
   * is silently lost.
   *
   * Returns the new file's absolute path.
   */
  createConflictedCopy(localPath: string): string {
    const dir = path.dirname(localPath);
    const ext = path.extname(localPath);
    const base = path.basename(localPath, ext);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const copyPath = path.join(dir, `${base} (conflicted copy ${timestamp})${ext}`);
    copyFileSync(localPath, copyPath);
    return copyPath;
  }

  // ── Operations Queue ─────────────────────────────────────────

  /** Enqueue a new operation. Returns the id. */
  enqueueOp(op: SyncDBOperation): string {
    this.db
      .prepare(
        `
        INSERT INTO operations
          (id, pair_id, op_type, status, file_path, remote_path,
           error_message, retry_count, created_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        op.id,
        op.pairId,
        op.type,
        op.status,
        op.filePath,
        op.remotePath,
        op.errorMessage ?? null,
        op.retryCount ?? 0,
        op.createdAt,
        op.completedAt ?? null
      );
    return op.id;
  }

  /** Get all pending operations, optionally filtered by type. */
  getPendingOps(type?: 'upload' | 'download'): OpPublic[] {
    const rows = type
      ? this.db
          .prepare('SELECT * FROM operations WHERE status = ? AND op_type = ? ORDER BY created_at')
          .all('pending', type)
      : this.db
          .prepare('SELECT * FROM operations WHERE status = ? ORDER BY created_at')
          .all('pending');
    return (rows as SDBOperation[]).map(this.toOp.bind(this));
  }

  /** Mark an operation as completed. */
  completeOp(opId: string): void {
    this.db
      .prepare("UPDATE operations SET status = 'completed', completed_at = ? WHERE id = ?")
      .run(new Date().toISOString(), opId);
  }

  /** Mark an operation as failed with an error message. */
  failOp(opId: string, errorMessage: string): void {
    this.db
      .prepare("UPDATE operations SET status = 'failed', error_message = ? WHERE id = ?")
      .run(errorMessage, opId);
  }

  /** Get all failed operations (for retry/review). */
  getFailedOps(): OpPublic[] {
    const rows = this.db
      .prepare("SELECT * FROM operations WHERE status = 'failed' ORDER BY created_at")
      .all() as SDBOperation[];
    return rows.map(this.toOp.bind(this));
  }

  // ── Sync Position (delta token) ──────────────────────────────

  /** Save the last-known delta position for a sync pair. */
  saveSyncPosition(pairId: string, position: SyncPosition): void {
    this.db
      .prepare(
        `
        INSERT INTO sync_positions (pair_id, from_token, from_id, last_poll)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(pair_id) DO UPDATE SET
          from_token = excluded.from_token,
          from_id    = excluded.from_id,
          last_poll  = excluded.last_poll
      `
      )
      .run(pairId, position.fromToken, position.fromId, position.lastPoll);
  }

  /** Get the delta position for a pair, or null. */
  getSyncPosition(pairId: string): SyncPosition | null {
    const row = this.db
      .prepare('SELECT from_token, from_id, last_poll FROM sync_positions WHERE pair_id = ?')
      .get(pairId) as
      { from_token: string | null; from_id: string | null; last_poll: string | null } | undefined;
    if (!row) return null;
    return {
      fromToken: row.from_token,
      fromId: row.from_id,
      lastPoll: row.last_poll,
    };
  }

  // ── Cleanup ──────────────────────────────────────────────────

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }
}
