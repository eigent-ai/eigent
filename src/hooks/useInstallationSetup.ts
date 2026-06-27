// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

import { checkBackendHealth, resetBaseURL } from '@/api/http';
import { useHost } from '@/host';
import { useAuthStore } from '@/store/authStore';
import {
  getConnectionConfig,
  resetConnectionConfig,
  setConnectionConfig,
} from '@/store/connectionStore';
import { useInstallationStore } from '@/store/installationStore';
import { getSkillsStore } from '@/store/skillsStore';
import { useCallback, useEffect, useRef } from 'react';

/**
 * Hook that sets up Electron IPC listeners and handles installation state synchronization.
 * In Web mode (no Electron): polls Brain health via VITE_BRAIN_ENDPOINT, skips local install.
 */
export const useInstallationSetup = () => {
  const host = useHost();
  const { initState, setInitState, email, user_id } = useAuthStore();

  const hasCheckedOnMount = useRef(false);
  const installationCompleted = useRef(false);
  const backendReady = useRef(false);
  const syncedSkillsConfigKey = useRef<string | null>(null);
  const startInstallation = useInstallationStore(
    (state) => state.startInstallation
  );
  const _performInstallation = useInstallationStore(
    (state) => state.performInstallation
  );
  const addLog = useInstallationStore((state) => state.addLog);
  const setSuccess = useInstallationStore((state) => state.setSuccess);
  const setError = useInstallationStore((state) => state.setError);
  const setBackendError = useInstallationStore(
    (state) => state.setBackendError
  );
  const setWaitingBackend = useInstallationStore(
    (state) => state.setWaitingBackend
  );
  const needsBackendRestart = useInstallationStore(
    (state) => state.needsBackendRestart
  );
  const setNeedsBackendRestart = useInstallationStore(
    (state) => state.setNeedsBackendRestart
  );

  const syncSkillsConfigOnOpen = useCallback(async () => {
    const currentAuth = useAuthStore.getState();
    if (currentAuth.user_id === null || currentAuth.user_id === undefined) {
      return;
    }

    const endpoint = getConnectionConfig().brainEndpoint;
    if (!endpoint) return;

    const syncKey = `${currentAuth.user_id}:${endpoint}`;
    if (syncedSkillsConfigKey.current === syncKey) return;

    try {
      await getSkillsStore().syncFromDisk();
      syncedSkillsConfigKey.current = syncKey;
      console.log(
        `[useInstallationSetup] Skills config synced for user ${currentAuth.user_id}`
      );
    } catch (error) {
      console.warn(
        '[useInstallationSetup] Failed to sync skills config on open:',
        error
      );
    }
  }, []);

  // Shared function to poll backend/Brain status
  const startBackendPolling = useCallback(() => {
    console.log('[useInstallationSetup] Starting backend polling');

    const checkViaHealth = async (): Promise<boolean> => {
      try {
        const ok = await checkBackendHealth();
        if (ok) {
          backendReady.current = true;
          setSuccess();
          setInitState('done');
          setNeedsBackendRestart(false);
          void syncSkillsConfigOnOpen();
          return true;
        }
      } catch (e) {
        console.log('[useInstallationSetup] Health check failed:', e);
      }
      return false;
    };

    // Electron: use getBackendPort + localhost health
    const checkElectronBackend = async (): Promise<boolean> => {
      if (!host?.electronAPI?.getBackendPort) return false;
      try {
        const backendPort = await host.electronAPI.getBackendPort();
        if (backendPort && backendPort > 0) {
          const backendEndpoint = `http://localhost:${backendPort}`;
          const response = await fetch(`${backendEndpoint}/health`).catch(
            () => null
          );
          if (response?.ok) {
            setConnectionConfig({ brainEndpoint: backendEndpoint });
            backendReady.current = true;
            setSuccess();
            setInitState('done');
            setNeedsBackendRestart(false);
            void syncSkillsConfigOnOpen();
            return true;
          }
        }
      } catch (e) {
        console.log('[useInstallationSetup] Electron backend check failed:', e);
      }
      return false;
    };

    const hasDesktop = !!(host?.electronAPI && host?.ipcRenderer);
    const doCheck = hasDesktop ? checkElectronBackend : checkViaHealth;

    doCheck().then((isReady) => {
      if (isReady) {
        console.log('[useInstallationSetup] Backend ready, skipping polling');
        return;
      }
      console.log('[useInstallationSetup] Backend not ready, starting polling');
      const pollInterval = setInterval(() => {
        doCheck().then((ready) => {
          if (ready) clearInterval(pollInterval);
        });
      }, 2000);
      setTimeout(() => clearInterval(pollInterval), 30000);
    });
  }, [
    setSuccess,
    setInitState,
    setNeedsBackendRestart,
    host,
    syncSkillsConfigOnOpen,
  ]);

  // Monitor for backend restart after logout
  useEffect(() => {
    // When user logs in after logout, needsBackendRestart will be true
    if (needsBackendRestart && email !== null) {
      console.log(
        '[useInstallationSetup] Detected login after logout, waiting for backend restart'
      );

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
    if (backendReady.current && user_id !== null && user_id !== undefined) {
      void syncSkillsConfigOnOpen();
    }
  }, [user_id, syncSkillsConfigOnOpen]);

  useEffect(() => {
    if (hasCheckedOnMount.current) {
      return;
    }

    hasCheckedOnMount.current = true;

    // Web mode: skip Electron install, poll Brain health directly
    if (!host?.electronAPI || !host?.ipcRenderer) {
      console.log('[useInstallationSetup] Web mode: polling Brain health');
      installationCompleted.current = true;
      setWaitingBackend();
      startBackendPolling();
      return;
    }

    const checkToolInstalled = async () => {
      if (!host?.ipcRenderer) return { success: false };
      try {
        const result = await host.ipcRenderer.invoke('check-tool-installed');

        if (result.success) {
          if (result.isInstalled) {
            console.log(
              '[useInstallationSetup] Tools already installed, waiting for backend'
            );
            installationCompleted.current = true;
            setWaitingBackend();
            startBackendPolling();
          }

          if (initState !== 'done' && !result.isInstalled) {
            console.log(
              '[useInstallationSetup] Tools not installed, ensuring carousel state'
            );
            setInitState('carousel');
          }
        }
        return result;
      } catch (error) {
        console.error(
          '[useInstallationSetup] Tool installation check failed:',
          error
        );
        return { success: false, error };
      }
    };

    const checkBackendStatus = async (_toolResult?: any) => {
      if (!host?.electronAPI?.getInstallationStatus) return;
      try {
        const installationStatus =
          await host.electronAPI.getInstallationStatus();

        if (installationStatus.success && installationStatus.isInstalling) {
          startInstallation();
        }
      } catch (err) {
        console.error(
          '[useInstallationSetup] Failed to check installation status:',
          err
        );
      }
    };

    const runInitialChecks = async () => {
      const toolResult = await checkToolInstalled();
      await checkBackendStatus(toolResult);
    };

    runInitialChecks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const checkAndSetDone = () => {
      console.log(
        '[useInstallationSetup] Checking readiness - Installation:',
        installationCompleted.current,
        'Backend:',
        backendReady.current
      );

      if (installationCompleted.current && backendReady.current) {
        console.log(
          '[useInstallationSetup] Both installation and backend are ready, setting initState to done'
        );
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

    const handleInstallComplete = (data: {
      success: boolean;
      code?: number;
      error?: string;
    }) => {
      console.log(
        '[useInstallationSetup] Installation complete event received:',
        data
      );

      if (data.success) {
        installationCompleted.current = true;
        console.log('[useInstallationSetup] Installation marked as completed');

        // setSuccess() will be called in handleBackendReady to prevent premature state change
        checkAndSetDone();
      } else {
        setError(data.error || 'Installation failed');
      }
    };

    const handleBackendReady = (data: {
      success: boolean;
      port?: number;
      error?: string;
    }) => {
      console.log('[useInstallationSetup] Backend ready event received:', data);

      if (data.success && data.port) {
        // Reset cached baseURL so next getBaseURL fetches fresh port (handles restart)
        resetBaseURL();
        resetConnectionConfig();
        setConnectionConfig({ brainEndpoint: `http://localhost:${data.port}` });
        console.log(
          `[useInstallationSetup] Backend is ready on port ${data.port}`
        );
        backendReady.current = true;
        // If backend is ready, installation must be complete (or satisfied enough)
        // This handles race condition where install-complete event is missed or skipped
        if (!installationCompleted.current) {
          console.log(
            '[useInstallationSetup] Backend ready implies installation complete - setting flag'
          );
          installationCompleted.current = true;
        }
        console.log('[useInstallationSetup] Backend marked as ready');

        setSuccess();
        setNeedsBackendRestart(false);
        void syncSkillsConfigOnOpen();
        checkAndSetDone();
      } else {
        console.error(
          '[useInstallationSetup] Backend failed to start:',
          data.error
        );
        setBackendError(data.error || 'Backend startup failed');
      }
    };

    if (!host?.electronAPI) return;

    host.electronAPI.onInstallDependenciesStart(handleInstallStart);
    host.electronAPI.onInstallDependenciesLog(handleInstallLog);
    host.electronAPI.onInstallDependenciesComplete(handleInstallComplete);
    host.electronAPI.onBackendReady(handleBackendReady);

    return () => {
      host.electronAPI.removeAllListeners('install-dependencies-start');
      host.electronAPI.removeAllListeners('install-dependencies-log');
      host.electronAPI.removeAllListeners('install-dependencies-complete');
      host.electronAPI.removeAllListeners('backend-ready');
    };
  }, [
    host,
    startInstallation,
    addLog,
    setSuccess,
    setError,
    setBackendError,
    setInitState,
    setNeedsBackendRestart,
    syncSkillsConfigOnOpen,
  ]);
};
