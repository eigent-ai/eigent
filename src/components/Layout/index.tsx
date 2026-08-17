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
import { shellBackState } from '@/hooks/useShellBackTarget';
import { useHost } from '@/host';
import { isSettingsRoutePath } from '@/lib/shellRoutes';
import { useAuthStore } from '@/store/authStore';
import { hasAnyActiveRun } from '@/store/chatStore';
import { useInstallationUI } from '@/store/installationStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useSpaceStore } from '@/store/spaceStore';
import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import CloseNoticeDialog from '../Dialog/CloseNotice';
import InstallationErrorDialog from '../InstallStep/InstallationErrorDialog/InstallationErrorDialog';

/**
 * Settings used to be a modal, and `openSettings(section)` is still the
 * call every feature uses to jump into a section. Settings is now a page in
 * the app shell, so translate that request into a route change and clear the
 * flag; `activeSection` stays in the store and drives the page.
 */
function SettingsRouteBridge() {
  const navigate = useNavigate();
  const location = useLocation();
  const isOpen = useSettingsStore((state) => state.isOpen);
  const activeSection = useSettingsStore((state) => state.activeSection);
  const closeSettings = useSettingsStore((state) => state.closeSettings);

  useEffect(() => {
    if (!isOpen) return;
    closeSettings();
    if (isSettingsRoutePath(location.pathname)) {
      const searchParams = new URLSearchParams(location.search);
      if (
        searchParams.get('section') !== 'settings' ||
        searchParams.get('tab') !== activeSection
      ) {
        navigate(`/home?section=settings&tab=${activeSection}`, {
          replace: true,
          state: location.state,
        });
      }
      return;
    }
    // Record where the user came from so the title-bar back button returns there.
    navigate(`/home?section=settings&tab=${activeSection}`, {
      state: shellBackState(`${location.pathname}${location.search}`),
    });
  }, [
    closeSettings,
    activeSection,
    isOpen,
    location.pathname,
    location.search,
    location.state,
    navigate,
  ]);

  return null;
}

const Layout = () => {
  const host = useHost();
  const location = useLocation();
  const { chatStore, projectStore } = useChatStoreAdapter();
  const {
    initState,
    isFirstLaunch,
    onboardingCompleted,
    setInitState: _setInitState,
  } = useAuthStore();
  const [noticeOpen, setNoticeOpen] = useState(false);
  const activeWorkspaceRoot = useSpaceStore((state) => {
    const projectSpaceId = projectStore.activeProjectId
      ? state.projectIdIndex[projectStore.activeProjectId]
      : null;
    const activeSpaceId = projectSpaceId || state.activeSpaceId;
    return activeSpaceId ? state.spaces[activeSpaceId]?.rootPath || null : null;
  });

  const {
    installationState,
    latestLog,
    error,
    backendError,
    isBackendReady,
    shouldShowInstallScreen,
    retryInstallation,
    retryBackend,
  } = useInstallationUI();

  useInstallationSetup();

  useEffect(() => {
    if (!host?.ipcRenderer?.invoke) return;
    void host.ipcRenderer
      .invoke(
        'set-local-file-preview-roots',
        activeWorkspaceRoot ? [activeWorkspaceRoot] : []
      )
      .catch((error: unknown) => {
        console.warn(
          '[Layout] Failed to register the active workspace preview root:',
          error
        );
      });
  }, [activeWorkspaceRoot, host]);

  useEffect(() => {
    if (!host?.ipcRenderer || !host?.electronAPI) return;

    const handleBeforeClose = () => {
      // Closing the window severs every run's SSE stream and the backend
      // aborts the in-flight work, so check all Projects' live runs --
      // checking only the active task missed runs streaming in other
      // Projects and let the window close without any warning.
      const currentStatus = chatStore?.activeTaskId
        ? chatStore.tasks[chatStore.activeTaskId]?.status
        : undefined;
      const activeTaskBusy = Boolean(
        currentStatus && ['running', 'pause'].includes(currentStatus)
      );
      if (activeTaskBusy || hasAnyActiveRun()) {
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
  const showTopBar =
    location.pathname === '/' || isSettingsRoutePath(location.pathname);

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-ds-bg-neutral-strong-default">
      <div
        className={
          actualShouldShowInstallScreen
            ? 'pointer-events-none select-none'
            : undefined
        }
      >
        {showTopBar ? <TopBar /> : null}
      </div>
      <SettingsRouteBridge />
      <div className="relative h-full min-h-0 flex-1 overflow-hidden">
        {/* Installation screen */}
        {actualShouldShowInstallScreen && <InstallDependencies />}

        {/* Main app content */}
        {shouldShowMainContent && <Outlet />}

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
