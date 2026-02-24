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

import { ChatStore } from '@/store/chatStore';
import { ProjectStore } from '@/store/projectStore';
import { NavigateFunction } from 'react-router-dom';

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
  projectStore: ProjectStore,
  navigate: NavigateFunction,
  projectId: string,
  questions: string[],
  historyId: string,
  taskIdsList?: string[],
  projectName?: string
) => {
  const taskIds = taskIdsList || [projectId];
  await projectStore.loadProjectFromHistory(
    taskIds,
    questions,
    projectId,
    historyId,
    projectName
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
  projectStore: ProjectStore,
  navigate: NavigateFunction,
  projectId: string,
  questions: string[],
  historyId: string,
  taskIdsList?: string[]
) => {
  if (!taskIdsList) taskIdsList = [projectId];
  projectStore.replayProject(taskIdsList, questions, projectId, historyId);
  navigate({ pathname: '/' });
};

/**
 * Replay function specifically for the current active task in ChatBox
 * This extracts the necessary data from the current chat store and project store
 *
 * @param chatStore - The chat store instance
 * @param projectStore - The project store instance
 * @param navigate - The navigate function from useNavigate hook
 */
export const replayActiveTask = async (
  chatStore: ChatStore,
  projectStore: ProjectStore,
  navigate: NavigateFunction
) => {
  const taskId = chatStore.activeTaskId as string;
  const projectId = projectStore.activeProjectId as string;

  if (!taskId || !projectId) {
    console.error('Missing taskId or projectId for replay');
    return;
  }

  // Get the question from the current active task's messages
  let question = '';
  const currentTask = chatStore.tasks[taskId];
  if (currentTask?.messages?.length > 0) {
    const userMessage = currentTask.messages.find(
      (msg: any) => msg.role === 'user'
    );
    if (userMessage?.content) {
      question = userMessage.content.trim();
    }
  }

  const historyId = projectStore.getHistoryId(projectId);

  // Use replayProject from projectStore instead of replay from chatStore
  const taskIdsList = [taskId];
  projectStore.replayProject(
    taskIdsList,
    [question],
    projectId,
    historyId || undefined
  );
  navigate('/');
};
