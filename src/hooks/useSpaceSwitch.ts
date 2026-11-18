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
import {
  beginSpaceSwitch,
  cancelPendingSpaceSwitch,
  useSpaceSwitchStore,
} from '@/store/spaceSwitchStore';
import { useCallback } from 'react';
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
  /**
   * Load the Session before returning. Pass `false` when the caller opens it
   * with `openSessionInShell` next, which shows the Session while it loads.
   */
  hydrate?: boolean;
}

/**
 * Make a Space active and open one of its Sessions. Shared by the rail, the
 * pinned-Space shortcuts, Home and the composer's Space chip. Resolves `false`
 * when the switch failed or a newer move replaced it.
 */
export function useSpaceSwitch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const switchingSpaceId = useSpaceSwitchStore(
    (state) => state.switchingSpaceId
  );
  const closeSettings = useSettingsStore((state) => state.closeSettings);

  const switchToSpace = useCallback(
    async (
      spaceId: string,
      {
        project = 'last',
        tab = WorkspaceTab.Workforce,
        hydrate = true,
      }: SwitchToSpaceOptions = {}
    ) => {
      const projectStore = useProjectRuntimeStore.getState();
      const pageTabs = usePageTabStore.getState();
      const sequence = beginSpaceSwitch(spaceId);
      const replaced = () =>
        useSpaceSwitchStore.getState().sequence !== sequence;
      try {
        const resolvedSpaceId = await resolveServerBackedSpaceId(
          projectStore,
          spaceId
        );
        if (replaced()) return false;
        const spaceStore = useSpaceStore.getState();
        // Only choosing among the Space's Sessions needs the latest list.
        // Otherwise `setActiveSpace` refreshes it in the background.
        const needsSessionList =
          project === 'last' ||
          (project !== null &&
            !spaceStore
              .getProjectsForSpace(resolvedSpaceId)
              .some((meta) => meta.id === project));
        if (
          resolvedSpaceId.startsWith('legacy_') ||
          (needsSessionList && spaceStore.shouldSyncProjects(resolvedSpaceId))
        ) {
          await spaceStore.syncProjectsFromServer(resolvedSpaceId);
          if (replaced()) return false;
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
          if (hydrate) {
            await ensureProjectRuntimeLoaded(projectStore, targetProject.id, {
              requireActiveSelection: true,
            });
            if (replaced()) return false;
          }
        } else {
          projectStore.setActiveProject(null);
        }
        if (tab) pageTabs.setActiveWorkspaceTab(tab);
        pageTabs.requestWorkspaceChatFocus();
        return true;
      } catch (error) {
        if (replaced()) return false;
        console.error('Failed to switch Space:', error);
        toast.error(t('layout.spaces-switch-failed'), {
          closeButton: true,
        });
        return false;
      } finally {
        if (!replaced()) {
          useSpaceSwitchStore.setState({ switchingSpaceId: null });
        }
      }
    },
    [t]
  );

  /**
   * Open a Space's view. The active Space keeps its Session and tab; any
   * other Space becomes active and opens on New session.
   */
  const openSpaceView = useCallback(
    (spaceId: string) => {
      void runAfterWorkspaceConfigurationSave(async () => {
        if (useSpaceStore.getState().activeSpaceId !== spaceId) {
          const switched = await switchToSpace(spaceId, {
            project: null,
            tab: WorkspaceTab.NewProject,
          });
          if (!switched) return;
        } else {
          cancelPendingSpaceSwitch();
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
