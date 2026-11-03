import { useEffect, type ReactElement } from 'react';

import { useErrorStore, type ErrorItem } from '../store/errorStore.js';
import { ErrorBanner } from './ErrorBanner.js';

const AUTO_DISMISS_MS = 8000;

function Toast({ item }: { item: ErrorItem }): ReactElement {
  const dismiss = useErrorStore(s => s.dismissError);
  useEffect(() => {
    const id = setTimeout(() => dismiss(item.id), AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, [item.id, dismiss]);
  return <ErrorBanner message={item.message} onDismiss={() => dismiss(item.id)} />;
}

/** Transient error notifications, bottom-right. */
export function Toasts(): ReactElement | null {
  const errors = useErrorStore(s => s.errors);
  if (errors.length === 0) return null;
  return (
    <div className="toasts">
      {errors.slice(-4).map(e => (
        <Toast key={e.id} item={e} />
      ))}
    </div>
  );
}
