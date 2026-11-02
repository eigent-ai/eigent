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

import { ensureProjectRuntimeLoaded } from '@/lib/projectRuntimeHydration';
import { isSettingsRoutePath, shellBackState } from '@/lib/shellRoutes';
import { resolveServerBackedSpaceId } from '@/lib/spaceProject';
import { runAfterWorkspaceConfigurationSave } from '@/lib/workspaceConfigurationNavigationGuard';
import {
  WorkspaceTab,
  usePageTabStore,
  type WorkspaceTabId,
} from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useSpaceStore } from '@/store/spaceStore';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

export interface SwitchToSpaceOptions {
  /**
   * Which Session to open: the one last visited (the default), a specific
   * Session id, or none.
   */
  project?: 'last' | string | null;
  /**
   * The tab to show afterwards: the composer landing by default, or `null`
   * to leave the tab for the caller to choose.
   */
  tab?: WorkspaceTabId | null;
}

/**
 * Make a Space active and open one of its Sessions. Shared by the rail, the
 * pinned-Space shortcuts, Home and the composer's Space chip.
 */
export function useSpaceSwitch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [switchingSpaceId, setSwitchingSpaceId] = useState<string | null>(null);
  const closeSettings = useSettingsStore((state) => state.closeSettings);

  const switchToSpace = useCallback(
    async (
      spaceId: string,
      {
        project = 'last',
        tab = WorkspaceTab.Workforce,
      }: SwitchToSpaceOptions = {}
    ) => {
      const projectStore = useProjectRuntimeStore.getState();
      const pageTabs = usePageTabStore.getState();
      setSwitchingSpaceId(spaceId);
      try {
        const resolvedSpaceId = await resolveServerBackedSpaceId(
          projectStore,
          spaceId
        );
        const spaceStore = useSpaceStore.getState();
        if (
          resolvedSpaceId.startsWith('legacy_') ||
          spaceStore.shouldSyncProjects(resolvedSpaceId)
        ) {
          await spaceStore.syncProjectsFromServer(resolvedSpaceId);
        }
        const projectsInSpace = useSpaceStore
          .getState()
          .getProjectsForSpace(resolvedSpaceId);
        useSpaceStore.getState().setActiveSpace(resolvedSpaceId);
        const targetProject =
          project === null
            ? undefined
            : project === 'last'
              ? (projectsInSpace.find(
                  (meta) =>
                    meta.id ===
                    spaceStore.lastVisitedProjectBySpace[resolvedSpaceId]
                ) ?? projectsInSpace[0])
              : projectsInSpace.find((meta) => meta.id === project);
        if (targetProject) {
          projectStore.setActiveProject(targetProject.id);
          await ensureProjectRuntimeLoaded(projectStore, targetProject.id, {
            requireActiveSelection: true,
          });
        } else {
          projectStore.setActiveProject(null);
        }
        if (tab) pageTabs.setActiveWorkspaceTab(tab);
        pageTabs.requestWorkspaceChatFocus();
        return true;
      } catch (error) {
        console.error('Failed to switch Space:', error);
        toast.error(t('layout.spaces-create-failed'), {
          closeButton: true,
        });
        return false;
      } finally {
        setSwitchingSpaceId(null);
      }
    },
    [t]
  );

  /**
   * Open a Space's view. The active Space keeps its Session and tab; any
   * other Space becomes active on its last Session first.
   */
  const openSpaceView = useCallback(
    (spaceId: string) => {
      void runAfterWorkspaceConfigurationSave(async () => {
        if (useSpaceStore.getState().activeSpaceId !== spaceId) {
          if (!(await switchToSpace(spaceId))) return;
        }
        closeSettings();
        usePageTabStore.getState().setShellPlace('space');
        navigate('/');
      });
    },
    [closeSettings, navigate, switchToSpace]
  );

  return { switchingSpaceId, switchToSpace, openSpaceView };
}

export type SpaceHomeTab = 'memory' | 'workspace-profile';

/** Open a Space's Memory or Space settings page in Home. */
export function useOpenSpaceHomeTab() {
  const navigate = useNavigate();
  const location = useLocation();
  const closeSettings = useSettingsStore((state) => state.closeSettings);

  return useCallback(
    (spaceId: string, spaceTab: SpaceHomeTab) => {
      void runAfterWorkspaceConfigurationSave(() => {
        useProjectRuntimeStore.getState().setActiveProject(null);
        closeSettings();
        navigate(
          `/home?section=spaces&spaceId=${encodeURIComponent(spaceId)}&spaceTab=${spaceTab}`,
          {
            state: isSettingsRoutePath(location.pathname)
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
}
