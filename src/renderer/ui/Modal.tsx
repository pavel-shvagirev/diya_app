import { useEffect, useRef, type ReactNode, type ReactElement } from 'react';

import { t } from '../lib/strings.js';
import { Icon } from './Icon.js';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

/** Open modals, bottom to top. Esc closes only the last one. */
const stack: symbol[] = [];

/** Centered dialog: Esc and click on the backdrop close it. */
export function Modal({ title, onClose, children, footer, wide }: ModalProps): ReactElement {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const id = Symbol('modal');
    stack.push(id);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && stack[stack.length - 1] === id) {
        e.stopPropagation();
        closeRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      stack.splice(stack.indexOf(id), 1);
    };
  }, []);

  return (
    <div
      className="overlay"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={wide ? 'modal modal--wide' : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal__head">
          <h2>{title}</h2>
          <button className="btn btn--icon" onClick={onClose} aria-label={t.close} title={t.close}>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>
  );
}
