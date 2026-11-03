/**
 * Small UI-only state (settings dialog, tree width).
 *
 * @module uiStore
 */
import { create } from 'zustand';

interface UiState {
  settingsOpen: boolean;
  treeWidth: number;
  openSettings: () => void;
  closeSettings: () => void;
  setTreeWidth: (w: number) => void;
}

export const MIN_TREE = 160;
export const MAX_TREE = 520;

export const useUiStore = create<UiState>(set => ({
  settingsOpen: false,
  treeWidth: 260,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  setTreeWidth: w => set({ treeWidth: Math.max(MIN_TREE, Math.min(MAX_TREE, Math.round(w))) }),
}));
