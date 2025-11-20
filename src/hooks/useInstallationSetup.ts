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

  // Track installation and backend readiness states
  const installationCompleted = useRef(false);
  const backendReady = useRef(false);

  // Extract only the functions we need to avoid dependency issues
  const startInstallation = useInstallationStore(state => state.startInstallation);
  const performInstallation = useInstallationStore(state => state.performInstallation);
  const addLog = useInstallationStore(state => state.addLog);
  const setSuccess = useInstallationStore(state => state.setSuccess);
  const setError = useInstallationStore(state => state.setError);
  const setWaitingBackend = useInstallationStore(state => state.setWaitingBackend);

  // REMOVED: Don't reset initState from 'done' to 'carousel'
  // Instead, we'll use installationState to control visibility in Layout component
  // When tools are already installed, we set installationState to 'waiting-backend'
  // which will show progress bar + text without showing carousel slides

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

        if (result.success) {
          // If tools are already installed, mark installation as completed
          // This handles the app restart scenario where tools were installed previously
          if (result.isInstalled) {
            console.log('[useInstallationSetup] Tools already installed, waiting for backend');
            installationCompleted.current = true;
            setWaitingBackend(); // Show "waiting for backend" state (progress bar + text, no carousel)
          }

          // Only perform state transitions during setup phase (permissions or carousel)
          // Once user is in 'done' state (main app), don't change initState
          if (initState !== 'done') {
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
          if (toolResult.success && !toolResult.isInstalled) {
             console.log('[useInstallationSetup] Tools missing and not installing. Starting installation...');
             try {
               await performInstallation();
             } catch (installError) {
               console.error('[useInstallationSetup] Installation failed:', installError);
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
    // Helper function to check if both installation and backend are ready
    const checkAndSetDone = () => {
      console.log('[useInstallationSetup] Checking readiness - Installation:', installationCompleted.current, 'Backend:', backendReady.current);

      if (installationCompleted.current && backendReady.current) {
        console.log('[useInstallationSetup] Both installation and backend are ready, setting initState to done');
        setInitState('done');
      }
    };

    // Electron IPC event handlers
    const handleInstallStart = () => {
      // Reset flags when installation starts
      installationCompleted.current = false;
      backendReady.current = false;
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
      console.log('[useInstallationSetup] Installation complete event received:', data);

      if (data.success) {
        installationCompleted.current = true;
        console.log('[useInstallationSetup] Installation marked as completed');

        // Don't call setSuccess() yet if we're still waiting for backend
        // setSuccess() will be called in handleBackendReady when backend is ready
        // This prevents installationState from changing from 'waiting-backend' to 'completed' prematurely

        // Only set initState to done if backend is also ready
        checkAndSetDone();
      } else {
        setError(data.error || 'Installation failed');
      }
    };

    const handleBackendReady = (data: { success: boolean; port?: number; error?: string }) => {
      console.log('[useInstallationSetup] Backend ready event received:', data);

      if (data.success && data.port) {
        console.log(`[useInstallationSetup] Backend is ready on port ${data.port}`);
        backendReady.current = true;
        console.log('[useInstallationSetup] Backend marked as ready');

        // Mark installation as completed (changes state from 'waiting-backend' to 'completed')
        setSuccess();

        // Only set initState to done if installation is also completed
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