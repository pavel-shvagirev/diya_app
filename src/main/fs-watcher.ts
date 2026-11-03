/**
 * Local filesystem watcher for a sync pair, backed by chokidar.
 *
 * Emits debounced added/changed/deleted/moved events for files under a
 * sync root, after validating every path stays within that root.
 *
 * @module fs-watcher
 */
import * as path from 'path';
import { watch } from 'chokidar';

import { resolveSafePath } from '../shared/validation.js';
import type { FSWatcher } from 'chokidar';

export type FsWatchEventType = 'added' | 'changed' | 'deleted' | 'moved';

export interface FsWatchEvent {
  type: FsWatchEventType;
  path: string;
  /** Previous path, only present for 'moved' events. */
  fromPath?: string;
}

export interface FsWatcherOptions {
  /** Debounce window in ms before an event is emitted. Default 500. */
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 500;

/**
 * Watches one local directory (a sync pair's root) for file changes,
 * debouncing rapid-fire events (e.g. during a large copy) and
 * rejecting any path chokidar reports outside the watched root.
 */
export class FsWatcher {
  private readonly root: string;
  private readonly debounceMs: number;
  private watcher: FSWatcher | null = null;
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly pendingType = new Map<string, FsWatchEventType>();
  private listeners: Array<(event: FsWatchEvent) => void> = [];

  constructor(root: string, options: FsWatcherOptions = {}) {
    this.root = root;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  /** Subscribe to debounced watch events. Returns an unsubscribe function. */
  onEvent(listener: (event: FsWatchEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /** Start watching. Hidden files (dotfiles) are ignored by default. */
  start(): void {
    if (this.watcher) return;

    this.watcher = watch(this.root, {
      ignored: /(^|[/\\])\../,
      ignoreInitial: true,
      persistent: true,
    });

    this.watcher.on('add', p => this.schedule(p, 'added'));
    this.watcher.on('change', p => this.schedule(p, 'changed'));
    this.watcher.on('unlink', p => this.schedule(p, 'deleted'));
  }

  /** Stop watching and clear any pending debounced events. */
  async stop(): Promise<void> {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.pendingType.clear();
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Validate a path chokidar reported stays within the watched root,
   * then debounce and emit it. Paths outside the root are dropped.
   */
  private schedule(rawPath: string, type: FsWatchEventType): void {
    let safePath: string;
    try {
      const relative = path.relative(this.root, rawPath);
      safePath = resolveSafePath(this.root, relative === '' ? '.' : relative);
    } catch {
      return;
    }

    const existingTimer = this.timers.get(safePath);
    if (existingTimer) clearTimeout(existingTimer);
    this.pendingType.set(safePath, type);

    const timer = setTimeout(() => {
      const finalType = this.pendingType.get(safePath) ?? type;
      this.timers.delete(safePath);
      this.pendingType.delete(safePath);
      for (const listener of this.listeners) {
        listener({ type: finalType, path: safePath });
      }
    }, this.debounceMs);
    this.timers.set(safePath, timer);
  }
}
