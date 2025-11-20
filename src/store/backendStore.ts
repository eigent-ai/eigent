import { create } from 'zustand';

interface BackendState {
  isReady: boolean;
  port: number | null;
  error: string | null;
  isChecking: boolean;

  // Actions
  setReady: (port: number) => void;
  setError: (error: string) => void;
  setChecking: (isChecking: boolean) => void;
  reset: () => void;
}

const initialState = {
  isReady: false,
  port: null,
  error: null,
  isChecking: false,
};

export const useBackendStore = create<BackendState>((set) => ({
  ...initialState,

  setReady: (port: number) =>
    set({
      isReady: true,
      port,
      error: null,
      isChecking: false,
    }),

  setError: (error: string) =>
    set({
      isReady: false,
      error,
      isChecking: false,
    }),

  setChecking: (isChecking: boolean) =>
    set({ isChecking }),

  reset: () => set(initialState),
}));

// Selector hooks for common patterns
export const useBackendReady = () => useBackendStore(state => state.isReady);
export const useBackendPort = () => useBackendStore(state => state.port);
export const useBackendError = () => useBackendStore(state => state.error);
