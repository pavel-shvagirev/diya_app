/**
 * Manual uploads / downloads in flight, fed by main-process progress events.
 *
 * @module transferStore
 */
import { create } from 'zustand';

import type { TransferEvent } from '../../shared/types.js';

interface TransferState {
  transfers: TransferEvent[];
  apply: (e: TransferEvent) => void;
  clearFinished: () => void;
}

const MAX_KEPT = 50;

export const useTransferStore = create<TransferState>(set => ({
  transfers: [],
  apply: e =>
    set(s => {
      const i = s.transfers.findIndex(t => t.id === e.id);
      const next = i < 0 ? [...s.transfers, e] : s.transfers.map((t, j) => (j === i ? e : t));
      return { transfers: next.slice(-MAX_KEPT) };
    }),
  clearFinished: () => set(s => ({ transfers: s.transfers.filter(t => t.status === 'active') })),
}));
