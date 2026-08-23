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
import { useDesktopUpdater } from '@/hooks/useDesktopUpdater';
import { useInstallationSetup } from '@/hooks/useInstallationSetup';
import { useHost } from '@/host';
import { isSettingsRoutePath, shellBackState } from '@/lib/shellRoutes';
import { runAfterWorkspaceConfigurationSave } from '@/lib/workspaceConfigurationNavigationGuard';
import { useAuthStore } from '@/store/authStore';
import { useInstallationUI } from '@/store/installationStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useSpaceStore } from '@/store/spaceStore';
import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import InstallationErrorDialog from '../InstallStep/InstallationErrorDialog/InstallationErrorDialog';

/**
 * Settings used to be a modal, and `openSettings(section)` is still the
 * call every feature uses to jump into a section. Settings is now a page in
 * the app shell, so translate that request into a route change and clear the
 * flag; `activeSection` stays in the store and drives the page.
 */
export function SettingsRouteBridge() {
  const navigate = useNavigate();
  const location = useLocation();
  const isOpen = useSettingsStore((state) => state.isOpen);
  const activeSection = useSettingsStore((state) => state.activeSection);
  const closeSettings = useSettingsStore((state) => state.closeSettings);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const routeRequest = runAfterWorkspaceConfigurationSave(() => {
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
      // Record the origin so the route layout can retain Workspace state while
      // the full-page Home / Settings surface is active.
      navigate(`/home?section=settings&tab=${activeSection}`, {
        state: shellBackState(`${location.pathname}${location.search}`),
      });
    });
    void routeRequest.then((completed) => {
      // A rejected guarded save keeps the user on the editor. Clear this
      // consumed request so invoking Settings again produces a fresh edge and
      // retries the guard instead of leaving `isOpen` permanently sticky.
      if (!completed && !cancelled) closeSettings();
    });

    return () => {
      cancelled = true;
    };
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
  const { projectStore } = useChatStoreAdapter();
  const {
    initState,
    isFirstLaunch,
    onboardingCompleted,
    setInitState: _setInitState,
  } = useAuthStore();
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
  useDesktopUpdater();

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
    <div className="relative flex h-full flex-col overflow-hidden bg-ds-neutral-strong-default">
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
      </div>
    </div>
  );
};

export default Layout;
