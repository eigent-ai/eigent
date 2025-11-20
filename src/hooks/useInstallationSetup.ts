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
  const isInstalling = useRef(false); // Prevent concurrent installations

  // Track installation and backend readiness
  const installationCompleted = useRef(false);
  const backendReady = useRef(false);

  // Extract only the functions we need to avoid dependency issues
  const startInstallation = useInstallationStore(state => state.startInstallation);
  const performInstallation = useInstallationStore(state => state.performInstallation);
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
          if (result.success) {
            // REMOVED: Don't automatically set to 'done' even if tools are installed
            // We need to wait for proper installation complete + backend ready events
            // if (result.isInstalled && initState === "carousel") {
            //   console.log('[useInstallationSetup] Tools installed but initState is carousel, setting to done');
            //   setInitState("done");
            // }

            if (!result.isInstalled && initState === "permissions") {
              // If tools are NOT installed and we're in permissions state, set to carousel
              console.log('[useInstallationSetup] Tools not installed and initState is permissions, setting to carousel');
              setInitState("carousel");
            }
          }
        }
        return result;
      } catch (error) {
        console.error("[useInstallationSetup] Tool installation check failed:", error);
        return { success: false, error };
      }
    };

    const checkBackendStatus = async(toolResult?: any) => {
      try {
        // Also check if installation is currently in progress
        const installationStatus = await window.electronAPI.getInstallationStatus();

        if (installationStatus.success && installationStatus.isInstalling) {
          startInstallation();
        } else if (initState !== 'done' && toolResult) {
          // Use the tool result from the previous check to avoid duplicate API calls
          if (toolResult.success && !toolResult.isInstalled && !isInstalling.current) {
             console.log('[useInstallationSetup] Tools missing and not installing. Starting installation...');
             isInstalling.current = true; // Set flag to prevent concurrent installations
             try {
               await performInstallation();
             } catch (installError) {
               console.error('[useInstallationSetup] Installation failed:', installError);
             } finally {
               isInstalling.current = false;
             }
          }
        }
      } catch (err) {
        console.error('[useInstallationSetup] Failed to check installation status:', err);
      }
    }

    // Run checks sequentially to avoid race conditions and duplicate API calls
    const runInitialChecks = async () => {
      const toolResult = await checkToolInstalled();
      await checkBackendStatus(toolResult);
    };

    runInitialChecks();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Setup Electron IPC listeners (only once)
  useEffect(() => {
    // Helper function to check if both conditions are met
    const checkAndSetDone = () => {
      console.log('[useInstallationSetup] Checking readiness - Installation:', installationCompleted.current, 'Backend:', backendReady.current);

      if (installationCompleted.current && backendReady.current) {
        console.log('[useInstallationSetup] Both installation and backend are ready, setting initState to done');
        setInitState('done');
      }
    };

    // Electron IPC event handlers
    const handleInstallStart = () => {
      if (!isInstalling.current) {
        isInstalling.current = true;
        // Reset states when installation starts
        installationCompleted.current = false;
        backendReady.current = false;
        startInstallation();
      }
    };

    const handleInstallLog = (data: { type: string; data: string }) => {
      addLog({
        type: data.type as 'stdout' | 'stderr',
        data: data.data,
        timestamp: new Date(),
      });
    };

    const handleInstallComplete = (data: { success: boolean; code?: number; error?: string }) => {
      console.log('[useInstallationSetup] Installation complete event received:', data);
      isInstalling.current = false;

      if (data.success) {
        setSuccess();
        installationCompleted.current = true;
        console.log('[useInstallationSetup] Installation marked as completed');
        // Check if we can transition to done
        checkAndSetDone();
      } else {
        setError(data.error || 'Installation failed');
      }
    };

    const handleBackendReady = (data: { success: boolean; port?: number; error?: string }) => {
      console.log('[useInstallationSetup] Backend ready event received:', data);

      if (data.success && data.port) {
        backendReady.current = true;
        console.log('[useInstallationSetup] Backend marked as ready on port:', data.port);
        // Check if we can transition to done
        checkAndSetDone();
      } else {
        console.error('[useInstallationSetup] Backend failed to start:', data.error);
        setError(data.error || 'Backend startup failed');
      }
    };

    // Register Electron IPC listeners
    window.electronAPI.onInstallDependenciesStart(handleInstallStart);
    window.electronAPI.onInstallDependenciesLog(handleInstallLog);
    window.electronAPI.onInstallDependenciesComplete(handleInstallComplete);
    window.electronAPI.onBackendReady(handleBackendReady);

    // Cleanup listeners on unmount
    return () => {
      window.electronAPI.removeAllListeners('install-dependencies-start');
      window.electronAPI.removeAllListeners('install-dependencies-log');
      window.electronAPI.removeAllListeners('install-dependencies-complete');
      window.electronAPI.removeAllListeners('backend-ready');
    };
  }, [startInstallation, addLog, setSuccess, setError, setInitState]);
};