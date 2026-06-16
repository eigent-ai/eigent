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

import { InstallDependencies } from '@/components/InstallStep/InstallDependencies';
import TopBar from '@/components/TopBar';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useInstallationSetup } from '@/hooks/useInstallationSetup';
import { useHost } from '@/host';
import { useAuthStore } from '@/store/authStore';
import { useInstallationUI } from '@/store/installationStore';
import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import CloseNoticeDialog from '../Dialog/CloseNotice';
import HistorySidebar from '../HistorySidebar';
import InstallationErrorDialog from '../InstallStep/InstallationErrorDialog/InstallationErrorDialog';

const Layout = () => {
  const host = useHost();
  const {
    initState,
    isFirstLaunch,
    onboardingCompleted,
    setInitState: _setInitState,
  } = useAuthStore();
  const [noticeOpen, setNoticeOpen] = useState(false);

  //Get Chatstore for the active project's task
  const { chatStore } = useChatStoreAdapter();

  const {
    installationState,
    latestLog,
    error,
    backendError,
    isInstalling,
    isBackendReady,
    shouldShowInstallScreen,
    retryInstallation,
    retryBackend,
  } = useInstallationUI();

  useInstallationSetup();

  useEffect(() => {
    if (!host?.ipcRenderer || !host?.electronAPI) return;

    const handleBeforeClose = () => {
      const currentStatus = chatStore?.activeTaskId
        ? chatStore.tasks[chatStore.activeTaskId]?.status
        : undefined;
      if (currentStatus && ['running', 'pause'].includes(currentStatus)) {
        setNoticeOpen(true);
      } else {
        host.electronAPI.closeWindow(true);
      }
    };

    host.ipcRenderer.on('before-close', handleBeforeClose);
    return () => {
      host.ipcRenderer?.removeAllListeners('before-close');
    };
  }, [chatStore, host]);

  // Show install screen if: installation UI is active, user hasn't finished setup,
  // or backend hasn't passed health check yet.
  // isBackendReady defaults to false on each app launch (non-persisted),
  // so the main UI is gated until health check passes — no race condition.
  // Also wait for first-launch onboarding to be completed before showing main UI.
  const actualShouldShowInstallScreen =
    shouldShowInstallScreen ||
    initState !== 'done' ||
    !isBackendReady ||
    (isFirstLaunch && !onboardingCompleted);
  const shouldShowMainContent = !actualShouldShowInstallScreen;

  return (
    <div className="bg-ds-bg-neutral-muted-default relative flex h-full flex-col overflow-hidden">
      <div
        className={
          actualShouldShowInstallScreen
            ? 'pointer-events-none select-none'
            : undefined
        }
      >
        <TopBar />
      </div>
      <div className="min-h-0 relative h-full flex-1 overflow-hidden">
        {/* Installation screen */}
        {actualShouldShowInstallScreen && <InstallDependencies />}

        {/* Main app content */}
        {shouldShowMainContent && (
          <>
            <Outlet />
            <HistorySidebar />
          </>
        )}

        {(backendError || (error && installationState === 'error')) && (
          <InstallationErrorDialog
            error={error || ''}
            backendError={backendError}
            installationState={installationState}
            latestLog={latestLog}
            retryInstallation={retryInstallation}
            retryBackend={retryBackend}
          />
        )}

        <CloseNoticeDialog onOpenChange={setNoticeOpen} open={noticeOpen} />
      </div>
    </div>
  );
};

export default Layout;
