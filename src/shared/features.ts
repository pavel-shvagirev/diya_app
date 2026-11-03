/**
 * Feature switches for functions that are turned off until a known problem is fixed.
 * A switched-off function must be unreachable in the UI AND refused in the main process.
 */
export const FEATURES: { publicLinks: boolean } = {
  /**
   * Creating new public links (publish). OFF until Task 24 (confirmation for folders, list of
   * published items). Existing links stay visible and can still be revoked (unpublish).
   */
  publicLinks: false,
};
