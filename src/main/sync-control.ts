/**
 * Turning sync on / off for the saved pair. Shared by the IPC handlers, the
 * tray menu and the app menu so they all behave the same.
 *
 * @module sync-control
 */
import { logger } from './logger.js';
import type { SyncDB } from './sync-db.js';
import type { SyncEngine } from './sync-engine.js';

/** Enable or pause the saved pair. Returns false when no pair has been set up. */
export function setSyncEnabled(db: SyncDB, engine: SyncEngine, enabled: boolean): boolean {
  const pair = db.getPairs()[0];
  if (!pair) return false;
  db.togglePairActive(pair.id, enabled);
  logger.info('sync', enabled ? 'sync enabled' : 'sync paused', {
    local: pair.localPath,
    remote: pair.remotePath,
  });
  if (enabled) {
    engine.configure({ id: pair.id, localPath: pair.localPath, remotePath: pair.remotePath });
    engine.start();
  } else {
    engine.stop();
  }
  return true;
}
