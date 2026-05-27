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

import type { ProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSpaceStore } from '@/store/spaceStore';
import { NavigateFunction } from 'react-router-dom';

const activateHistorySpace = async (spaceId?: string | null) => {
  if (!spaceId) return;
  const spaceStore = useSpaceStore.getState();
  if (!spaceStore.getSpaceById(spaceId)) {
    await spaceStore.hydrateFromServer();
  }
  if (!useSpaceStore.getState().getSpaceById(spaceId)) return;
  useSpaceStore.getState().setActiveSpace(spaceId);
  if (useSpaceStore.getState().shouldSyncProjects(spaceId)) {
    void useSpaceStore.getState().syncProjectsFromServer(spaceId);
  }
};

/**
 * Load project from history with final state (no animation).
 * Waits for loading to complete before navigating.
 * Use when entering a project - shows final state immediately.
 *
 * @param projectStore - The project store instance
 * @param navigate - The navigate function from useNavigate hook
 * @param projectId - The project ID to load
 * @param question - The question/content for the task
 * @param historyId - The history ID
 * @param taskIdsList - Optional list of task IDs (defaults to [projectId])
 * @param projectName - Optional project display name
 */
export const loadProjectFromHistory = async (
  projectStore: ProjectRuntimeStore,
  navigate: NavigateFunction,
  projectId: string,
  question: string,
  historyId: string,
  taskIdsList?: string[],
  projectName?: string,
  spaceId?: string | null
) => {
  await activateHistorySpace(spaceId);
  const taskIds = taskIdsList || [projectId];
  await projectStore.loadProjectFromHistory(
    taskIds,
    question,
    projectId,
    historyId,
    projectName,
    spaceId ?? undefined
  );
  navigate({ pathname: '/' });
};

/**
 * Reusable replay function that can be used across different components
 * This function replays a project using projectStore.replayProject
 * Use when user explicitly clicks Replay button - shows animation.
 *
 * @param projectStore - The project store instance
 * @param navigate - The navigate function from useNavigate hook
 * @param projectId - The project ID to replay
 * @param question - The question/content to replay
 * @param historyId - The history ID for the replay
 */
export const replayProject = async (
  projectStore: ProjectRuntimeStore,
  navigate: NavigateFunction,
  projectId: string,
  question: string,
  historyId: string,
  taskIdsList?: string[],
  spaceId?: string | null
) => {
  await activateHistorySpace(spaceId);
  if (!taskIdsList) taskIdsList = [projectId];
  projectStore.replayProject(taskIdsList, question, projectId, historyId);
  navigate({ pathname: '/' });
};
