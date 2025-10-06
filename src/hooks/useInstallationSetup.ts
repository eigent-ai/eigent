import { useEffect } from 'react';
import { useInstallationStore } from '@/store/installationStore';
import { useAuthStore } from '@/store/authStore';

/**
 * Hook that sets up Electron IPC listeners and handles installation state synchronization
 * This should be called once in your App component or Layout component
 */
export const useInstallationSetup = () => {
  const { initState, setInitState } = useAuthStore();
  
  // Extract only the functions we need to avoid dependency issues
  const startInstallation = useInstallationStore(state => state.startInstallation);
  const addLog = useInstallationStore(state => state.addLog);
  const setSuccess = useInstallationStore(state => state.setSuccess);
  const setError = useInstallationStore(state => state.setError);

  // Check tool installation status on mount
  useEffect(() => {
    const checkToolInstalled = async () => {
      try {
        console.log('[useInstallationSetup] Checking tool installation status...');
        const result = await window.ipcRenderer.invoke("check-tool-installed");

        console.log('[useInstallationSetup] Tool check result:', result, 'initState:', initState);

        // If tools are NOT installed and we're in done state, go back to carousel
        if (result.success && initState === "done" && !result.isInstalled) {
          console.log('[useInstallationSetup] Tool not installed, setting initState to carousel');
          setInitState("carousel");
        }

        // If tools ARE installed and we're in carousel state, go to done
        if (result.success && initState === "carousel" && result.isInstalled) {
          console.log('[useInstallationSetup] Tools installed but initState is carousel, setting to done');
          setInitState("done");
        }
      } catch (error) {
        console.error("[useInstallationSetup] Tool installation check failed:", error);
      }
    };

    const checkBackendStatus = async() => {
      try {
        // Also check if installation is currently in progress
        const installationStatus = await window.electronAPI.getInstallationStatus();
        console.log('[useInstallationSetup] Installation status check:', installationStatus);

        if (installationStatus.success && installationStatus.isInstalling) {
          console.log('[useInstallationSetup] Installation in progress, starting frontend state');
          startInstallation();
        }
      } catch (err) {
        console.error('[useInstallationSetup] Failed to check installation status:', err);
      }
    }

    checkToolInstalled();
    checkBackendStatus();
  }, [initState, setInitState, startInstallation]);

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
      console.log('[useInstallationSetup] Install complete event received:', data);
      
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

    console.log('[useInstallationSetup] Installation listeners registered');

    // Cleanup listeners on unmount
    return () => {
      window.electronAPI.removeAllListeners('install-dependencies-start');
      window.electronAPI.removeAllListeners('install-dependencies-log');
      window.electronAPI.removeAllListeners('install-dependencies-complete');
    };
  }, [startInstallation, addLog, setSuccess, setError, setInitState]);
};