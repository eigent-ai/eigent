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

import { useSpaceSwitch } from '@/hooks/useSpaceSwitch';
import { openSessionInShell } from '@/lib/sessionOpen';
import { runAfterWorkspaceConfigurationSave } from '@/lib/workspaceConfigurationNavigationGuard';
import {
  usePageTabStore,
  WorkspaceTab,
  type WorkspaceTabId,
} from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSettingsStore } from '@/store/settingsStore';
import {
  useShellHistoryStore,
  type ShellPlaceEntry,
} from '@/store/shellHistoryStore';
import { useSpaceStore } from '@/store/spaceStore';
import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Opening a place changes several stores in a row, some after an await. Wait
 * for them to settle so one move is one history entry.
 */
export const SHELL_HISTORY_SETTLE_MS = 200;

/** Tabs that show one Session, so the place includes which. */
const SESSION_TABS: readonly string[] = [
  'project',
  'files',
  'triggers',
  'runs',
];

function readEntry(path: string, routerState: unknown): ShellPlaceEntry {
  const { shellPlace, activeWorkspaceTab, spaceWorkspaceTab } =
    usePageTabStore.getState();
  const workspaceTab =
    activeWorkspaceTab === WorkspaceTab.Workforce
      ? WorkspaceTab.NewProject
      : activeWorkspaceTab;
  return {
    path,
    routerState,
    shellPlace,
    spaceId: useSpaceStore.getState().activeSpaceId,
    workspaceTab,
    spaceWorkspaceTab,
    projectId: SESSION_TABS.includes(workspaceTab)
      ? useProjectRuntimeStore.getState().activeProjectId
      : null,
  };
}

/** A Space or Session deleted since the visit can't be returned to. */
function canRestore(entry: ShellPlaceEntry): boolean {
  const { spaces, projectIdIndex } = useSpaceStore.getState();
  if (entry.spaceId && !spaces[entry.spaceId]) return false;
  return !entry.projectId || Boolean(projectIdIndex[entry.projectId]);
}

/**
 * Back and Forward for the main window: records each place as people move and
 * restores one on request. Mount it once, in the top bar.
 */
export function useShellHistory() {
  const location = useLocation();
  const navigate = useNavigate();
  const { switchToSpace } = useSpaceSwitch();
  const closeSettings = useSettingsStore((state) => state.closeSettings);
  const canGoBack = useShellHistoryStore((state) => state.index > 0);
  const canGoForward = useShellHistoryStore(
    (state) => state.index < state.entries.length - 1
  );
  const restoring = useRef(false);
  const route = useRef({ path: '', routerState: null as unknown });

  const shellPlace = usePageTabStore((state) => state.shellPlace);
  const workspaceTab = usePageTabStore((state) => state.activeWorkspaceTab);
  const spaceWorkspaceTab = usePageTabStore((state) => state.spaceWorkspaceTab);
  const activeSpaceId = useSpaceStore((state) => state.activeSpaceId);
  const activeProjectId = useProjectRuntimeStore(
    (state) => state.activeProjectId
  );
  const path = `${location.pathname}${location.search}`;
  const routerState = location.state as unknown;

  useEffect(() => {
    route.current = { path, routerState };
  }, [path, routerState]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (restoring.current) return;
      useShellHistoryStore.getState().record(readEntry(path, routerState));
    }, SHELL_HISTORY_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [
    activeProjectId,
    activeSpaceId,
    path,
    routerState,
    shellPlace,
    spaceWorkspaceTab,
    workspaceTab,
  ]);

  const restore = useCallback(
    async (entry: ShellPlaceEntry) => {
      const pages = usePageTabStore.getState();
      closeSettings();
      if (
        entry.spaceId &&
        entry.spaceId !== useSpaceStore.getState().activeSpaceId
      ) {
        const switched = await switchToSpace(entry.spaceId, {
          project: entry.projectId,
          tab: null,
        });
        if (!switched) return;
      }
      if (entry.path === '/') {
        if (entry.workspaceTab === WorkspaceTab.Project && entry.projectId) {
          await openSessionInShell(entry.projectId);
        } else {
          useProjectRuntimeStore.getState().setActiveProject(entry.projectId);
          pages.setSpaceWorkspaceTab(entry.spaceWorkspaceTab);
          pages.setActiveWorkspaceTab(entry.workspaceTab as WorkspaceTabId);
        }
        // Opening a tab can move to the Space view, so the place comes last.
        pages.setShellPlace(entry.shellPlace);
      }
      navigate(entry.path, { state: entry.routerState });
    },
    [closeSettings, navigate, switchToSpace]
  );

  const go = useCallback(
    (delta: -1 | 1) => {
      if (restoring.current) return;
      void runAfterWorkspaceConfigurationSave(async () => {
        const history = useShellHistoryStore.getState();
        // A move still settling would otherwise miss the history.
        history.record(
          readEntry(route.current.path, route.current.routerState)
        );
        // Skip anything deleted since it was visited.
        let entry = history.step(delta);
        while (entry && !canRestore(entry)) entry = history.step(delta);
        if (!entry) return;

        restoring.current = true;
        try {
          await restore(entry);
        } finally {
          // Let the place settle, then keep what actually opened, so a Session
          // that lands elsewhere doesn't count as a new move and clear Forward.
          setTimeout(() => {
            restoring.current = false;
            history.replace(
              readEntry(route.current.path, route.current.routerState)
            );
          }, SHELL_HISTORY_SETTLE_MS * 2);
        }
      });
    },
    [restore]
  );

  return {
    canGoBack,
    canGoForward,
    goBack: useCallback(() => go(-1), [go]),
    goForward: useCallback(() => go(1), [go]),
  };
}
