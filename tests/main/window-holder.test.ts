import { EventEmitter } from 'events';

import { describe, expect, it, vi } from 'vitest';

import { createWindowHolder } from '../../src/main/window-holder.js';

class FakeWin extends EventEmitter {
  destroyed = false;
  loading = true;
  minimized = false;
  shown = 0;
  focused = 0;
  restored = 0;
  sent: Array<[string, unknown]> = [];
  webContents = {
    isLoading: () => this.loading,
    once: (ev: string, cb: () => void) => this.once(`wc:${ev}`, cb),
    send: (ch: string, payload?: unknown) => {
      if (this.destroyed) throw new TypeError('Object has been destroyed');
      this.sent.push([ch, payload]);
    },
  };
  isDestroyed = () => this.destroyed;
  isMinimized = () => this.minimized;
  restore = () => void this.restored++;
  show = () => {
    if (this.destroyed) throw new TypeError('Object has been destroyed');
    this.shown++;
  };
  focus = () => void this.focused++;
  finishLoad = () => {
    this.loading = false;
    this.emit('wc:did-finish-load');
  };
  destroy = () => {
    this.destroyed = true;
    this.emit('closed');
  };
}

const setup = () => {
  const made: FakeWin[] = [];
  const onCreated = vi.fn();
  const holder = createWindowHolder<FakeWin>({
    create: () => {
      const w = new FakeWin();
      made.push(w);
      return w;
    },
    onCreated,
  });
  return { holder, made, onCreated };
};

describe('window holder (tray must survive a closed window)', () => {
  it('show() creates the window on first use and wires it', () => {
    const { holder, made, onCreated } = setup();
    holder.show();
    expect(made).toHaveLength(1);
    expect(onCreated).toHaveBeenCalledWith(made[0]);
    expect(made[0]!.shown).toBe(1);
    expect(made[0]!.focused).toBe(1);
  });

  it('after the window was closed, show() creates a new one instead of touching the dead object', () => {
    const { holder, made, onCreated } = setup();
    holder.show();
    made[0]!.destroy(); // Cmd+W
    expect(holder.get()).toBeNull();
    expect(() => holder.show()).not.toThrow(); // used to: "Object has been destroyed"
    expect(made).toHaveLength(2);
    expect(onCreated).toHaveBeenCalledTimes(2);
    expect(made[1]!.shown).toBe(1);
  });

  it('restores a minimized window and reuses a live one', () => {
    const { holder, made } = setup();
    holder.show();
    made[0]!.minimized = true;
    holder.show();
    expect(made).toHaveLength(1);
    expect(made[0]!.restored).toBe(1);
  });

  it('send() is dropped silently when there is no window and never throws on a dead one', () => {
    const { holder, made } = setup();
    expect(() => holder.send('x')).not.toThrow();
    expect(made).toHaveLength(0);
    holder.show();
    made[0]!.destroyed = true; // destroyed but 'closed' not delivered yet
    expect(() => holder.send('x')).not.toThrow();
  });

  it('showAndSend() waits for a freshly created window to finish loading', () => {
    const { holder, made } = setup();
    holder.showAndSend('ui:open-settings');
    expect(made[0]!.sent).toEqual([]);
    made[0]!.finishLoad();
    expect(made[0]!.sent).toEqual([['ui:open-settings', undefined]]);
  });

  it('showAndSend() sends at once to a loaded window', () => {
    const { holder, made } = setup();
    holder.show();
    made[0]!.loading = false;
    holder.showAndSend('ui:open-settings', 1);
    expect(made[0]!.sent).toEqual([['ui:open-settings', 1]]);
  });
});
