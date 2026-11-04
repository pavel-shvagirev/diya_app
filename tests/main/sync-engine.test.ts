import {
  mkdirSync,
  symlinkSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
  existsSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { createHash } from 'crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FsWatcher } from '../../src/main/fs-watcher.js';
import { logger } from '../../src/main/logger.js';
import { SyncDB } from '../../src/main/sync-db.js';
import { SyncEngine, type RemoteEntry, type RemoteStorage } from '../../src/main/sync-engine.js';

/** In-memory Yandex.Disk stand-in. */
class FakeRemote implements RemoteStorage {
  files = new Map<string, { data: Buffer; modified: string }>();
  dirs = new Set<string>(['/']);
  clock = 0;
  failList = false;
  /** Number of stat() calls that answer 404 (Disk still processing an upload). */
  statMisses = 0;
  /** list()/stat() omit md5, as for files the Disk has not finished hashing. */
  hideMd5 = false;
  removed: string[] = [];
  /** What the engine told download() to verify against, per remote path. */
  expectations = new Map<string, { size?: number; md5?: string } | undefined>();
  /** Remote paths whose download fails verification, as the real transfer layer would. */
  corrupt = new Set<string>();
  /** Every download() call, and the error (if any) the Disk answers with. */
  downloads = 0;
  downloadError: Error | null = null;
  /** Folders passed to list(), folders passed to mkdir(), and flat-list requests. */
  listCalls: string[] = [];
  mkdirCalls: string[] = [];
  flatCalls = 0;
  /** The flat list fails with this. */
  failFlat: Error | null = null;
  /** Files that exist but are missing from the flat list (as after a paging race). */
  hiddenFromFlat = new Set<string>();

  private stamp(): string {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, this.clock++)).toISOString();
  }
  put(path: string, text: string): void {
    this.mkdirs(dirname(path));
    this.files.set(path, { data: Buffer.from(text), modified: this.stamp() });
  }
  private mkdirs(dir: string): void {
    for (let d = dir; d !== '/' && !this.dirs.has(d); d = dirname(d)) this.dirs.add(d);
  }
  private entry(path: string): RemoteEntry {
    const f = this.files.get(path);
    const name = path.split('/').pop() as string;
    if (!f) return { path, name, isDir: true, size: 0, modified: '' };
    return {
      path,
      name,
      isDir: false,
      size: f.data.length,
      modified: f.modified,
      md5: this.hideMd5 ? undefined : createHash('md5').update(f.data).digest('hex'),
    };
  }
  async list(dir: string, _signal?: AbortSignal): Promise<RemoteEntry[]> {
    this.listCalls.push(dir);
    if (this.failList) throw new Error('503: down');
    if (!this.dirs.has(dir)) throw new Error('404: not found');
    const under = (p: string): boolean => dirname(p) === dir && p !== '/';
    return [...this.dirs, ...this.files.keys()].filter(under).map(p => this.entry(p));
  }
  async listAllFiles(_signal?: AbortSignal): Promise<RemoteEntry[]> {
    this.flatCalls++;
    if (this.failFlat) throw this.failFlat;
    return [...this.files.keys()].filter(p => !this.hiddenFromFlat.has(p)).map(p => this.entry(p));
  }
  async stat(path: string, _signal?: AbortSignal): Promise<RemoteEntry> {
    if (this.statMisses-- > 0) throw new Error('404: not found yet');
    if (!this.files.has(path) && !this.dirs.has(path)) throw new Error('404: not found');
    return this.entry(path);
  }
  async mkdir(path: string, _signal?: AbortSignal): Promise<void> {
    this.mkdirCalls.push(path);
    this.mkdirs(path);
  }
  async upload(
    local: string,
    remote: string,
    _o: boolean,
    onProgress: (d: number, t: number) => void,
    _signal?: AbortSignal
  ): Promise<void> {
    const data = readFileSync(local);
    this.put(remote, data.toString());
    onProgress(data.length, data.length);
  }
  async download(
    remote: string,
    local: string,
    onProgress: (d: number, t: number) => void,
    mtime: Date,
    expected?: { size?: number; md5?: string },
    _signal?: AbortSignal
  ): Promise<void> {
    const f = this.files.get(remote);
    if (!f) throw new Error('404');
    this.downloads++;
    if (this.downloadError) throw this.downloadError;
    this.expectations.set(remote, expected);
    if (this.corrupt.has(remote)) throw new Error(`Download of ${remote} failed the md5 check`);
    mkdirSync(dirname(local), { recursive: true });
    writeFileSync(local, f.data);
    utimesSync(local, mtime, mtime);
    onProgress(f.data.length, f.data.length);
  }
  async remove(path: string, _signal?: AbortSignal): Promise<void> {
    this.files.delete(path);
    this.removed.push(path);
  }
}

