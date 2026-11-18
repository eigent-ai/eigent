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

import type { SpaceDetailTab } from '@/components/Home/SpaceDetailTabsNav';
import { useAppCommand } from '@/components/Layout/AppCommandProvider';
import { useSpaceSwitch } from '@/hooks/useSpaceSwitch';
import { openSessionInShell } from '@/lib/sessionOpen';
import { isHomePagePath, shellBackState } from '@/lib/shellRoutes';
import { runAfterWorkspaceConfigurationSave } from '@/lib/workspaceConfigurationNavigationGuard';
import { APP_COMMAND } from '@/shared/appCommands';
import { usePageTabStore, WorkspaceTab } from '@/store/pageTabStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useSpaceStore } from '@/store/spaceStore';
import { cancelPendingSpaceSwitch } from '@/store/spaceSwitchStore';
import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/** The Workspace page of a Space in Home, optionally on one tab. */
export function homeSpaceSearch(spaceId: string, tab?: SpaceDetailTab): string {
  const params = new URLSearchParams({ section: 'spaces', spaceId });
  if (tab) params.set('spaceTab', tab);
  return `?${params.toString()}`;
}

/**
 * Moves within Home. Every action keeps Home the selected place: a Session
 * from any Space opens next to the Home sidebar, and that Space becomes
 * active first.
 */
export function useHomeNavigation() {
  const navigate = useNavigate();
  const location = useLocation();
  const executeAppCommand = useAppCommand();
  const closeSettings = useSettingsStore((state) => state.closeSettings);
  const { switchToSpace } = useSpaceSwitch();

  /** `/home` pages. Leaving `/` keeps the Workspace subtree (and drafts). */
  const openHomePage = useCallback(
    (search: string) => {
      void runAfterWorkspaceConfigurationSave(() => {
        closeSettings();
        navigate(
          { pathname: '/home', search },
          {
            state: isHomePagePath(location.pathname)
              ? location.state
              : shellBackState(`${location.pathname}${location.search}`),
          }
        );
      });
    },
    [
      closeSettings,
      location.pathname,
      location.search,
      location.state,
      navigate,
    ]
  );

  const openAllSpaces = useCallback(
    () => openHomePage('?section=spaces'),
    [openHomePage]
  );

  const openSpaceWorkspace = useCallback(
    (spaceId: string, tab?: SpaceDetailTab) =>
      openHomePage(homeSpaceSearch(spaceId, tab)),
    [openHomePage]
  );

  const openNewSession = useCallback(() => {
    usePageTabStore.getState().setShellPlace('home');
    executeAppCommand(APP_COMMAND.newProject);
  }, [executeAppCommand]);

  const openSession = useCallback(
    (projectId: string) => {
      void runAfterWorkspaceConfigurationSave(async () => {
        const spaceId = useSpaceStore.getState().projectIdIndex[projectId];
        if (spaceId && spaceId !== useSpaceStore.getState().activeSpaceId) {
          // The Session decides the tab, so leave it to `openSessionInShell`.
          const switched = await switchToSpace(spaceId, {
            project: projectId,
            tab: null,
            hydrate: false,
          });
          if (!switched) return;
        } else {
          cancelPendingSpaceSwitch();
        }
        closeSettings();
        usePageTabStore.getState().setShellPlace('home');
        if (location.pathname !== '/') navigate('/');
        // The sync during a switch may show this Session is gone.
        if (!useSpaceStore.getState().getProjectMeta(projectId)) {
          usePageTabStore
            .getState()
            .setActiveWorkspaceTab(WorkspaceTab.NewProject);
          return;
        }
        await openSessionInShell(projectId);
      });
    },
    [closeSettings, location.pathname, navigate, switchToSpace]
  );

  return {
    openAllSpaces,
    openSpaceWorkspace,
    openNewSession,
    openSession,
  };
}
