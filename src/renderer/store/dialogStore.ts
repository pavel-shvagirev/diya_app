/**
 * Promise-based modal dialogs (prompt / confirm / folder picker / share link).
 *
 * @module dialogStore
 */
import { create } from 'zustand';

export type DialogRequest =
  | {
      kind: 'prompt';
      title: string;
      label: string;
      initial: string;
      submit: string;
      /** Returns an error message to show, or null if the value is acceptable. */
      validate?: (value: string) => string | null;
      resolve: (v: string | null) => void;
    }
  | {
      kind: 'confirm';
      title: string;
      message: string;
      danger: boolean;
      submit: string;
      resolve: (v: boolean) => void;
    }
  | {
      kind: 'folder';
      title: string;
      submit: string;
      initial: string;
      resolve: (v: string | null) => void;
    }
  | { kind: 'share'; path: string; url: string; resolve: (v: 'unshare' | null) => void };

interface DialogState {
  current: DialogRequest | null;
  show: (d: DialogRequest) => void;
  close: () => void;
}

export const useDialogStore = create<DialogState>(set => ({
  current: null,
  show: d => set({ current: d }),
  close: () => set({ current: null }),
}));

type Distribute<T> = T extends unknown ? Omit<T, 'resolve'> : never;

function ask<R>(make: (resolve: (v: R) => void) => DialogRequest): Promise<R> {
  return new Promise<R>(resolve => {
    useDialogStore.getState().show(make(resolve));
  });
}

export const dialogs = {
  prompt: (o: Omit<Distribute<Extract<DialogRequest, { kind: 'prompt' }>>, 'kind'>) =>
    ask<string | null>(resolve => ({ kind: 'prompt', ...o, resolve })),
  confirm: (o: Omit<Distribute<Extract<DialogRequest, { kind: 'confirm' }>>, 'kind'>) =>
    ask<boolean>(resolve => ({ kind: 'confirm', ...o, resolve })),
  pickFolder: (o: Omit<Distribute<Extract<DialogRequest, { kind: 'folder' }>>, 'kind'>) =>
    ask<string | null>(resolve => ({ kind: 'folder', ...o, resolve })),
  share: (o: Omit<Distribute<Extract<DialogRequest, { kind: 'share' }>>, 'kind'>) =>
    ask<'unshare' | null>(resolve => ({ kind: 'share', ...o, resolve })),
};
