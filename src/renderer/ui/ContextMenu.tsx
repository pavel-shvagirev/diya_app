import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';

import { Icon, type IconName } from './Icon.js';

export type MenuItem =
  | { label: string; icon?: IconName; onClick: () => void; danger?: boolean; disabled?: boolean }
  | 'sep';

interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

/** Floating menu at (x, y), kept inside the window; closes on outside click, Esc or scroll. */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - height - 4)),
    });
  }, [x, y]);

  useEffect(() => {
    const close = (e: Event): void => {
      if (e.type === 'mousedown' && ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', close, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('wheel', close, { passive: true });
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', close, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('wheel', close);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="menu" role="menu" style={pos} onContextMenu={e => e.preventDefault()}>
      {items.map((item, i) =>
        item === 'sep' ? (
          <div key={`sep${i}`} className="menu__sep" role="separator" />
        ) : (
          <button
            key={item.label}
            role="menuitem"
            className={item.danger ? 'menu__item menu__item--danger' : 'menu__item'}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onClick();
            }}
          >
            {item.icon && <Icon name={item.icon} />}
            {item.label}
          </button>
        )
      )}
    </div>
  );
}
