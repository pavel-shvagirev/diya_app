import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ContextMenu, type MenuItem } from '../../src/renderer/ui/ContextMenu.js';

afterEach(cleanup);

function open(items: MenuItem[] = [{ label: 'Open', onClick: vi.fn() }]) {
  const onClose = vi.fn();
  render(
    <div>
      <p>outside</p>
      <ContextMenu x={10} y={10} items={items} onClose={onClose} />
    </div>
  );
  return onClose;
}

describe('ContextMenu', () => {
  it('runs the item and closes', () => {
    const onClick = vi.fn();
    const onClose = open([{ label: 'Open', onClick }]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not run a disabled item', () => {
    const onClick = vi.fn();
    open([{ label: 'Open', onClick, disabled: true }]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('closes on Escape but not on other keys', () => {
    const onClose = open();
    fireEvent.keyDown(window, { key: 'a' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a click outside, not on a click inside', () => {
    const onClose = open();
    fireEvent.mouseDown(screen.getByRole('menuitem', { name: 'Open' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByText('outside'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each(['blur', 'resize', 'wheel'])('closes on window %s', type => {
    const onClose = open();
    fireEvent(window, new Event(type));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stops listening after it is removed', () => {
    const onClose = vi.fn();
    const { unmount } = render(<ContextMenu x={1} y={1} items={[]} onClose={onClose} />);
    unmount();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('draws separators and keeps the menu inside the window', () => {
    open([{ label: 'A', onClick: vi.fn() }, 'sep', { label: 'B', onClick: vi.fn(), danger: true }]);
    expect(screen.getByRole('separator')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'B' }).className).toContain('--danger');
    expect(screen.getByRole('menu').getAttribute('style')).toContain('left');
  });
});
