import { describe, expect, it, vi } from 'vitest';

import { attachQuitKey, isQuitKey, type KeyInput } from '../../src/main/quit-key.js';

const key = (o: Partial<KeyInput>): KeyInput => ({ type: 'keyDown', key: 'q', ...o });

describe('isQuitKey', () => {
  it('is Cmd+Q on macOS and Ctrl+Q elsewhere', () => {
    expect(isQuitKey(key({ meta: true }), 'darwin')).toBe(true);
    expect(isQuitKey(key({ control: true }), 'darwin')).toBe(false);
    expect(isQuitKey(key({ control: true }), 'win32')).toBe(true);
    expect(isQuitKey(key({ control: true }), 'linux')).toBe(true);
    expect(isQuitKey(key({ meta: true }), 'win32')).toBe(false);
  });

  it('ignores other keys, key releases and extra modifiers; accepts a capital Q', () => {
    expect(isQuitKey(key({ meta: true, key: 'w' }), 'darwin')).toBe(false);
    expect(isQuitKey(key({ meta: true, type: 'keyUp' }), 'darwin')).toBe(false);
    expect(isQuitKey(key({ meta: true, shift: true }), 'darwin')).toBe(false);
    expect(isQuitKey(key({ meta: true, alt: true }), 'darwin')).toBe(false);
    expect(isQuitKey(key({ meta: true, key: 'Q' }), 'darwin')).toBe(true);
  });
});

describe('attachQuitKey', () => {
  const setup = () => {
    let handler: (e: { preventDefault: () => void }, i: KeyInput) => void = () => undefined;
    attachQuitKey({ on: (_ev, cb) => (handler = cb) }, onQuit);
    return (input: KeyInput) => {
      const event = { preventDefault: vi.fn() };
      handler(event, input);
      return event;
    };
  };
  const onQuit = vi.fn();

  it('takes the shortcut away from the menu and calls the guarded quit', () => {
    onQuit.mockClear();
    const send = setup();
    const quitInput = key(process.platform === 'darwin' ? { meta: true } : { control: true });
    const event = send(quitInput);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(onQuit).toHaveBeenCalledTimes(1);
  });

  it('leaves every other key alone', () => {
    onQuit.mockClear();
    const send = setup();
    const event = send(key({ key: 'a' }));
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onQuit).not.toHaveBeenCalled();
  });
});
