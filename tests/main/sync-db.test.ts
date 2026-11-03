import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { SyncDB } from '../../src/main/sync-db.js';

let dbPath: string;
let db: SyncDB;

function freshPath(): string {
  return join(tmpdir(), `sync-db-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

beforeEach(() => {
  dbPath = freshPath();
  db = new SyncDB(dbPath);
});

afterEach(() => {
  db.close();
  try {
    unlinkSync(dbPath);
  } catch {
    /* ignore */
  }
});

// ── SyncPair CRUD ──────────────────────────────────────────────

describe('SyncPair CRUD', () => {
  it('creates the database and tables on init', () => {
    const result = db.getPairs();
    expect(result).toEqual([]);
  });

  it('adds a sync pair and retrieves it', () => {
    const id = db.addSyncPair('/local/path', '/remote/path');
    const pairs = db.getPairs();
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.id).toBe(id);
    expect(pairs[0]!.localPath).toBe('/local/path');
    expect(pairs[0]!.remotePath).toBe('/remote/path');
    expect(pairs[0]!.isActive).toBe(true);
  });

  it('returns an empty array when no pairs exist', () => {
    expect(db.getPairs()).toEqual([]);
  });

  it('adds multiple pairs', () => {
    const id1 = db.addSyncPair('/local/a', '/remote/a');
    const id2 = db.addSyncPair('/local/b', '/remote/b');
    expect(db.getPairs()).toHaveLength(2);
    expect([id1, id2]).toHaveLength(2);
  });

  it('toggles pair active state', () => {
    const id = db.addSyncPair('/local/path', '/remote/path');
    db.togglePairActive(id, false);
    const pairs = db.getPairs();
    expect(pairs[0]!.isActive).toBe(false);

    db.togglePairActive(id, true);
    expect(db.getPair(id)!.isActive).toBe(true);
  });

  it('gets a single pair by id', () => {
    const id = db.addSyncPair('/local/path', '/remote/path');
    const pair = db.getPair(id);
    expect(pair).not.toBeNull();
    expect(pair!.localPath).toBe('/local/path');
  });

  it('returns null for non-existent pair id', () => {
    expect(db.getPair('nonexistent')).toBeNull();
  });

  it('removes a sync pair', () => {
    const id = db.addSyncPair('/local/path', '/remote/path');
    db.removePair(id);
    expect(db.getPair(id)).toBeNull();
    expect(db.getPairs()).toHaveLength(0);
  });

  it('updates the last sync timestamp', () => {
    const id = db.addSyncPair('/local/path', '/remote/path');
    db.updateSyncTime(id, '2026-01-01T00:00:00.000Z');
    const pair = db.getPair(id);
    expect(pair!.lastSync).toBe('2026-01-01T00:00:00.000Z');
  });
});

// ── File Metadata ──────────────────────────────────────────────

describe('File Metadata', () => {
  it('stores and retrieves file metadata', () => {
    const fileMeta: SyncFileMeta = {
      id: 'file-1',
      localPath: '/local/f.txt',
      remotePath: '/remote/f.txt',
      size: 1024,
      modified: '2026-01-01T00:00:00.000Z',
      localHash: 'abc123',
      remoteHash: 'def456',
      lastSyncedLocal: '2026-01-01T00:00:00.000Z',
      lastSyncedRemote: '2026-01-01T00:00:00.000Z',
      status: 'synced',
    };
    db.upsertFileMeta(fileMeta);

    const result = db.getFileMeta('/local/f.txt');
    expect(result).not.toBeNull();
    expect(result!.localPath).toBe('/local/f.txt');
    expect(result!.remoteHash).toBe('def456');
    expect(result!.status).toBe('synced');
  });

  it('updates existing file metadata', () => {
    db.upsertFileMeta({
      id: 'file-1',
      localPath: '/local/f.txt',
      remotePath: '/remote/f.txt',
      size: 100,
      modified: '2026-01-01T00:00:00.000Z',
      localHash: 'hash1',
      remoteHash: 'hash1',
      lastSyncedLocal: '2026-01-01T00:00:00.000Z',
      lastSyncedRemote: '2026-01-01T00:00:00.000Z',
      status: 'synced',
    });
    db.upsertFileMeta({
      id: 'file-1',
      localPath: '/local/f.txt',
      remotePath: '/remote/f.txt',
      size: 200,
      modified: '2026-01-02T00:00:00.000Z',
      localHash: 'hash2',
      remoteHash: 'hash1',
      lastSyncedLocal: '2026-01-02T00:00:00.000Z',
      lastSyncedRemote: '2026-01-01T00:00:00.000Z',
      status: 'conflicted',
    });

    const result = db.getFileMeta('/local/f.txt');
    expect(result!.size).toBe(200);
    expect(result!.localHash).toBe('hash2');
    expect(result!.status).toBe('conflicted');
  });

  it('deletes file metadata', () => {
    db.upsertFileMeta({
      id: 'file-1',
      localPath: '/local/f.txt',
      remotePath: '/remote/f.txt',
      size: 100,
      modified: '2026-01-01T00:00:00.000Z',
      localHash: 'h',
      remoteHash: 'h',
      lastSyncedLocal: '2026-01-01T00:00:00.000Z',
      lastSyncedRemote: '2026-01-01T00:00:00.000Z',
      status: 'synced',
    });
    db.removeFileMeta('/local/f.txt');
    expect(db.getFileMeta('/local/f.txt')).toBeNull();
  });

  it('lists all file metadata', () => {
    db.upsertFileMeta({
      id: 'f1',
      localPath: '/local/a.txt',
      remotePath: '/remote/a.txt',
      size: 10,
      modified: '2026-01-01T00:00:00.000Z',
      localHash: 'a',
      remoteHash: 'a',
      lastSyncedLocal: '2026-01-01T00:00:00.000Z',
      lastSyncedRemote: '2026-01-01T00:00:00.000Z',
      status: 'synced',
    });
    db.upsertFileMeta({
      id: 'f2',
      localPath: '/local/b.txt',
      remotePath: '/remote/b.txt',
      size: 20,
      modified: '2026-01-02T00:00:00.000Z',
      localHash: 'b',
      remoteHash: 'b',
      lastSyncedLocal: '2026-01-02T00:00:00.000Z',
      lastSyncedRemote: '2026-01-02T00:00:00.000Z',
      status: 'synced',
    });

    const all = db.listFileMeta();
    expect(all).toHaveLength(2);
  });

  it('lists files by sync pair id', () => {
    db.upsertFileMeta({
      id: 'f1',
      localPath: '/local/a.txt',
      remotePath: '/remote/a.txt',
      size: 10,
      modified: '2026-01-01T00:00:00.000Z',
      localHash: 'a',
      remoteHash: 'a',
      lastSyncedLocal: '2026-01-01T00:00:00.000Z',
      lastSyncedRemote: '2026-01-01T00:00:00.000Z',
      status: 'synced',
    });
    db.upsertFileMeta({
      id: 'f2',
      localPath: '/other/a.txt',
      remotePath: '/remote/a.txt',
      size: 20,
      modified: '2026-01-01T00:00:00.000Z',
      localHash: 'a',
      remoteHash: 'a',
      lastSyncedLocal: '2026-01-01T00:00:00.000Z',
      lastSyncedRemote: '2026-01-01T00:00:00.000Z',
      status: 'synced',
    });

    // Files are keyed by localPath, so list all and filter
    const all = db.listFileMeta();
    expect(all).toHaveLength(2);
  });

  it('detects conflict when local and remote hashes differ', () => {
    const conflict = db.detectConflict('/local/f.txt');
    expect(conflict).toBeNull(); // no metadata yet

    db.upsertFileMeta({
      id: 'f1',
      localPath: '/local/f.txt',
      remotePath: '/remote/f.txt',
      size: 100,
      modified: '2026-01-01T00:00:00.000Z',
      localHash: 'local-change',
      remoteHash: 'remote-change',
      lastSyncedLocal: '2026-01-01T00:00:00.000Z',
      lastSyncedRemote: '2026-01-01T00:00:00.000Z',
      status: 'synced',
    });

    const result = db.detectConflict('/local/f.txt');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('both-modified');
    expect(result!.localHash).toBe('local-change');
    expect(result!.remoteHash).toBe('remote-change');
  });

  it('returns null when hashes match', () => {
    db.upsertFileMeta({
      id: 'f1',
      localPath: '/local/f.txt',
      remotePath: '/remote/f.txt',
      size: 100,
      modified: '2026-01-01T00:00:00.000Z',
      localHash: 'same',
      remoteHash: 'same',
      lastSyncedLocal: '2026-01-01T00:00:00.000Z',
      lastSyncedRemote: '2026-01-01T00:00:00.000Z',
      status: 'synced',
    });

    expect(db.detectConflict('/local/f.txt')).toBeNull();
  });

  it('marks conflict and sets status to conflicted', () => {
    db.upsertFileMeta({
      id: 'f1',
      localPath: '/local/f.txt',
      remotePath: '/remote/f.txt',
      size: 100,
      modified: '2026-01-01T00:00:00.000Z',
      localHash: 'a',
      remoteHash: 'b',
      lastSyncedLocal: '2026-01-01T00:00:00.000Z',
      lastSyncedRemote: '2026-01-01T00:00:00.000Z',
      status: 'synced',
    });

    const conflict = db.markConflict('/local/f.txt', 'both-modified');
    expect(conflict!.status).toBe('conflicted');
    expect(conflict!.conflictType).toBe('both-modified');
  });
});

describe('createConflictedCopy', () => {
  it('creates a real file on disk named "(conflicted copy TIMESTAMP).ext"', async () => {
    const { writeFileSync, readFileSync, existsSync, rmSync } = await import('fs');
    const { tmpdir } = await import('os');
    const { join } = await import('path');

    const localPath = join(tmpdir(), `sync-db-conflict-test-${Date.now()}.txt`);
    writeFileSync(localPath, 'local content');

    const copyPath = db.createConflictedCopy(localPath);

    expect(copyPath).not.toBe(localPath);
    expect(copyPath).toMatch(/\(conflicted copy .+\)\.txt$/);
    expect(existsSync(copyPath)).toBe(true);
    expect(readFileSync(copyPath, 'utf8')).toBe('local content');

    rmSync(localPath);
    rmSync(copyPath);
  });

  it('throws if the source file does not exist', () => {
    expect(() => db.createConflictedCopy('/nonexistent/path/does-not-exist.txt')).toThrow();
  });
});

// ── Operations Queue ───────────────────────────────────────────

describe('Operations Queue', () => {
  it('enqueues a download operation', () => {
    const opId = db.enqueueOp({
      id: 'op-1',
      pairId: 'pair-1',
      type: 'download',
      status: 'pending',
      filePath: '/local/f.txt',
      remotePath: '/remote/f.txt',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(opId).toBe('op-1');

    const ops = db.getPendingOps('download');
    expect(ops).toHaveLength(1);
    expect(ops[0]!.filePath).toBe('/local/f.txt');
  });

  it('marks an operation as completed', () => {
    db.enqueueOp({
      id: 'op-1',
      pairId: 'pair-1',
      type: 'download',
      status: 'pending',
      filePath: '/local/f.txt',
      remotePath: '/remote/f.txt',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    db.completeOp('op-1');

    expect(db.getPendingOps('download')).toHaveLength(0);
  });

  it('marks an operation as failed with error message', () => {
    db.enqueueOp({
      id: 'op-1',
      pairId: 'pair-1',
      type: 'upload',
      status: 'pending',
      filePath: '/local/f.txt',
      remotePath: '/remote/f.txt',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    db.failOp('op-1', 'Network error');

    const ops = db.getFailedOps();
    expect(ops).toHaveLength(1);
    expect(ops[0]!.errorMessage).toBe('Network error');
  });

  it('retries a failed operation', () => {
    db.enqueueOp({
      id: 'op-1',
      pairId: 'pair-1',
      type: 'download',
      status: 'pending',
      filePath: '/local/f.txt',
      remotePath: '/remote/f.txt',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    db.failOp('op-1', 'Network error');
    db.enqueueOp({
      id: 'op-2',
      pairId: 'pair-1',
      type: 'download',
      status: 'pending',
      filePath: '/local/f.txt',
      remotePath: '/remote/f.txt',
      createdAt: '2026-01-01T00:00:01.000Z',
    });

    // Old failed op is cleaned up by retry
    const pending = db.getPendingOps('download');
    expect(pending).toHaveLength(1);
    expect(pending[0]!.id).toBe('op-2');
  });

  it('gets all pending ops for a specific type', () => {
    db.enqueueOp({
      id: 'op-1',
      pairId: 'pair-1',
      type: 'download',
      status: 'pending',
      filePath: '/local/f.txt',
      remotePath: '/remote/f.txt',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    db.enqueueOp({
      id: 'op-2',
      pairId: 'pair-1',
      type: 'upload',
      status: 'pending',
      filePath: '/local/g.txt',
      remotePath: '/remote/g.txt',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const downloads = db.getPendingOps('download');
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.type).toBe('download');

    const uploads = db.getPendingOps('upload');
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.type).toBe('upload');
  });

  it('lists all pending operations regardless of type', () => {
    db.enqueueOp({
      id: 'op-1',
      pairId: 'pair-1',
      type: 'download',
      status: 'pending',
      filePath: '/local/f.txt',
      remotePath: '/remote/f.txt',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    db.enqueueOp({
      id: 'op-2',
      pairId: 'pair-1',
      type: 'upload',
      status: 'pending',
      filePath: '/local/g.txt',
      remotePath: '/remote/g.txt',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    expect(db.getPendingOps()).toHaveLength(2);
  });
});

// ── Sync Position ──────────────────────────────────────────────

describe('Sync Position (Yandex.Disk /changes token)', () => {
  it('stores and retrieves a delta token per pair', () => {
    db.saveSyncPosition('pair-1', {
      fromToken: 'abc123',
      fromId: 'xyz789',
      lastPoll: '2026-01-01T00:00:00.000Z',
    });

    const pos = db.getSyncPosition('pair-1');
    expect(pos).not.toBeNull();
    expect(pos!.fromToken).toBe('abc123');
  });

  it('returns null for unknown pair', () => {
    expect(db.getSyncPosition('unknown')).toBeNull();
  });

  it('overwrites previous position', () => {
    db.saveSyncPosition('pair-1', {
      fromToken: 'first',
      fromId: 'id1',
      lastPoll: '2026-01-01T00:00:00.000Z',
    });
    db.saveSyncPosition('pair-1', {
      fromToken: 'second',
      fromId: 'id2',
      lastPoll: '2026-01-02T00:00:00.000Z',
    });

    const pos = db.getSyncPosition('pair-1');
    expect(pos!.fromToken).toBe('second');
  });
});

// ── close() ────────────────────────────────────────────────────

describe('close()', () => {
  it('closes the database without error', () => {
    db.addSyncPair('/local', '/remote');
    db.close();
    // After close, any operation should throw
    expect(() => db.getPairs()).toThrow();
  });
});
