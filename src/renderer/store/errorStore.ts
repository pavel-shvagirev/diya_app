/**
 * Zustand store for global error management.
 *
 * @module errorStore
 */

import { create } from 'zustand';

export interface ErrorItem {
  id: string;
  message: string;
  timestamp: number;
  dismissible: boolean;
}

interface ErrorState {
  errors: ErrorItem[];
  addError: (message: string, dismissible?: boolean) => void;
  dismissError: (id: string) => void;
  clearErrors: () => void;
}

let errorIdCounter = 0;

export const useErrorStore = create<ErrorState>(set => ({
  errors: [],

  addError: (message: string, dismissible = true) => {
    set(state => ({
      errors: [
        ...state.errors,
        {
          id: `err-${++errorIdCounter}`,
          message,
          timestamp: Date.now(),
          dismissible,
        },
      ],
    }));
  },

  dismissError: (id: string) => {
    set(state => ({
      errors: state.errors.filter(e => e.id !== id),
    }));
  },

  clearErrors: () => {
    set({ errors: [] });
  },
}));
