import { describe, expect, it, vi } from 'vitest';

import { setSyncEnabled } from '../../src/main/sync-control.js';

const pair = { id: 'p1', localPath: '/l', remotePath: '/r', isActive: true };
const make = (pairs: unknown[]) => ({
  db: { getPairs: vi.fn(() => pairs), togglePairActive: vi.fn() },
  engine: { configure: vi.fn(), start: vi.fn(), stop: vi.fn() },
});

describe('setSyncEnabled', () => {
  it('returns false and does nothing when no pair is set up', () => {
    const { db, engine } = make([]);
    expect(setSyncEnabled(db as never, engine as never, true)).toBe(false);
    expect(engine.start).not.toHaveBeenCalled();
  });

  it('enable persists the flag, points the engine at the pair and starts it', () => {
    const { db, engine } = make([pair]);
    expect(setSyncEnabled(db as never, engine as never, true)).toBe(true);
    expect(db.togglePairActive).toHaveBeenCalledWith('p1', true);
    expect(engine.configure).toHaveBeenCalledWith({ id: 'p1', localPath: '/l', remotePath: '/r' });
    expect(engine.start).toHaveBeenCalled();
  });

  it('pause persists the flag and stops the engine', () => {
    const { db, engine } = make([pair]);
    setSyncEnabled(db as never, engine as never, false);
    expect(db.togglePairActive).toHaveBeenCalledWith('p1', false);
    expect(engine.stop).toHaveBeenCalled();
    expect(engine.start).not.toHaveBeenCalled();
  });
});
