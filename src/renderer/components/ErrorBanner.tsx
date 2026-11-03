import { t } from '../lib/strings.js';
import type { ReactElement } from 'react';

/** One dismissible error line (used by the toasts). */
export function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss?: () => void;
}): ReactElement | null {
  if (!message) return null;
  return (
    <div role="alert" className="banner banner--error">
      <span className="banner__text">{message}</span>
      {onDismiss && (
        <button
          className="btn btn--icon"
          aria-label={t.dismiss}
          title={t.dismiss}
          onClick={onDismiss}
        >
          ✕
        </button>
      )}
    </div>
  );
}
