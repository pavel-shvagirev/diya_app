import { vi } from 'vitest';

import type { AppApi } from '../../src/shared/types.js';

export const file = (name: string, extra: Record<string, unknown> = {}) => ({
  type: 'file' as const,
  name,
  path: `/${name}`,
  href: '',
  size: 10,
  modified: '2026-01-01T10:00:00+00:00',
  ...extra,
});
export const dir = (name: string, parent = '') => ({
  type: 'dir' as const,
  name,
  path: `${parent}/${name}`,
  href: '',
  is_folder: true,
});

export const list = (items: unknown[]) => ({
  total: items.length,
  items,
  limit: 0,
  offset: 0,
  href: '',
});

/** Install a fully mocked window.api; returns it for assertions. */
export function installApi(overrides: Partial<Record<keyof AppApi, unknown>> = {}) {
  const api = {
    listFiles: vi.fn().mockResolvedValue(list([])),
    getTrashList: vi.fn().mockResolvedValue(list([])),
    getQuota: vi.fn().mockResolvedValue({ total_space: 100, used_space: 25, trash_size: 0 }),
    mkdir: vi.fn().mockResolvedValue(undefined),
    moveFile: vi.fn().mockResolvedValue(undefined),
    copyFile: vi.fn().mockResolvedValue(undefined),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    deleteFromTrash: vi.fn().mockResolvedValue(undefined),
    restoreFromTrash: vi.fn().mockResolvedValue(undefined),
    emptyTrash: vi.fn().mockResolvedValue(undefined),
    publish: vi.fn().mockResolvedValue('https://yadi.sk/d/1'),
    unpublish: vi.fn().mockResolvedValue(undefined),
    uploadFiles: vi.fn().mockResolvedValue(undefined),
    downloadFiles: vi.fn().mockResolvedValue(true),
    pathForFile: vi.fn((f: { name: string }) => `/local/${f.name}`),
    selectFolder: vi.fn().mockResolvedValue(null),
    getSyncConfig: vi.fn().mockResolvedValue(null),
    getSyncStatus: vi.fn(),
    configureSync: vi.fn().mockResolvedValue(undefined),
    startSync: vi.fn().mockResolvedValue(undefined),
    pauseSync: vi.fn().mockResolvedValue(undefined),
    syncNow: vi.fn().mockResolvedValue(undefined),
    showInFolder: vi.fn().mockResolvedValue(undefined),
    authLogout: vi.fn().mockResolvedValue(undefined),
    languageGet: vi.fn().mockResolvedValue('system'),
    languageSet: vi.fn().mockResolvedValue(undefined),
    openExternal: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  (window as unknown as { api: unknown }).api = api;
  return api as Record<string, ReturnType<typeof vi.fn>>;
}
