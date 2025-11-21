import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

// Define all possible installation states
export type InstallationState =
  | 'idle'
  | 'checking-permissions'
  | 'showing-carousel'
  | 'installing'
  | 'waiting-backend'  // New state: tools installed, waiting for backend to be ready
  | 'error'
  | 'completed';

// Installation log entry
export interface InstallationLog {
  type: 'stdout' | 'stderr';
  data: string;
  timestamp: Date;
}

// Installation store state
interface InstallationStoreState {
  // Core state
  state: InstallationState;
  progress: number;
  logs: InstallationLog[];
  error?: string;
  backendError?: string;  // Separate error for backend startup failures
  isVisible: boolean;
  needsBackendRestart: boolean;  // Flag to indicate backend is restarting after logout

  // Actions
  startInstallation: () => void;
  addLog: (log: InstallationLog) => void;
  setSuccess: () => void;
  setError: (error: string) => void;
  setBackendError: (error: string) => void;
  setWaitingBackend: () => void;
  setNeedsBackendRestart: (needs: boolean) => void;
  retryInstallation: () => void;
  retryBackend: () => Promise<void>;
  completeSetup: () => void;
  updateProgress: (progress: number) => void;
  setVisible: (visible: boolean) => void;
  reset: () => void;

  // Async actions
  performInstallation: () => Promise<void>;
  exportLog: () => Promise<void>;
}

// Initial state
const initialState = {
  state: 'idle' as InstallationState,
  progress: 20,
  logs: [] as InstallationLog[],
  error: undefined,
  backendError: undefined,
  isVisible: false,
  needsBackendRestart: false,
};

// Create the installation store
export const useInstallationStore = create<InstallationStoreState>()(
  subscribeWithSelector(
    (set, get) => ({
      // Initial state
      ...initialState,
      
      // Basic actions
      startInstallation: () => 
        set({
          state: 'installing',
          progress: 20,
          logs: [],
          error: undefined,
          isVisible: true,
        }),
      
      addLog: (log: InstallationLog) =>
        set((state) => {
          const newProgress = Math.min(state.progress + 5, 90);
          return {
            logs: [...state.logs, log],
            progress: newProgress,
          };
        }),
      
      setSuccess: () =>
        set({
          state: 'completed',
          progress: 100,
        }),
      
      setError: (error: string) =>
        set((state) => ({
          state: 'error',
          error,
          logs: [
            ...state.logs,
            {
              type: 'stderr',
              data: error,
              timestamp: new Date(),
            },
          ],
        })),

      setWaitingBackend: () =>
        set({
          state: 'waiting-backend',
          progress: 80,
          isVisible: true,
        }),

      setNeedsBackendRestart: (needs: boolean) =>
        set({
          needsBackendRestart: needs,
        }),

      setBackendError: (error: string) =>
        set({
          backendError: error,
          state: 'error',
        }),

      retryInstallation: () => {
        set({
          ...initialState,
          isVisible: true,
          state: 'installing',
        });
        get().performInstallation();
      },

      retryBackend: async () => {
        try {
          // Clear backend error and go back to waiting-backend state
          set({
            backendError: undefined,
            state: 'waiting-backend',
            progress: 80,
          });

          // Call restart-backend via electronAPI
          const result = await window.electronAPI.restartBackend();

          if (!result.success) {
            set({
              backendError: result.error || 'Failed to restart backend',
              state: 'error',
            });
          }
        } catch (error) {
          set({
            backendError: error instanceof Error ? error.message : 'Unknown error',
            state: 'error',
          });
        }
      },

      completeSetup: () =>
        set({
          state: 'completed',
          isVisible: false,
        }),
      
      updateProgress: (progress: number) =>
        set({ progress }),
      
      setVisible: (visible: boolean) =>
        set({ isVisible: visible }),
      
      reset: () =>
        set(initialState),
      
      // Async actions
      performInstallation: async () => {
        const { startInstallation, setSuccess, setError } = get();

        try {
          startInstallation();
          const result = await window.electronAPI.checkAndInstallDepsOnUpdate();

          if (result.success) {
            // initState will be set to 'done' by useInstallationSetup after both installation and backend are ready
            setSuccess();
          } else {
            setError('Installation failed');
          }
        } catch (error) {
          setError(error instanceof Error ? error.message : 'Unknown error');
        }
      },
      
      exportLog: async () => {
        try {
          const response = await window.electronAPI.exportLog();
          
          if (!response.success) {
            alert('Export cancelled: ' + response.error);
            return;
          }
          
          if (response.savedPath) {
            window.location.href = 'https://github.com/eigent-ai/eigent/issues/new/choose';
            alert('Log saved: ' + response.savedPath);
          }
        } catch (e: any) {
          alert('Export error: ' + e.message);
        }
      },
    })
  )
);

// Computed selectors
export const useLatestLog = () => useInstallationStore(state => 
  state.logs[state.logs.length - 1]
);

export const useInstallationActions = () => useInstallationStore(state => ({
  startInstallation: state.startInstallation,
  retryInstallation: state.retryInstallation,
  completeSetup: state.completeSetup,
  performInstallation: state.performInstallation,
  exportLog: state.exportLog,
}));

// Combined hook for components that need multiple pieces of state
export const useInstallationStatus = () => {
  const state = useInstallationStore(state => state.state);
  const isVisible = useInstallationStore(state => state.isVisible);
  
  return {
    isInstalling: state === 'installing',
    installationState: state,
    shouldShowInstallScreen: isVisible && state !== 'completed',
    isInstallationComplete: state === 'completed',
    canRetry: state === 'error',
  };
};

// Hook for the main installation UI component
export const useInstallationUI = () => {
  const state = useInstallationStore(state => state.state);
  const progress = useInstallationStore(state => state.progress);
  const logs = useInstallationStore(state => state.logs);
  const error = useInstallationStore(state => state.error);
  const backendError = useInstallationStore(state => state.backendError);
  const isVisible = useInstallationStore(state => state.isVisible);
  const performInstallation = useInstallationStore(state => state.performInstallation);
  const retryInstallation = useInstallationStore(state => state.retryInstallation);
  const retryBackend = useInstallationStore(state => state.retryBackend);
  const exportLog = useInstallationStore(state => state.exportLog);

  return {
    installationState: state,
    progress,
    latestLog: logs[logs.length - 1],
    error,
    backendError,
    isInstalling: state === 'installing',
    shouldShowInstallScreen: isVisible && state !== 'completed',
    canRetry: state === 'error',
    performInstallation,
    retryInstallation,
    retryBackend,
    exportLog,
  };
};