import { useEffect, useState, type ReactElement } from 'react';

import { t } from '../lib/strings.js';

/** Shown under the toolbar while the system reports no network. */
export function OfflineBanner({ onRetry }: { onRetry?: () => void }): ReactElement | null {
  const [online, setOnline] = useState<boolean>(navigator.onLine);

  useEffect(() => {
    const up = (): void => setOnline(true);
    const down = (): void => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  if (online) return null;
  return (
    <div role="status" className="banner banner--offline">
      <span className="banner__text">⚠ {t.offline}</span>
      {onRetry && (
        <button className="btn btn--outline" onClick={onRetry}>
          {t.retry}
        </button>
      )}
    </div>
  );
}
