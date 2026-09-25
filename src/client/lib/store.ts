import { useSyncExternalStore } from 'react';
import type { ClientView } from '../../shared/protocol';

export interface Toast { id: number; text: string; level: 'info' | 'warn' | 'success' | 'error' }

export interface AppState {
  view: ClientView | null;
  connection: 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';
  closedReason: string | null;
  clockOffset: number;
  toasts: Toast[];
  pendingCount: number;
}

const state: AppState = { view: null, connection: 'idle', closedReason: null, clockOffset: 0, toasts: [], pendingCount: 0 };
const listeners = new Set<() => void>();
let snapshot: AppState = { ...state };

function emit(): void {
  snapshot = { ...state };
  for (const l of listeners) l();
}

export const store = {
  get: () => snapshot,
  setView(view: ClientView | null) {
    state.view = view;
    if (view) state.clockOffset = view.serverNow - Date.now();
    emit();
  },
  setConnection(c: AppState['connection'], reason: string | null = null) {
    state.connection = c;
    state.closedReason = reason;
    emit();
  },
  setPending(n: number) { state.pendingCount = n; emit(); },
  toast(text: string, level: Toast['level'] = 'info') {
    const id = Date.now() + Math.random();
    state.toasts = [...state.toasts, { id, text, level }].slice(-4);
    emit();
    setTimeout(() => { state.toasts = state.toasts.filter((t) => t.id !== id); emit(); }, level === 'error' ? 5000 : 3500);
  },
  reset() {
    state.view = null; state.connection = 'idle'; state.closedReason = null; state.pendingCount = 0;
    emit();
  },
};

export function useAppState(): AppState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, store.get, store.get);
}

export function serverNow(): number {
  return Date.now() + snapshot.clockOffset;
}
