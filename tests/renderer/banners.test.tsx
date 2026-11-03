import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ErrorBanner } from '../../src/renderer/components/ErrorBanner.js';
import { OfflineBanner } from '../../src/renderer/components/OfflineBanner.js';
import { Toasts } from '../../src/renderer/components/Toasts.js';
import { t } from '../../src/renderer/lib/strings.js';
import { useErrorStore } from '../../src/renderer/store/errorStore.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useErrorStore.getState().clearErrors();
});

describe('ErrorBanner', () => {
  it('renders nothing without a message; shows the text and a dismiss button', () => {
    const { container, rerender } = render(<ErrorBanner message="" />);
    expect(container).toBeEmptyDOMElement();
    const onDismiss = vi.fn();
    rerender(<ErrorBanner message="Disk full" onDismiss={onDismiss} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Disk full');
    fireEvent.click(screen.getByLabelText(t.dismiss));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('has no dismiss button when nothing can be dismissed', () => {
    render(<ErrorBanner message="x" />);
    expect(screen.queryByLabelText(t.dismiss)).toBeNull();
  });
});

describe('OfflineBanner', () => {
  it('appears on the offline event, offers a retry, and goes away when back online', () => {
    const retry = vi.fn();
    render(<OfflineBanner onRetry={retry} />);
    expect(screen.queryByRole('status')).toBeNull();
    act(() => window.dispatchEvent(new Event('offline')));
    expect(screen.getByRole('status')).toHaveTextContent(t.offline);
    fireEvent.click(screen.getByText(t.retry));
    expect(retry).toHaveBeenCalled();
    act(() => window.dispatchEvent(new Event('online')));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('starts offline when the system already is, and works without a retry handler', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    render(<OfflineBanner />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText(t.retry)).toBeNull();
    vi.restoreAllMocks();
  });

  it('stops listening when unmounted', () => {
    const spy = vi.spyOn(window, 'removeEventListener');
    render(<OfflineBanner />).unmount();
    expect(spy).toHaveBeenCalledWith('offline', expect.any(Function));
    spy.mockRestore();
  });
});

describe('Toasts', () => {
  it('shows nothing without errors, keeps the last four, and dismisses on click', () => {
    const { container } = render(<Toasts />);
    expect(container).toBeEmptyDOMElement();
    act(() => {
      for (let i = 1; i <= 6; i++) useErrorStore.getState().addError(`e${i}`);
    });
    expect(screen.getAllByRole('alert').map(a => a.textContent?.replace('✕', ''))).toEqual([
      'e3',
      'e4',
      'e5',
      'e6',
    ]);
    fireEvent.click(screen.getAllByLabelText(t.dismiss)[0]!);
    expect(useErrorStore.getState().errors).toHaveLength(5);
  });

  it('dismisses a toast by itself after 8 seconds', () => {
    vi.useFakeTimers();
    render(<Toasts />);
    act(() => useErrorStore.getState().addError('temp'));
    expect(screen.getByText('temp')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(8001);
    });
    expect(screen.queryByText('temp')).toBeNull();
  });
});
