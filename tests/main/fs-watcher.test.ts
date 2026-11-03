import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { FsWatcher, type FsWatchEvent } from '../../src/main/fs-watcher.js';

function waitFor<T>(predicate: () => T | null, timeoutMs = 3000, intervalMs = 20): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const value = predicate();
      if (value) return resolve(value);
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timed out'));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

describe('FsWatcher', () => {
  let dir: string;
  let watcher: FsWatcher | null = null;

  afterEach(async () => {
    if (watcher) {
      await watcher.stop();
      watcher = null;
    }
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('emits an "added" event for a real new file in the watched root', async () => {
    dir = mkdtempSync(join(tmpdir(), 'fs-watcher-test-'));
    watcher = new FsWatcher(dir, { debounceMs: 50 });
    const events: FsWatchEvent[] = [];
    watcher.onEvent(e => events.push(e));
    watcher.start();

    // Give chokidar a moment to finish its initial scan.
    await new Promise(r => setTimeout(r, 200));
    writeFileSync(join(dir, 'new-file.txt'), 'hello');

    const found = await waitFor(() => events.find(e => e.type === 'added') ?? null);
    expect(found.path.endsWith('new-file.txt')).toBe(true);
  }, 10000);

  it('emits a "deleted" event for a real removed file', async () => {
    dir = mkdtempSync(join(tmpdir(), 'fs-watcher-test-'));
    const filePath = join(dir, 'to-delete.txt');
    writeFileSync(filePath, 'bye');

    watcher = new FsWatcher(dir, { debounceMs: 50 });
    const events: FsWatchEvent[] = [];
    watcher.onEvent(e => events.push(e));
    watcher.start();

    await new Promise(r => setTimeout(r, 200));
    unlinkSync(filePath);

    const found = await waitFor(() => events.find(e => e.type === 'deleted') ?? null);
    expect(found.path.endsWith('to-delete.txt')).toBe(true);
  }, 10000);

  it('debounces rapid successive writes to the same file into one event', async () => {
    dir = mkdtempSync(join(tmpdir(), 'fs-watcher-test-'));
    const filePath = join(dir, 'rapid.txt');
    writeFileSync(filePath, 'v0');

    watcher = new FsWatcher(dir, { debounceMs: 300 });
    const events: FsWatchEvent[] = [];
    watcher.onEvent(e => events.push(e));
    watcher.start();
    await new Promise(r => setTimeout(r, 200));

    writeFileSync(filePath, 'v1');
    await new Promise(r => setTimeout(r, 50));
    writeFileSync(filePath, 'v2');
    await new Promise(r => setTimeout(r, 50));
    writeFileSync(filePath, 'v3');

    await new Promise(r => setTimeout(r, 600));
    const matching = events.filter(e => e.path.endsWith('rapid.txt'));
    expect(matching.length).toBe(1);
  }, 10000);
});

describe('FsWatcher internals', () => {
  it('drops paths outside the watched root and can be started and stopped safely', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fs-watcher-int-'));
    const w = new FsWatcher(dir, { debounceMs: 10 });
    const seen: FsWatchEvent[] = [];
    const off = w.onEvent(e => seen.push(e));
    const schedule = (p: string, t: FsWatchEvent['type']) =>
      (w as unknown as { schedule: (p: string, t: string) => void }).schedule(p, t);
    schedule('/etc/passwd', 'added'); // outside the root: dropped
    schedule(join(dir, 'a.txt'), 'added');
    schedule(join(dir, 'a.txt'), 'changed'); // debounced into one, the last type wins
    schedule(dir, 'changed'); // the root itself
    await new Promise(r => setTimeout(r, 60));
    expect(seen.map(e => [e.path.endsWith('a.txt') ? 'a' : 'root', e.type])).toEqual([
      ['a', 'changed'],
      ['root', 'changed'],
    ]);
    off();
    schedule(join(dir, 'b.txt'), 'added');
    await new Promise(r => setTimeout(r, 60));
    expect(seen).toHaveLength(2); // unsubscribed
    w.start();
    w.start(); // second start is a no-op
    await w.stop();
    await w.stop(); // stopping twice is harmless
    rmSync(dir, { recursive: true, force: true });
  });
});