describe('SyncEngine', () => {
  let tmp: string;
  let localDir: string;
  let db: SyncDB;
  let remote: FakeRemote;
  let engine: SyncEngine;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'syncengine-'));
    localDir = join(tmp, 'local');
    mkdirSync(localDir);
    db = new SyncDB(join(tmp, 'sync.db'));
    remote = new FakeRemote();
    remote.dirs.add('/Sync');
    const id = db.addSyncPair(localDir, '/Sync');
    engine = new SyncEngine(remote, db, {
      watch: false,
      settleMs: 0,
      minGapMs: 0,
      now: () => new Date(2026, 5, 7, 8, 9),
    });
    engine.configure({ id, localPath: localDir, remotePath: '/Sync' });
  });
  afterEach(() => {
    engine.stop();
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  const local = (rel: string): string => join(localDir, rel);
  const write = (rel: string, text: string, mtimeSec?: number): void => {
    mkdirSync(dirname(local(rel)), { recursive: true });
    writeFileSync(local(rel), text);
    if (mtimeSec) utimesSync(local(rel), mtimeSec, mtimeSec);
  };

  it('uploads new local files and downloads new remote files, then settles', async () => {
    write('up.txt', 'local');
    remote.put('/Sync/down.txt', 'remote');
    await engine.syncNow();
    expect(remote.files.get('/Sync/up.txt')?.data.toString()).toBe('local');
    expect(readFileSync(local('down.txt'), 'utf8')).toBe('remote');
    const p = engine.getProgress();
    expect(p).toMatchObject({ phase: 'paused', totalFiles: 2, doneFiles: 2, error: null });
    expect(p.lastSync).not.toBeNull();

    remote.removed.length = 0;
    await engine.syncNow();
    expect(engine.getProgress().totalFiles).toBe(0);
  });

  it('syncs nested folders in both directions, including empty ones', async () => {
    write('a/b/c.txt', 'deep');
    mkdirSync(local('emptyLocal'));
    remote.dirs.add('/Sync/emptyRemote');
    await engine.syncNow();
    expect(remote.files.has('/Sync/a/b/c.txt')).toBe(true);
    expect(remote.dirs.has('/Sync/emptyLocal')).toBe(true);
    expect(existsSync(local('emptyRemote'))).toBe(true);
  });

  it('propagates a local edit as an upload and a remote edit as a download', async () => {
    write('x.txt', 'v1', 1000);
    write('y.txt', 'v1', 1000);
    await engine.syncNow();

    write('x.txt', 'v2-local', 2000);
    remote.put('/Sync/y.txt', 'v2-remote');
    await engine.syncNow();
    expect(remote.files.get('/Sync/x.txt')?.data.toString()).toBe('v2-local');
    expect(readFileSync(local('y.txt'), 'utf8')).toBe('v2-remote');
  });

  it('keeps both versions when both sides changed', async () => {
    write('c.txt', 'base', 1000);
    await engine.syncNow();

    write('c.txt', 'LOCAL', 2000);
    remote.put('/Sync/c.txt', 'REMOTE');
    await engine.syncNow();

    expect(readFileSync(local('c.txt'), 'utf8')).toBe('REMOTE');
    const copy = readdirSync(localDir).find(n => n.includes('conflict copy'));
    expect(copy).toBe('c (conflict copy 2026-06-07 08-09).txt');
    expect(readFileSync(local(copy as string), 'utf8')).toBe('LOCAL');
    expect(engine.getProgress().conflicts).toBe(1);

    await engine.syncNow(); // the copy is then uploaded as a normal new file
    expect(remote.files.get(`/Sync/${copy}`)?.data.toString()).toBe('LOCAL');
  });

  it('propagates deletions both ways', async () => {
    write('gone-local.txt', 'a', 1000);
    write('gone-remote.txt', 'b', 1000);
    await engine.syncNow();

    rmSync(local('gone-local.txt'));
    remote.files.delete('/Sync/gone-remote.txt');
    await engine.syncNow();

    expect(remote.removed).toContain('/Sync/gone-local.txt');
    expect(existsSync(local('gone-remote.txt'))).toBe(false);
  });

  it('a file deleted on one side but edited on the other is restored, not deleted', async () => {
    write('keep.txt', 'v1', 1000);
    await engine.syncNow();
    rmSync(local('keep.txt'));
    remote.put('/Sync/keep.txt', 'edited remotely');
    await engine.syncNow();
    expect(readFileSync(local('keep.txt'), 'utf8')).toBe('edited remotely');
  });

  describe('downloads are verified against the Disk listing', () => {
    it('asks for the size and md5 the Disk reported', async () => {
      remote.put('/Sync/a.txt', 'hello');
      await engine.syncNow();
      expect(remote.expectations.get('/Sync/a.txt')).toEqual({
        size: 5,
        md5: createHash('md5').update('hello').digest('hex'),
      });
    });

    it('a download that fails verification is a failure: no file, nothing recorded, retried later', async () => {
      remote.put('/Sync/bad.txt', 'hello');
      remote.corrupt.add('/Sync/bad.txt');
      await engine.syncNow();
      expect(existsSync(local('bad.txt'))).toBe(false);
      expect(engine.getProgress().failures.join()).toContain('md5');
      remote.corrupt.clear();
      await engine.syncNow();
      expect(readFileSync(local('bad.txt'), 'utf8')).toBe('hello');
    });
  });

  describe('symbolic links are never followed', () => {
    it('a synced file replaced by a link is left alone on the Disk, not deleted', async () => {
      write('doc.txt', 'v1', 1000);
      await engine.syncNow();
      rmSync(local('doc.txt'));
      write('../elsewhere.txt', 'outside', 1000);
      symlinkSync(join(tmp, 'elsewhere.txt'), local('doc.txt'));
      await engine.syncNow();
      expect(remote.removed).toEqual([]);
      expect(remote.files.has('/Sync/doc.txt')).toBe(true);
    });

    it('a synced folder replaced by a link keeps its files on the Disk', async () => {
      write('Photos/a.jpg', 'a', 1000);
      write('Photos/b.jpg', 'b', 1000);
      await engine.syncNow();
      rmSync(local('Photos'), { recursive: true });
      mkdirSync(join(tmp, 'outside'));
      symlinkSync(join(tmp, 'outside'), local('Photos'));
      await engine.syncNow();
      expect(remote.removed).toEqual([]);
      expect([...remote.files.keys()]).toContain('/Sync/Photos/a.jpg');
    });

    it('a link is never uploaded and never followed into', async () => {
      mkdirSync(join(tmp, 'outside'));
      writeFileSync(join(tmp, 'outside', 'secret.txt'), 'private');
      symlinkSync(join(tmp, 'outside'), local('escape'));
      symlinkSync(localDir, local('loop'));
      write('ok.txt', 'ok', 1000);
      await engine.syncNow();
      expect([...remote.files.keys()]).toEqual(['/Sync/ok.txt']);
    });
  });

  it('first sync into two already-identical folders transfers nothing', async () => {
    write('same.txt', 'identical');
    remote.put('/Sync/same.txt', 'identical');
    await engine.syncNow();
    expect(engine.getProgress().totalFiles).toBe(0);
    expect(readdirSync(localDir)).toEqual(['same.txt']);
  });

  it('first sync with different content on both sides is a conflict, nothing is lost', async () => {
    write('diff.txt', 'mine');
    remote.put('/Sync/diff.txt', 'theirs');
    await engine.syncNow();
    expect(readFileSync(local('diff.txt'), 'utf8')).toBe('theirs');
    expect(readdirSync(localDir).some(n => n.includes('conflict'))).toBe(true);
  });

  it('aborts without touching local files when the remote listing fails', async () => {
    write('safe.txt', 's', 1000);
    await engine.syncNow();
    remote.failList = true;
    await engine.syncNow();
    expect(engine.getProgress()).toMatchObject({ phase: 'error' });
    expect(engine.getProgress().error).toContain('503');
    expect(existsSync(local('safe.txt'))).toBe(true);
  });

  it('refuses a mass deletion', async () => {
    for (let i = 0; i < 12; i++) write(`f${i}.txt`, 'x', 1000);
    await engine.syncNow();
    for (const p of [...remote.files.keys()]) remote.files.delete(p); // remote suddenly "empty"
    await engine.syncNow();
    expect(engine.getProgress().error).toContain('Refusing to delete');
    expect(readdirSync(localDir)).toHaveLength(12);
  });

  describe('deleting everything locally (user report: "Refusing to delete 15 of 15")', () => {
    const seed = async (n = 15): Promise<void> => {
      for (let i = 0; i < n; i++) write(`f${i}.txt`, 'x', 1000);
      await engine.syncNow();
      expect(remote.files.size).toBe(n);
    };

    it('a deliberate bulk delete in Finder is carried to the Disk (trash), not refused', async () => {
      await seed();
      for (const n of readdirSync(localDir)) rmSync(local(n));
      await engine.syncNow();
      expect(engine.getProgress().error).toBeNull();
      expect(remote.files.size).toBe(0);
      expect(remote.removed).toHaveLength(15);
      expect(engine.getProgress().failures).toEqual([]);
    });

    it('but a vanished sync folder (unmounted / renamed) is still refused', async () => {
      await seed();
      rmSync(localDir, { recursive: true });
      await engine.syncNow();
      expect(engine.getProgress().error).toContain('Refusing to delete');
      expect(remote.files.size).toBe(15);
    });

    it('and the Disk listing suddenly empty is still refused', async () => {
      await seed();
      remote.files.clear();
      await engine.syncNow();
      expect(engine.getProgress().error).toContain('Refusing to delete');
      expect(readdirSync(localDir)).toHaveLength(15);
    });
  });

  it('reports per-file failures without stopping the rest', async () => {
    write('ok.txt', 'ok');
    write('bad.txt', 'bad');
    const realUpload = remote.upload.bind(remote);
    remote.upload = async (l, r, o, cb) => {
      if (r.endsWith('bad.txt')) throw new Error('507: no space');
      return realUpload(l, r, o, cb);
    };
    await engine.syncNow();
    expect(remote.files.has('/Sync/ok.txt')).toBe(true);
    const p = engine.getProgress();
    expect(p.failures).toEqual(['bad.txt: 507: no space']);
    expect(p.doneFiles).toBe(2);
  });

  it('ignores dotfiles and .part files', async () => {
    write('.hidden', 'h');
    write('half.part', 'p');
    write('real.txt', 'r');
    await engine.syncNow();
    expect([...remote.files.keys()]).toEqual(['/Sync/real.txt']);
  });

  it('emits progress with byte totals while running', async () => {
    write('a.bin', '12345');
    write('b.bin', '1234567890');
    const seen: number[] = [];
    engine.onProgress(p => {
      if (p.phase === 'syncing') seen.push(p.totalBytes);
    });
    await engine.syncNow();
    expect(seen.every(t => t === 15)).toBe(true);
    expect(engine.getProgress().doneBytes).toBe(15);
  });

  it('creates the remote root when it does not exist yet', async () => {
    remote.dirs.delete('/Sync');
    write('a.txt', 'a');
    await engine.syncNow();
    expect(remote.files.has('/Sync/a.txt')).toBe(true);
  });

  it('an upload the Disk does not show yet is not a failure; the real timestamp is adopted later', async () => {
    write('slow.txt', 'x');
    remote.statMisses = 1;
    await engine.syncNow();
    expect(engine.getProgress().failures).toEqual([]);
    expect(remote.files.has('/Sync/slow.txt')).toBe(true);
    await engine.syncNow(); // lists it now: adopted, nothing to transfer
    expect(engine.getProgress().totalFiles).toBe(0);
    await engine.syncNow();
    expect(engine.getProgress().totalFiles).toBe(0);
  });

  describe('regression: duplicate conflict copies (big file uploaded with dd)', () => {
    const copies = (): string[] => readdirSync(localDir).filter(n => n.includes('conflict'));

    it('a file whose upload is not yet visible/hashed on the Disk never turns into a conflict', async () => {
      write('asdf.bin', 'x'.repeat(5000));
      remote.statMisses = 100; // the Disk keeps answering 404 right after the upload
      remote.hideMd5 = true; // and has no md5 for it yet
      for (let i = 0; i < 4; i++) await engine.syncNow();
      expect(copies()).toEqual([]);
      expect(readdirSync(localDir)).toEqual(['asdf.bin']);
      expect([...remote.files.keys()]).toEqual(['/Sync/asdf.bin']);
      expect(engine.getProgress().failures).toEqual([]);
    });

    it('same size on both sides but the Disk has no md5 yet: wait, do not conflict', async () => {
      write('big.bin', 'same-size');
      remote.put('/Sync/big.bin', 'same-size');
      remote.hideMd5 = true;
      await engine.syncNow();
      expect(copies()).toEqual([]);
      expect(engine.getProgress().failures).toEqual([]);
      remote.hideMd5 = false; // hashing finished
      await engine.syncNow();
      expect(copies()).toEqual([]);
      expect(engine.getProgress().totalFiles).toBe(0);
    });

    it('a conflict on an existing conflict copy keeps one marker and a bounded name', async () => {
      const name = 'asdf (conflict copy 2026-11-03 13-36).bin';
      write(name, 'base', 1000);
      await engine.syncNow();
      write(name, 'LOCAL', 2000);
      remote.put(`/Sync/${name}`, 'REMOTE');
      await engine.syncNow();
      for (const n of copies()) {
        expect(n.match(/conflict copy/g)).toHaveLength(1);
        expect(n.length).toBeLessThan(80);
      }
    });

    it('the label follows the interface language, and a copy made in another language is not extended', async () => {
      const ruName = 'doc (конфликтная копия 2026-11-03 13-36).txt';
      write(ruName, 'base', 1000);
      await engine.syncNow();
      write(ruName, 'LOCAL', 2000);
      remote.put(`/Sync/${ruName}`, 'REMOTE');
      await engine.syncNow();
      for (const n of copies()) {
        expect(n.match(/conflict copy|конфликтная копия/g)).toHaveLength(1);
      }
      expect(copies().length).toBeGreaterThan(0);
    });

    it('uses the label it is given for new conflict copies', async () => {
      engine.stop();
      const ru = new SyncEngine(remote, db, {
        watch: false,
        settleMs: 0,
        minGapMs: 0,
        now: () => new Date(2026, 5, 7, 8, 9),
        conflictLabel: () => 'конфликтная копия',
      });
      ru.configure({ id: db.getPairs()[0]!.id, localPath: localDir, remotePath: '/Sync' });
      write('r.txt', 'base', 1000);
      await ru.syncNow();
      write('r.txt', 'LOCAL', 2000);
      remote.put('/Sync/r.txt', 'REMOTE');
      await ru.syncNow();
      expect(readdirSync(localDir)).toContain('r (конфликтная копия 2026-06-07 08-09).txt');
      ru.stop();
    });

    it('never recurses: repeated conflicts on the same file do not grow the name', async () => {
      write('c.txt', 'base', 1000);
      await engine.syncNow();
      for (let i = 0; i < 5; i++) {
        write('c.txt', `L${i}`, 2000 + i);
        remote.put('/Sync/c.txt', `R${i}`);
        await engine.syncNow();
        await engine.syncNow();
      }
      for (const n of readdirSync(localDir)) expect(n.length).toBeLessThan(80);
    });

    it('a file still being written is left alone until it settles', async () => {
      const slow = new SyncEngine(remote, db, { watch: false, settleMs: 60_000, minGapMs: 0 });
      slow.configure({ id: db.getPairs()[0]!.id, localPath: localDir, remotePath: '/Sync' });
      write('growing.bin', 'partial');
      await slow.syncNow();
      expect(remote.files.size).toBe(0);
      expect(slow.getProgress().failures).toEqual([]);
    });

    it('a file edited while it is being uploaded is re-uploaded, not conflicted', async () => {
      write('live.txt', 'v1', 1000);
      const realUpload = remote.upload.bind(remote);
      let first = true;
      remote.upload = async (l, r, o, cb) => {
        await realUpload(l, r, o, cb);
        if (first) {
          first = false;
          write('live.txt', 'v2-longer', 3000); // user keeps writing during the transfer
        }
      };
      await engine.syncNow();
      await engine.syncNow();
      await engine.syncNow();
      expect(copies()).toEqual([]);
      expect(remote.files.get('/Sync/live.txt')?.data.toString()).toBe('v2-longer');
    });
  });

  describe('console-created file, then app restart (user report)', () => {
    const copies = (): string[] => readdirSync(localDir).filter(n => n.includes('conflict'));
    const restart = (): SyncEngine => {
      engine.stop();
      const e = new SyncEngine(remote, db, {
        watch: false,
        settleMs: 0,
        minGapMs: 0,
        now: () => new Date(2026, 5, 7, 8, 9),
      });
      e.configure({ id: db.getPairs()[0]!.id, localPath: localDir, remotePath: '/Sync' });
      return e;
    };

    it('touch (empty) -> write -> restart -> many runs: no copies', async () => {
      write('asdf.txt', '', 1000); // `touch asdf.txt`
      await engine.syncNow();
      write('asdf.txt', 'a\n', 2000); // `echo a > asdf.txt`
      await engine.syncNow();
      const e2 = restart();
      for (let i = 0; i < 4; i++) await e2.syncNow();
      expect(copies()).toEqual([]);
      expect(remote.files.get('/Sync/asdf.txt')?.data.toString()).toBe('a\n');
    });

    it('same, but the Disk gives no md5 for empty files and lags on stat', async () => {
      remote.hideMd5 = true;
      remote.statMisses = 2;
      write('asdf.txt', '', 1000);
      await engine.syncNow();
      write('asdf.txt', 'a\n', 2000);
      await engine.syncNow();
      const e2 = restart();
      for (let i = 0; i < 4; i++) await e2.syncNow();
      expect(copies()).toEqual([]);
    });

    it('an empty file created in the console is uploaded once and then left alone', async () => {
      write('empty.txt', '', 1000);
      await engine.syncNow();
      const e2 = restart();
      await e2.syncNow();
      await e2.syncNow();
      expect(copies()).toEqual([]);
      expect(e2.getProgress().totalFiles).toBe(0);
      expect(remote.files.has('/Sync/empty.txt')).toBe(true);
    });
  });

  describe('damaged transfer must not start a conflict chain', () => {
    const copies = (): string[] => readdirSync(localDir).filter(n => n.includes('conflict'));

    it('an upload that arrives truncated is rejected, removed, and retried — never turned into copies', async () => {
      write('asdf.txt', 'a\n', 1000);
      const realUpload = remote.upload.bind(remote);
      let broken = true;
      remote.upload = async (l, r, o, cb) => {
        if (broken) {
          remote.put(r, ''); // the Disk got an empty body
          cb(0, 2);
          return;
        }
        return realUpload(l, r, o, cb);
      };
      await engine.syncNow();
      expect(engine.getProgress().failures[0]).toContain('Upload verification failed');
      expect(remote.removed).toContain('/Sync/asdf.txt');
      await engine.syncNow();
      await engine.syncNow();
      expect(copies()).toEqual([]);
      expect(readFileSync(local('asdf.txt'), 'utf8')).toBe('a\n');

      broken = false; // the transport recovers
      await engine.syncNow();
      expect(copies()).toEqual([]);
      expect(remote.files.get('/Sync/asdf.txt')?.data.toString()).toBe('a\n');
      expect(engine.getProgress().failures).toEqual([]);
    });
  });

  describe('control and schedule', () => {
    const make = (opts: Partial<ConstructorParameters<typeof SyncEngine>[2]> = {}) => {
      const e = new SyncEngine(remote, db, { watch: false, settleMs: 0, minGapMs: 0, ...opts });
      e.configure({ id: db.getPairs()[0]!.id, localPath: localDir, remotePath: '/Sync' });
      return e;
    };

    it('start runs at once and stop pauses; start twice is a no-op', async () => {
      write('a.txt', 'a', 1000);
      expect(engine.isEnabled()).toBe(false);
      engine.start();
      engine.start();
      expect(engine.isEnabled()).toBe(true);
      await vi.waitFor(() => expect(remote.files.has('/Sync/a.txt')).toBe(true));
      engine.stop();
      expect(engine.isEnabled()).toBe(false);
      expect(engine.getProgress().phase).toBe('paused');
    });

    it('start without a configured pair does nothing; syncNow without a pair returns', async () => {
      const e = new SyncEngine(remote, db, { watch: false, minGapMs: 0 });
      e.start();
      expect(e.isEnabled()).toBe(false);
      await expect(e.syncNow()).resolves.toBeUndefined();
    });

    it('the timer repeats runs and picks up Disk changes', async () => {
      const e = make({ intervalMs: 30 });
      e.start();
      await vi.waitFor(() => expect(e.getProgress().lastSync).not.toBeNull());
      remote.put('/Sync/later.txt', 'later');
      await vi.waitFor(() => expect(existsSync(local('later.txt'))).toBe(true));
      e.stop();
    });

    it('a local change is noticed by the file watcher and synced', async () => {
      const e = make({ watch: true });
      e.start();
      await vi.waitFor(() => expect(e.getProgress().lastSync).not.toBeNull());
      await new Promise(r => setTimeout(r, 300)); // let chokidar finish its initial scan
      write('watched.txt', 'w');
      await vi.waitFor(() => expect(remote.files.has('/Sync/watched.txt')).toBe(true), {
        timeout: 8000,
      });
      e.stop();
    });

    it('a watcher that cannot start does not stop the engine', async () => {
      const spy = vi.spyOn(FsWatcher.prototype, 'start').mockImplementation(() => {
        throw new Error('no inotify');
      });
      const e = make({ watch: true });
      write('x.txt', 'x', 1000);
      e.start();
      await vi.waitFor(() => expect(remote.files.has('/Sync/x.txt')).toBe(true));
      e.stop();
      expect(logger.getEntries().some(l => l.msg.includes('file watcher failed'))).toBe(true);
      spy.mockRestore();
    });

    it('progress listeners can unsubscribe; getProgress returns a copy', async () => {
      const seen: string[] = [];
      const off = engine.onProgress(p => seen.push(p.phase));
      await engine.syncNow();
      expect(seen).toContain('scanning');
      off();
      const count = seen.length;
      await engine.syncNow();
      expect(seen).toHaveLength(count);
      const p = engine.getProgress();
      p.failures.push('x');
      expect(engine.getProgress().failures).toEqual([]);
    });

    it('configure(null) clears the pair and the last-sync time', async () => {
      await engine.syncNow();
      engine.configure(null);
      expect(engine.getProgress().lastSync).toBeNull();
      await expect(engine.syncNow()).resolves.toBeUndefined();
    });

    it('a run requested during a run is repeated once, not run in parallel', async () => {
      let active = 0;
      let maxActive = 0;
      const realList = remote.list.bind(remote);
      remote.list = async d => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise(r => setTimeout(r, 20));
        active--;
        return realList(d);
      };
      await Promise.all([engine.syncNow(), engine.syncNow(), engine.syncNow()]);
      expect(maxActive).toBe(1);
    });

    it('files still being written are retried by themselves after the settle time', async () => {
      const e = make({ settleMs: 150 });
      write('fresh.txt', 'fresh'); // mtime = now
      e.start();
      await vi.waitFor(() => expect(remote.files.has('/Sync/fresh.txt')).toBe(true), {
        timeout: 5000,
      });
      e.stop();
    });
  });

  describe('first sight and bookkeeping', () => {
    it('a fresh file present on both sides is left alone (no conflict, no transfer)', async () => {
      const e = new SyncEngine(remote, db, { watch: false, settleMs: 60_000, minGapMs: 0 });
      e.configure({ id: db.getPairs()[0]!.id, localPath: localDir, remotePath: '/Sync' });
      write('both.txt', 'same');
      remote.put('/Sync/both.txt', 'same');
      await e.syncNow();
      expect(readdirSync(localDir)).toEqual(['both.txt']);
      expect(e.getProgress().totalFiles).toBe(0);
    });

    it('same size and same md5: adopted without a transfer', async () => {
      write('same.txt', 'abcd', 1000);
      remote.put('/Sync/same.txt', 'abcd');
      await engine.syncNow();
      expect(readdirSync(localDir)).toEqual(['same.txt']);
      expect(db.getSyncStates(db.getPairs()[0]!.id).has('same.txt')).toBe(true);
    });

    it('same size but different content is a conflict (both versions kept)', async () => {
      write('diff.txt', 'aaaa', 1000);
      remote.put('/Sync/diff.txt', 'bbbb');
      await engine.syncNow();
      expect(readdirSync(localDir).filter(n => n.includes('conflict'))).toHaveLength(1);
      expect(readFileSync(local('diff.txt'), 'utf8')).toBe('bbbb');
    });

    it('a file gone from both sides is forgotten', async () => {
      write('gone.txt', 'g', 1000);
      await engine.syncNow();
      const id = db.getPairs()[0]!.id;
      expect(db.getSyncStates(id).has('gone.txt')).toBe(true);
      rmSync(local('gone.txt'));
      remote.files.delete('/Sync/gone.txt');
      await engine.syncNow();
      expect(db.getSyncStates(id).has('gone.txt')).toBe(false);
    });

    it('a local file that disappears during the post-upload check does not fail the upload', async () => {
      write('vanish.txt', 'vv', 1000);
      remote.upload = async (l, r) => {
        remote.put(r, ''); // damaged on the Disk …
        rmSync(l); // … but the local file is gone too, so the size check cannot be trusted
      };
      await engine.syncNow();
      expect(engine.getProgress().failures).toEqual([]);
    });
  });

  describe('flat file list and the schedule of full scans', () => {
    let rootDir: string;
    const makeRoot = (opts: Partial<ConstructorParameters<typeof SyncEngine>[2]> = {}) => {
      rootDir = join(tmp, 'disk-root');
      mkdirSync(rootDir, { recursive: true });
      const id = db.addSyncPair(rootDir, '/');
      const e = new SyncEngine(remote, db, { watch: false, settleMs: 0, minGapMs: 0, ...opts });
      e.configure({ id, localPath: rootDir, remotePath: '/' });
      return e;
    };
    const inRoot = (rel: string): string => join(rootDir, rel);
    const resetCalls = (): void => {
      remote.listCalls = [];
      remote.mkdirCalls = [];
      remote.flatCalls = 0;
    };

    it('the first run walks the folders, the next ones read the flat list only', async () => {
      remote.put('/a/x.txt', 'x');
      remote.put('/b/y.txt', 'y');
      const e = makeRoot();
      await e.syncNow();
      expect(remote.flatCalls).toBe(0);
      expect(remote.listCalls).toEqual(expect.arrayContaining(['/', '/a', '/b']));
      resetCalls();
      await e.syncNow();
      expect(remote.listCalls).toEqual([]);
      expect(remote.flatCalls).toBe(1);
      expect(e.getProgress()).toMatchObject({ error: null, totalFiles: 0 });
    });

    it('new and changed files on the Disk are found without listing a single folder', async () => {
      remote.put('/a/x.txt', 'x');
      const e = makeRoot();
      await e.syncNow();
      resetCalls();
      remote.put('/a/new.txt', 'n');
      remote.put('/a/x.txt', 'x2');
      await e.syncNow();
      expect(readFileSync(inRoot('a/new.txt'), 'utf8')).toBe('n');
      expect(readFileSync(inRoot('a/x.txt'), 'utf8')).toBe('x2');
      expect(remote.listCalls).toEqual([]);
    });

    it('an empty folder seen by the full scan is not asked for again', async () => {
      remote.dirs.add('/empty');
      const e = makeRoot();
      await e.syncNow();
      expect(existsSync(inRoot('empty'))).toBe(true);
      resetCalls();
      await e.syncNow();
      expect(remote.mkdirCalls).toEqual([]);
      expect(e.getProgress().failures).toEqual([]);
    });

    it('an empty local folder is created on the Disk once, not on every run', async () => {
      const e = makeRoot();
      mkdirSync(inRoot('fresh'));
      await e.syncNow();
      expect(remote.mkdirCalls).toContain('/fresh');
      resetCalls();
      await e.syncNow();
      expect(remote.mkdirCalls).toEqual([]);
      expect(e.getProgress().failures).toEqual([]);
    });

    it('a file missing from the flat list is deleted locally only after the Disk confirms it is gone', async () => {
      remote.put('/a/x.txt', 'x');
      remote.put('/a/y.txt', 'y');
      const e = makeRoot();
      await e.syncNow();
      remote.hiddenFromFlat.add('/a/x.txt'); // still on the Disk, only missing from the list
      await e.syncNow();
      expect(existsSync(inRoot('a/x.txt'))).toBe(true);
      remote.files.delete('/a/y.txt'); // really gone
      await e.syncNow();
      expect(existsSync(inRoot('a/y.txt'))).toBe(false);
      expect(existsSync(inRoot('a/x.txt'))).toBe(true);
    });

    it('a failed confirmation keeps the file and reports the failure', async () => {
      remote.put('/a/x.txt', 'x');
      const e = makeRoot();
      await e.syncNow();
      remote.hiddenFromFlat.add('/a/x.txt');
      remote.stat = async () => {
        throw new Error('503: down');
      };
      await e.syncNow();
      expect(existsSync(inRoot('a/x.txt'))).toBe(true);
      expect(e.getProgress().failures.join()).toContain('503');
    });

    it('the whole tree is read again after fullScanMs', async () => {
      remote.put('/a/x.txt', 'x');
      const e = makeRoot({ fullScanMs: 100 });
      await e.syncNow();
      resetCalls();
      await new Promise(r => setTimeout(r, 150));
      await e.syncNow();
      expect(remote.listCalls.length).toBeGreaterThan(0);
      expect(remote.flatCalls).toBe(0);
    });

    it('"Sync now" reads the whole tree', async () => {
      remote.put('/a/x.txt', 'x');
      const e = makeRoot();
      await e.syncNow();
      resetCalls();
      await e.syncNow({ immediate: true });
      expect(remote.listCalls.length).toBeGreaterThan(0);
      expect(remote.flatCalls).toBe(0);
    });

    it('configuring again starts with a full scan', async () => {
      remote.put('/a/x.txt', 'x');
      const e = makeRoot();
      await e.syncNow();
      e.configure({ id: db.getPairs().at(-1)!.id, localPath: rootDir, remotePath: '/' });
      resetCalls();
      await e.syncNow();
      expect(remote.listCalls.length).toBeGreaterThan(0);
    });

    it('goes back to walking the folders when the Disk refuses the flat list (400), and stays there', async () => {
      remote.put('/a/x.txt', 'x');
      const e = makeRoot();
      await e.syncNow();
      resetCalls();
      remote.failFlat = new Error('400: limit too large');
      remote.put('/a/n.txt', 'n');
      await e.syncNow();
      expect(remote.flatCalls).toBe(1);
      expect(remote.listCalls.length).toBeGreaterThan(0);
      expect(readFileSync(inRoot('a/n.txt'), 'utf8')).toBe('n');
      expect(e.getProgress().error).toBeNull();
      resetCalls();
      await e.syncNow();
      expect(remote.flatCalls).toBe(0);
      expect(remote.listCalls.length).toBeGreaterThan(0);
    });

    it('any other failure of the flat list ends the run: nothing is deleted on a guess', async () => {
      remote.put('/a/x.txt', 'x');
      const e = makeRoot();
      await e.syncNow();
      remote.failFlat = new Error('503: down');
      await e.syncNow();
      expect(e.getProgress()).toMatchObject({ phase: 'error' });
      expect(e.getProgress().error).toContain('503');
      expect(existsSync(inRoot('a/x.txt'))).toBe(true);
    });

    it('a sync folder that is not the whole Disk always walks its folders', async () => {
      remote.put('/Sync/a.txt', 'a');
      await engine.syncNow();
      await engine.syncNow();
      expect(remote.flatCalls).toBe(0);
    });

    it('files in hidden folders stay out, as in the folder walk', async () => {
      remote.put('/.cache/a.txt', 'h');
      remote.put('/a/x.txt', 'x');
      const e = makeRoot();
      await e.syncNow();
      await e.syncNow();
      expect(existsSync(inRoot('.cache'))).toBe(false);
      expect(existsSync(inRoot('a/x.txt'))).toBe(true);
    });
  });

  describe('pausing cancels requests and transfers in flight', () => {
    const make = (opts: Partial<ConstructorParameters<typeof SyncEngine>[2]> = {}) => {
      const e = new SyncEngine(remote, db, { watch: false, settleMs: 0, minGapMs: 0, ...opts });
      e.configure({ id: db.getPairs()[0]!.id, localPath: localDir, remotePath: '/Sync' });
      return e;
    };
    /** Never answers; fails with the signal's reason once it fires. */
    const hang = (seen: { signal?: AbortSignal }) => (signal?: AbortSignal) =>
      new Promise<never>((_resolve, reject) => {
        seen.signal = signal;
        signal?.addEventListener('abort', () => reject(signal.reason));
      });

    it('a listing in flight is cancelled and the run ends as paused, not as an error', async () => {
      const e = make();
      const seen: { signal?: AbortSignal } = {};
      remote.list = (_dir, signal) => hang(seen)(signal);
      const run = e.syncNow();
      await vi.waitFor(() => expect(seen.signal).toBeDefined());
      e.stop();
      await run;
      expect(seen.signal!.aborted).toBe(true);
      expect(e.getProgress()).toMatchObject({ phase: 'paused', error: null, failures: [] });
    });

    it('a download in flight is cancelled and is not reported as a failed file', async () => {
      remote.put('/Sync/a.txt', 'a');
      const e = make();
      const seen: { signal?: AbortSignal } = {};
      remote.download = (_r, _l, _p, _m, _e, signal) => hang(seen)(signal);
      const run = e.syncNow();
      await vi.waitFor(() => expect(seen.signal).toBeDefined());
      e.stop();
      await run;
      expect(e.getProgress()).toMatchObject({ phase: 'paused', error: null, failures: [] });
      expect(e.getProgress().lastSync).toBeNull();
      expect(existsSync(local('a.txt'))).toBe(false);
    });

    it('every request of a run carries the same cancellation signal', async () => {
      remote.put('/Sync/gone.txt', 'g');
      const e = make();
      await e.syncNow();
      rmSync(local('gone.txt'));
      write('up.txt', 'u');
      mkdirSync(local('newdir'));
      remote.put('/Sync/down.txt', 'd');
      const signals: Record<string, unknown> = {};
      const realList = remote.list.bind(remote);
      const realStat = remote.stat.bind(remote);
      const realMkdir = remote.mkdir.bind(remote);
      const realUpload = remote.upload.bind(remote);
      const realDownload = remote.download.bind(remote);
      const realRemove = remote.remove.bind(remote);
      remote.list = (d, s) => ((signals.list = s), realList(d, s));
      remote.stat = (p, s) => ((signals.stat = s), realStat(p, s));
      remote.mkdir = (p, s) => ((signals.mkdir = s), realMkdir(p, s));
      remote.upload = (l, r, o, cb, s) => ((signals.upload = s), realUpload(l, r, o, cb, s));
      remote.download = (r, l, cb, m, x, s) => (
        (signals.download = s),
        realDownload(r, l, cb, m, x, s)
      );
      remote.remove = (p, s) => ((signals.remove = s), realRemove(p, s));
      await e.syncNow();
      for (const name of ['list', 'stat', 'mkdir', 'upload', 'download', 'remove']) {
        expect(signals[name], name).toBeInstanceOf(AbortSignal);
      }
      expect(new Set(Object.values(signals)).size).toBe(1);
    });

    it('a run waiting out the pause between runs does not start after the pause button', async () => {
      const e = make({ minGapMs: 300 });
      await e.syncNow();
      let scans = 0;
      e.onProgress(p => {
        if (p.phase === 'scanning') scans++;
      });
      const second = e.syncNow();
      await new Promise(r => setTimeout(r, 50));
      e.stop();
      await second;
      expect(scans).toBe(0);
    });

    it('a full Disk (507) is not held back: the next run tries again at once', async () => {
      write('big.bin', 'x');
      const e = make({ retryBaseMs: 60_000 });
      let tries = 0;
      remote.upload = async () => {
        tries++;
        throw new Error('507: there is not enough free space on the Disk');
      };
      await e.syncNow();
      await e.syncNow();
      expect(tries).toBe(2);
      expect(e.getProgress().failures.join()).not.toContain('next try in');
    });
  });

  describe('pauses between runs and backoff after server errors', () => {
    const make = (opts: Partial<ConstructorParameters<typeof SyncEngine>[2]> = {}) => {
      const e = new SyncEngine(remote, db, { watch: false, settleMs: 0, minGapMs: 0, ...opts });
      e.configure({ id: db.getPairs()[0]!.id, localPath: localDir, remotePath: '/Sync' });
      return e;
    };
    const serverError = (status: number): Error => new Error(`${status}: server trouble`);

    it('a run requested during a run starts only after the minimum pause', async () => {
      const e = make({ minGapMs: 200, intervalMs: 60_000 });
      const idleAt: number[] = [];
      const scanAt: number[] = [];
      e.onProgress(p => {
        if (p.phase === 'idle') idleAt.push(Date.now());
        if (p.phase === 'scanning') scanAt.push(Date.now());
      });
      e.start();
      await e.syncNow(); // lands while the first run is in progress: one repeat, after the pause
      await vi.waitFor(() => expect(scanAt.length).toBeGreaterThanOrEqual(2), { timeout: 3000 });
      await vi.waitFor(() => expect(e.getProgress().phase).toBe('idle')); // the repeat has ended
      e.stop();
      expect(scanAt[1]! - idleAt[0]!).toBeGreaterThanOrEqual(190);
    });

    it('a manual run starts at once, not after the pause', async () => {
      const e = make({ minGapMs: 5000 });
      await e.syncNow();
      const began = Date.now();
      await e.syncNow({ immediate: true });
      expect(Date.now() - began).toBeLessThan(1000);
    });

    it('a manual run cuts a pause that is already running short', async () => {
      const e = make({ minGapMs: 5000, intervalMs: 60_000 });
      let scans = 0;
      e.onProgress(p => {
        if (p.phase === 'scanning') scans++;
      });
      e.start();
      await e.syncNow(); // joins the first run: one repeat, held for the pause
      await vi.waitFor(() => expect(e.getProgress().phase).toBe('idle'));
      await new Promise(r => setTimeout(r, 100)); // the repeat is now waiting
      expect(scans).toBe(1);
      await e.syncNow({ immediate: true }); // wakes it
      await vi.waitFor(() => expect(scans).toBe(2), { timeout: 1000 });
      await vi.waitFor(() => expect(e.getProgress().phase).toBe('idle')); // the run has ended
      e.stop();
    });

    it('the poll timer firing during a long run does not queue another run at once', async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>(resolve => (release = resolve));
      const realList = remote.list.bind(remote);
      remote.list = async d => {
        await gate;
        return realList(d);
      };
      const e = make({ intervalMs: 300 });
      let scans = 0;
      e.onProgress(p => {
        if (p.phase === 'scanning') scans++;
      });
      e.start();
      await new Promise(r => setTimeout(r, 350)); // a tick falls inside the blocked run
      release();
      await new Promise(r => setTimeout(r, 100)); // the run ends; the next tick is not due yet
      expect(scans).toBe(1);
      e.stop();
    });

    it('a file the Disk answers 5xx for is not requested again before its delay, which doubles', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        const e = make({ retryBaseMs: 1000, retryMaxMs: 3000 });
        remote.put('/Sync/a.txt', 'a');
        remote.downloadError = serverError(500);
        await e.syncNow();
        expect(remote.downloads).toBe(1);
        expect(e.getProgress().failures).toHaveLength(1);

        await e.syncNow(); // at once: no request, still reported as failed
        expect(remote.downloads).toBe(1);
        expect(e.getProgress().failures).toHaveLength(1);

        vi.advanceTimersByTime(1001);
        await e.syncNow(); // first delay (1 s) is over
        expect(remote.downloads).toBe(2);
        vi.advanceTimersByTime(1500);
        await e.syncNow(); // the second delay is 2 s
        expect(remote.downloads).toBe(2);
        vi.advanceTimersByTime(600);
        await e.syncNow();
        expect(remote.downloads).toBe(3);
        vi.advanceTimersByTime(2500);
        await e.syncNow(); // the third would be 4 s, capped at 3 s: not yet
        expect(remote.downloads).toBe(3);
        vi.advanceTimersByTime(600);
        await e.syncNow();
        expect(remote.downloads).toBe(4);
      } finally {
        vi.useRealTimers();
      }
    });

    it('pausing stops a run in flight before the next folder is listed', async () => {
      remote.put('/Sync/a/x.txt', 'x');
      remote.put('/Sync/b/y.txt', 'y');
      const e = make();
      const listed: string[] = [];
      const realList = remote.list.bind(remote);
      remote.list = async d => {
        listed.push(d);
        const out = await realList(d);
        if (d === '/Sync') e.stop(); // the user unticks sync right after the first listing
        return out;
      };
      await e.syncNow();
      expect(listed).not.toContain('/Sync/a');
      expect(listed).not.toContain('/Sync/b');
      expect(remote.downloads).toBe(0);
      expect(e.getProgress().phase).toBe('paused');
      expect(e.getProgress().error).toBeNull(); // a pause is not an error
      expect(existsSync(local('a/x.txt'))).toBe(false); // nothing is planned from a half-read tree
    });

    it('pausing stops a run in flight after the current file', async () => {
      for (const n of ['a', 'b', 'c']) remote.put(`/Sync/${n}.txt`, n);
      const e = make();
      const realDownload = remote.download.bind(remote);
      remote.download = async (...args) => {
        await realDownload(...args);
        e.stop();
      };
      await e.syncNow();
      expect(remote.downloads).toBe(1);
      expect(e.getProgress().phase).toBe('paused');
      expect(e.getProgress().lastSync).toBeNull(); // an interrupted run is not a finished sync
    });

    it('a manual run after a pause is not cancelled by it', async () => {
      for (const n of ['a', 'b']) remote.put(`/Sync/${n}.txt`, n);
      const e = make();
      const realDownload = remote.download.bind(remote);
      let first = true;
      remote.download = async (...args) => {
        await realDownload(...args);
        if (first) e.stop();
        first = false;
      };
      await e.syncNow();
      expect(remote.downloads).toBe(1);
      await e.syncNow({ immediate: true });
      expect(remote.downloads).toBe(2);
    });

    it('"Sync now" during a run does not queue a second full scan behind it', async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>(resolve => (release = resolve));
      const realList = remote.list.bind(remote);
      remote.list = async d => {
        await gate;
        return realList(d);
      };
      const e = make();
      let scans = 0;
      e.onProgress(p => {
        if (p.phase === 'scanning') scans++;
      });
      e.start();
      await new Promise(r => setTimeout(r, 50));
      await e.syncNow({ immediate: true });
      await e.syncNow({ immediate: true });
      release();
      await vi.waitFor(() => expect(e.getProgress().phase).toBe('idle'));
      await new Promise(r => setTimeout(r, 100)); // a queued repeat would have begun by now
      e.stop();
      expect(scans).toBe(1);
    });

    it('429 is backed off too, and a success clears the delay', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        const e = make({ retryBaseMs: 1000 });
        remote.put('/Sync/a.txt', 'a');
        remote.downloadError = serverError(429);
        await e.syncNow();
        await e.syncNow();
        expect(remote.downloads).toBe(1);

        remote.downloadError = null;
        vi.advanceTimersByTime(1001);
        await e.syncNow();
        expect(readFileSync(local('a.txt'), 'utf8')).toBe('a');
        expect(e.getProgress().failures).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('other failures (404, a failed checksum) are retried on every run, without a delay', async () => {
      const e = make({ retryBaseMs: 60_000 });
      remote.put('/Sync/a.txt', 'a');
      remote.downloadError = new Error('404: gone');
      await e.syncNow();
      await e.syncNow();
      expect(remote.downloads).toBe(2);
    });
  });
});
