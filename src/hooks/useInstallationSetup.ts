import { useEffect, useRef, useCallback } from 'react';
import { useInstallationStore } from '@/store/installationStore';
import { useAuthStore } from '@/store/authStore';

/**
 * Hook that sets up Electron IPC listeners and handles installation state synchronization
 * This should be called once in your App component or Layout component
 */
export const useInstallationSetup = () => {
  const { initState, setInitState, email } = useAuthStore();

  const hasCheckedOnMount = useRef(false);
  const installationCompleted = useRef(false);
  const backendReady = useRef(false);
  const startInstallation = useInstallationStore(state => state.startInstallation);
  const performInstallation = useInstallationStore(state => state.performInstallation);
  const addLog = useInstallationStore(state => state.addLog);
  const setSuccess = useInstallationStore(state => state.setSuccess);
  const setError = useInstallationStore(state => state.setError);
  const setBackendError = useInstallationStore(state => state.setBackendError);
  const setWaitingBackend = useInstallationStore(state => state.setWaitingBackend);
  const needsBackendRestart = useInstallationStore(state => state.needsBackendRestart);
  const setNeedsBackendRestart = useInstallationStore(state => state.setNeedsBackendRestart);

  // Shared function to poll backend status
  const startBackendPolling = useCallback(() => {
    console.log('[useInstallationSetup] Starting backend polling');

    // Immediately check backend status once
    const checkBackendStatus = async () => {
      try {
        const backendPort = await window.electronAPI.getBackendPort();
        if (backendPort && backendPort > 0) {
          console.log('[useInstallationSetup] Backend immediately detected on port:', backendPort);

          // Verify backend is actually responding
          const response = await fetch(`http://localhost:${backendPort}/health`).catch(() => null);
          if (response && response.ok) {
            console.log('[useInstallationSetup] Backend health check passed immediately');
            backendReady.current = true;
            setSuccess();
            setInitState('done');
            setNeedsBackendRestart(false);
            return true; // Backend is ready, no need to poll
          }
        }
      } catch (error) {
        console.log('[useInstallationSetup] Initial backend check failed:', error);
      }
      return false; // Backend not ready, need to poll
    };

    // Check immediately, then start polling if needed
    checkBackendStatus().then((isReady) => {
      if (isReady) {
        console.log('[useInstallationSetup] Backend already ready, skipping polling');
        return;
      }

      console.log('[useInstallationSetup] Backend not ready, starting polling');

      // Poll backend status every 2 seconds to ensure we catch when it's ready
      // This is a fallback in case the backend-ready event is missed
      const pollInterval = setInterval(async () => {
        try {
          const backendPort = await window.electronAPI.getBackendPort();
          if (backendPort && backendPort > 0) {
            console.log('[useInstallationSetup] Backend poll detected ready on port:', backendPort);

            // Verify backend is actually responding
            const response = await fetch(`http://localhost:${backendPort}/health`).catch(() => null);
            if (response && response.ok) {
              console.log('[useInstallationSetup] Backend health check passed');
              clearInterval(pollInterval);

              if (!backendReady.current) {
                backendReady.current = true;
                setSuccess();
                setInitState('done');
                // Clear the flag after backend is ready
                setNeedsBackendRestart(false);
              }
            }
          }
        } catch (error) {
          console.log('[useInstallationSetup] Backend poll check failed:', error);
        }
      }, 2000);

      // Clear polling after 30 seconds to prevent infinite polling
      setTimeout(() => {
        clearInterval(pollInterval);
      }, 30000);
    });
  }, [setSuccess, setInitState, setNeedsBackendRestart]);

  // Monitor for backend restart after logout
  useEffect(() => {
    // When user logs in after logout, needsBackendRestart will be true
    if (needsBackendRestart && email !== null) {
      console.log('[useInstallationSetup] Detected login after logout, waiting for backend restart');

      // For account switching, tools are already installed, only backend needs restart
      // So we mark installation as completed and only wait for backend
      installationCompleted.current = true;
      backendReady.current = false;

      // Set to waiting-backend state
      setWaitingBackend();

      // Start polling for backend
      startBackendPolling();
    }
  }, [needsBackendRestart, email, setWaitingBackend, startBackendPolling]);


  useEffect(() => {
    if (hasCheckedOnMount.current) {
      return;
    }

    hasCheckedOnMount.current = true;

    const checkToolInstalled = async () => {
      try {
        const result = await window.ipcRenderer.invoke("check-tool-installed");

        if (result.success) {
          if (result.isInstalled) {
            console.log('[useInstallationSetup] Tools already installed, waiting for backend');
            installationCompleted.current = true;
            setWaitingBackend();

            // Start polling for backend when tools are already installed
            startBackendPolling();
          }

          if (initState !== 'done') {
            if (!result.isInstalled && initState === "permissions") {
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
        const installationStatus = await window.electronAPI.getInstallationStatus();

        if (installationStatus.success && installationStatus.isInstalling) {
          startInstallation();
        }
      } catch (err) {
        console.error('[useInstallationSetup] Failed to check installation status:', err);
      }
    }

    const runInitialChecks = async () => {
      const toolResult = await checkToolInstalled();
      await checkBackendStatus(toolResult);
    };

    runInitialChecks();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const checkAndSetDone = () => {
      console.log('[useInstallationSetup] Checking readiness - Installation:', installationCompleted.current, 'Backend:', backendReady.current);

      if (installationCompleted.current && backendReady.current) {
        console.log('[useInstallationSetup] Both installation and backend are ready, setting initState to done');
        setInitState('done');
      }
    };

    const handleInstallStart = () => {
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

        // setSuccess() will be called in handleBackendReady to prevent premature state change
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

        setSuccess();
        checkAndSetDone();
      } else {
        console.error('[useInstallationSetup] Backend failed to start:', data.error);
        setBackendError(data.error || 'Backend startup failed');
      }
    };

    window.electronAPI.onInstallDependenciesStart(handleInstallStart);
    window.electronAPI.onInstallDependenciesLog(handleInstallLog);
    window.electronAPI.onInstallDependenciesComplete(handleInstallComplete);
    window.electronAPI.onBackendReady(handleBackendReady);

    return () => {
      window.electronAPI.removeAllListeners('install-dependencies-start');
      window.electronAPI.removeAllListeners('install-dependencies-log');
      window.electronAPI.removeAllListeners('install-dependencies-complete');
      window.electronAPI.removeAllListeners('backend-ready');
    };
  }, [startInstallation, addLog, setSuccess, setError, setBackendError, setInitState]);
};