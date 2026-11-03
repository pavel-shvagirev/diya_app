import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const created: Array<{
  options: Record<string, unknown>;
  url?: string;
  destroyed: boolean;
  shown: boolean;
  once: Record<string, () => void>;
}> = [];

vi.mock('electron', () => {
  class BrowserWindow {
    meta: (typeof created)[number];
    constructor(options: Record<string, unknown>) {
      this.meta = { options, destroyed: false, shown: false, once: {} };
      created.push(this.meta);
    }
    setIgnoreMouseEvents = vi.fn();
    loadURL = (u: string) => {
      this.meta.url = u;
      return Promise.resolve();
    };
    once = (ev: string, cb: () => void) => {
      this.meta.once[ev] = cb;
    };
    showInactive = () => {
      this.meta.shown = true;
    };
    isDestroyed = () => this.meta.destroyed;
    destroy = () => {
      this.meta.destroyed = true;
    };
  }
  return {
    BrowserWindow,
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1000, height: 800 } }),
    },
  };
});

import { hideHint, showHint } from '../../src/main/hint-window.js';

describe('hint window', () => {
  beforeEach(() => {
    created.length = 0;
    vi.useFakeTimers();
  });
  afterEach(() => {
    hideHint();
    vi.useRealTimers();
  });

  it('opens a small frameless always-on-top window that does not take focus', () => {
    showHint('Press Cmd+Q again');
    const w = created[0]!;
    expect(w.options).toMatchObject({
      frame: false,
      alwaysOnTop: true,
      focusable: false,
      show: false,
      width: 360,
    });
    expect((w.options.webPreferences as Record<string, unknown>).nodeIntegration).toBe(false);
    expect(w.options.x).toBe(320); // centred on the work area
    w.once['ready-to-show']!();
    expect(w.shown).toBe(true);
  });

  it('escapes the text so it cannot inject markup', () => {
    showHint('<img src=x onerror=alert(1)> & "q"');
    const html = decodeURIComponent(created[0]!.url!.split(',')[1]!);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot;');
  });

  it('closes itself after the delay; showing again replaces the old one', () => {
    showHint('one', 1000);
    showHint('two', 1000);
    expect(created[0]!.destroyed).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(created[1]!.destroyed).toBe(true);
    hideHint(); // nothing left to close
  });
});
