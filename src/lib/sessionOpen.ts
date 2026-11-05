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
import { markSessionOutcomeSeen } from '@/lib/sessionOutcome';
import { openSessionWindow } from '@/lib/sessionWindows';
import { executionScope } from '@/service/executionApi';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSessionControlsStore } from '@/store/sessionControlsStore';
import { getSessionExecutionState } from '@/store/sessionExecutionStore';
import { useSessionWindowsStore } from '@/store/sessionWindowsStore';
import { useSpaceStore, type SpaceProjectMeta } from '@/store/spaceStore';
import { ChatTaskStatus } from '@/types/constants';

/** Whether a loaded Session has a message or has moved past pending. */
export function sessionHasStarted(projectId: string): boolean {
  const projectChatState = useProjectRuntimeStore
    .getState()
    .peekActiveChatStore(projectId)
    ?.getState();
  const projectTask = projectChatState?.activeTaskId
    ? projectChatState.tasks[projectChatState.activeTaskId]
    : undefined;
  return Boolean(
    projectTask &&
    ((projectTask.messages?.length || 0) > 0 ||
      projectTask.hasMessages ||
      projectTask.status !== ChatTaskStatus.PENDING)
  );
}

/**
 * Sidebars list a Session once it has history, a real name or a started Task,
 * so an empty New session draft never shows up as a row.
 */
export function shouldListSession(project: SpaceProjectMeta): boolean {
  if (project.metadata?.historyId) return true;
  const historyDisplayName =
    typeof project.metadata?.historyDisplayName === 'string'
      ? project.metadata.historyDisplayName.trim()
      : '';
  if (historyDisplayName) return true;

  const normalizedName = (project.name ?? '').trim().toLowerCase();
  if (
    normalizedName &&
    normalizedName !== 'new project' &&
    normalizedName !== 'new space'
  ) {
    return true;
  }

  return sessionHasStarted(project.id);
}

/**
 * Open a Session of the active Space in the main window, the way clicking its
 * sidebar row does: bring its own window forward when it has one, otherwise
 * make it active, load its history, and show the Session tab.
 */
export async function openSessionInShell(projectId: string): Promise<void> {
  useSessionControlsStore.getState().setSessionUnread(projectId, false);
  markSessionOutcomeSeen(projectId);
  const projectStore = useProjectRuntimeStore.getState();
  const setActiveWorkspaceTab =
    usePageTabStore.getState().setActiveWorkspaceTab;
  const activeSpaceId = useSpaceStore.getState().activeSpaceId;

  // A Session lives in one place: bring its own window forward instead.
  if (
    activeSpaceId &&
    useSessionWindowsStore.getState().openProjectIds.includes(projectId)
  ) {
    void openSessionWindow({ spaceId: activeSpaceId, projectId });
    return;
  }
  projectStore.setActiveProject(projectId);
  const needsRemoteHistoryHydration =
    projectStore.getProjectById(projectId)?.metadata
      ?.remoteHistoryHydrationPending === true;

  // Already loaded: every execution route shows it on the Session tab, and
  // Session observes the route itself, so there's nothing to wait for.
  if (
    projectStore.peekActiveChatStore(projectId) &&
    !projectStore.historyLoadIncompleteProjectIds[projectId] &&
    !needsRemoteHistoryHydration
  ) {
    setActiveWorkspaceTab('project');
    return;
  }

  const showSessionTab = () => {
    if (useProjectRuntimeStore.getState().activeProjectId === projectId) {
      setActiveWorkspaceTab('project');
    }
  };
  // A listed Session has something to show, so its loading shell can appear
  // now. Session keeps that shell stable while the history loads.
  const listedMeta = useSpaceStore.getState().getProjectMeta(projectId);
  if (listedMeta && shouldListSession(listedMeta)) showSessionTab();

  try {
    await ensureProjectRuntimeLoaded(projectStore, projectId, {
      onHydrationStarted: showSessionTab,
      requireActiveSelection: true,
    });
  } catch {
    showSessionTab();
    return;
  }
  const { route } = getSessionExecutionState(executionScope(projectId));
  if (route?.route === 'managed') return;

  // A slower, older click may finish after the user selected another
  // Session. It must not change the shared shell for the newer selection.
  const latest = useProjectRuntimeStore.getState();
  if (latest.activeProjectId !== projectId) return;
  if (latest.historyLoadIncompleteProjectIds[projectId]) return;

  // History-loaded projects are known to have content. Trust the project
  // type tag (set by createProject(REPLAY)) over `sessionHasStarted`,
  // which can read a transiently-empty chatStore during the brief
  // window between loadProjectFromHistory's remove+create rebuild.
  const meta = useSpaceStore.getState().getProjectMeta(projectId);
  const projectInStore = latest.getProjectById(projectId);
  const isReplayProject = Boolean(
    meta?.metadata?.tags?.includes('replay') ||
    projectInStore?.metadata?.tags?.includes('replay')
  );
  setActiveWorkspaceTab(
    isReplayProject || sessionHasStarted(projectId) ? 'project' : 'new-project'
  );
}
