import { useEffect, useRef } from 'react';
import { useInstallationStore } from '@/store/installationStore';
import { useAuthStore } from '@/store/authStore';

/**
 * Hook that sets up Electron IPC listeners and handles installation state synchronization
 * This should be called once in your App component or Layout component
 */
export const useInstallationSetup = () => {
  const { initState, setInitState } = useAuthStore();

  // Use ref to track if initial check is done to prevent repeated checks
  const hasCheckedOnMount = useRef(false);

  // Extract only the functions we need to avoid dependency issues
  const startInstallation = useInstallationStore(state => state.startInstallation);
  const addLog = useInstallationStore(state => state.addLog);
  const setSuccess = useInstallationStore(state => state.setSuccess);
  const setError = useInstallationStore(state => state.setError);

  // Check tool installation status on mount - but only during setup phase
  useEffect(() => {
    // Only run this check once on initial mount
    if (hasCheckedOnMount.current) {
      return;
    }

    hasCheckedOnMount.current = true;

    const checkToolInstalled = async () => {
      try {
        const result = await window.ipcRenderer.invoke("check-tool-installed");


        // Only perform tool check during setup phase (permissions or carousel)
        // Once user is in 'done' state (main app), don't check again
        // This prevents unexpected navigation away from the main app
        if (initState !== 'done') {
          // If tools ARE installed and we're in carousel state, go to done
          if (result.success && initState === "carousel" && result.isInstalled) {
            setInitState("done");
          }
        }
      } catch (error) {
        console.error("[useInstallationSetup] Tool installation check failed:", error);
      }
    };

    const checkBackendStatus = async() => {
      try {
        // Also check if installation is currently in progress
        const installationStatus = await window.electronAPI.getInstallationStatus();

        if (installationStatus.success && installationStatus.isInstalling) {
          startInstallation();
        }
      } catch (err) {
        console.error('[useInstallationSetup] Failed to check installation status:', err);
      }
    }

    checkToolInstalled();
    checkBackendStatus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Setup Electron IPC listeners (only once)
  useEffect(() => {
    // Electron IPC event handlers
    const handleInstallStart = () => {
      startInstallation();
    };

    const handleInstallLog = (data: { type: string; data: string }) => {
      addLog({
        type: data.type as 'stdout' | 'stderr',
        data: data.data,
        timestamp: new Date(),
      });
    };

    const handleInstallComplete = (data: { success: boolean; code?: number; error?: string }) => {
      
      if (data.success) {
        setSuccess();
        setInitState('done');
      } else {
        setError(data.error || 'Installation failed');
      }
    };

    // Register Electron IPC listeners
    window.electronAPI.onInstallDependenciesStart(handleInstallStart);
    window.electronAPI.onInstallDependenciesLog(handleInstallLog);
    window.electronAPI.onInstallDependenciesComplete(handleInstallComplete);


    // Cleanup listeners on unmount
    return () => {
      window.electronAPI.removeAllListeners('install-dependencies-start');
      window.electronAPI.removeAllListeners('install-dependencies-log');
      window.electronAPI.removeAllListeners('install-dependencies-complete');
    };
  }, [startInstallation, addLog, setSuccess, setError, setInitState]);
};