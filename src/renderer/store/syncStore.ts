/**
 * Sync state: the configured pair plus live progress from the sync engine.
 *
 * @module syncStore
 */
import { create } from 'zustand';

import { useErrorStore } from './errorStore.js';
import type { SyncConfig, SyncProgress } from '../../shared/types.js';

const IDLE: SyncProgress = {
  phase: 'idle',
  totalFiles: 0,
  doneFiles: 0,
  totalBytes: 0,
  doneBytes: 0,
  current: null,
  lastSync: null,
  error: null,
  failures: [],
  conflicts: 0,
};

interface SyncStoreState {
  config: SyncConfig | null;
  progress: SyncProgress;
  loaded: boolean;

  refresh: () => Promise<void>;
  applyProgress: (p: SyncProgress) => void;
  configure: (localPath: string, remotePath: string) => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  syncNow: () => Promise<void>;
}

const fail = (e: unknown): void =>
  useErrorStore.getState().addError(e instanceof Error ? e.message : String(e));

export const useSyncStore = create<SyncStoreState>((set, get) => ({
  config: null,
  progress: IDLE,
  loaded: false,

  refresh: async () => {
    try {
      const [config, status] = await Promise.all([
        window.api.getSyncConfig(),
        window.api.getSyncStatus(),
      ]);
      set({ config, progress: status, loaded: true });
    } catch (e) {
      fail(e);
    }
  },

  applyProgress: p => set({ progress: p }),

  configure: async (localPath, remotePath) => {
    try {
      await window.api.configureSync(localPath, remotePath);
    } catch (e) {
      fail(e);
    }
    await get().refresh();
  },

  setEnabled: async enabled => {
    try {
      await (enabled ? window.api.startSync() : window.api.pauseSync());
    } catch (e) {
      fail(e);
    }
    await get().refresh();
  },

  syncNow: async () => {
    try {
      await window.api.syncNow();
    } catch (e) {
      fail(e);
    }
  },
}));
