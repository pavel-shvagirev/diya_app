import { describe, expect, it, vi } from 'vitest';

import { createQuitGuard } from '../../src/main/quit-guard.js';

const make = () => {
  let now = 1000;
  const hint = vi.fn();
  const quit = vi.fn();
  const guard = createQuitGuard({ now: () => now, windowMs: 3000, showHint: hint, quit });
  return { guard, hint, quit, advance: (ms: number) => (now += ms) };
};

describe('quit guard (Cmd/Ctrl+Q needs a second press)', () => {
  it('first press only shows the hint and cancels the quit', () => {
    const { guard, hint, quit } = make();
    expect(guard.shouldQuit()).toBe(false);
    expect(hint).toHaveBeenCalledTimes(1);
    expect(quit).not.toHaveBeenCalled();
  });

  it('second press within the window lets the quit through', () => {
    const { guard, hint, advance } = make();
    guard.shouldQuit();
    advance(1500);
    expect(guard.shouldQuit()).toBe(true);
    expect(hint).toHaveBeenCalledTimes(1);
  });

  it('a late second press is treated as a new first press', () => {
    const { guard, hint, advance } = make();
    guard.shouldQuit();
    advance(3001);
    expect(guard.shouldQuit()).toBe(false);
    expect(hint).toHaveBeenCalledTimes(2);
  });

  it('forced quit (tray, system shutdown) passes without a hint', () => {
    const { guard, hint } = make();
    guard.force();
    expect(guard.shouldQuit()).toBe(true);
    expect(hint).not.toHaveBeenCalled();
  });

  it('a confirmed quit stays confirmed while the app shuts down', () => {
    const { guard, advance } = make();
    guard.shouldQuit();
    advance(100);
    expect(guard.shouldQuit()).toBe(true);
    advance(10_000);
    expect(guard.shouldQuit()).toBe(true);
  });
});
