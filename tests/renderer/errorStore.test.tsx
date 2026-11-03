import { describe, it, expect, vi } from 'vitest';

describe('errorStore', () => {
  it('exports useErrorStore with correct interface', async () => {
    const { useErrorStore } = await import('../../src/renderer/store/errorStore.js');
    expect(useErrorStore).toBeDefined();
    expect(typeof useErrorStore).toBe('function');
  });

  it('has addError, dismissError, clearErrors methods', async () => {
    const { useErrorStore } = await import('../../src/renderer/store/errorStore.js');
    const state = useErrorStore.getState();
    expect(typeof state.addError).toBe('function');
    expect(typeof state.dismissError).toBe('function');
    expect(typeof state.clearErrors).toBe('function');
  });
});
