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

import animationData from '@/assets/animation/onboarding_success.json';
import { AnimationJson } from '@/components/AnimationJson';
import { InstallDependencies } from '@/components/InstallStep/InstallDependencies';
import TopBar from '@/components/TopBar';
import { useAuthHydration } from '@/hooks/useAuthHydration';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useInstallationSetup } from '@/hooks/useInstallationSetup';
import { useAuthStore } from '@/store/authStore';
import { useInstallationUI } from '@/store/installationStore';
import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import CloseNoticeDialog from '../Dialog/CloseNotice';
import HistorySidebar from '../HistorySidebar';
import InstallationErrorDialog from '../InstallStep/InstallationErrorDialog/InstallationErrorDialog';

const Layout = () => {
  const hasHydrated = useAuthHydration();
  const {
    initState,
    isFirstLaunch,
    setIsFirstLaunch,
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
    shouldShowInstallScreen,
    retryInstallation,
    retryBackend,
  } = useInstallationUI();

  useInstallationSetup();

  useEffect(() => {
    if (!chatStore) return;

    const handleBeforeClose = () => {
      const currentStatus =
        chatStore.tasks[chatStore.activeTaskId as string]?.status;
      if (['running', 'pause'].includes(currentStatus)) {
        setNoticeOpen(true);
      } else {
        window.electronAPI.closeWindow(true);
      }
    };

    window.ipcRenderer.on('before-close', handleBeforeClose);

    return () => {
      window.ipcRenderer.removeAllListeners('before-close');
    };
  }, [chatStore, chatStore?.tasks, chatStore?.activeTaskId]);

  // Determine what to show based on states
  const shouldShowOnboarding =
    initState === 'done' && isFirstLaunch && !isInstalling;

  const actualShouldShowInstallScreen =
    shouldShowInstallScreen ||
    initState !== 'done' ||
    installationState === 'waiting-backend';
  const shouldShowMainContent = !actualShouldShowInstallScreen;

  // Wait for auth store hydration so initState/isFirstLaunch are correct
  // and we don't briefly show install/onboarding then switch to main content
  if (!hasHydrated || !chatStore) {
    if (!chatStore) console.log(chatStore);
    return <div>Loading...</div>;
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <TopBar />
      <div className="relative h-full min-h-0 flex-1 overflow-hidden">
        {/* Onboarding animation */}
        {shouldShowOnboarding && (
          <AnimationJson
            onComplete={() => setIsFirstLaunch(false)}
            animationData={animationData}
          />
        )}

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
