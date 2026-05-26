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

import { useProjectStore } from '@/store/projectStore';
import { isWebUiMock } from '@web/lib/mockMode';
import type { WebProject } from '@web/types';
import { useEffect, useState } from 'react';

function activateLatestChatStore(
  projectStore: ReturnType<typeof useProjectStore.getState>,
  projectId: string,
  latestTaskId?: string
) {
  const project = projectStore.getProjectById(projectId);
  if (!project) return;

  const chatIds = Object.entries(project.chatStoreTimestamps)
    .sort(([, left], [, right]) => right - left)
    .map(([chatId]) => chatId);

  const activeChatId = chatIds[0] ?? project.activeChatId;
  if (!activeChatId) return;

  projectStore.setActiveChatStore(projectId, activeChatId);
  const chatStore = project.chatStores[activeChatId];
  if (chatStore && latestTaskId) {
    chatStore.getState().setActiveTaskId(latestTaskId);
  }
}

export function useWebProjectTask(
  projectId: string | undefined,
  project: WebProject | null
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId || !project) {
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const projectStore = useProjectStore.getState();

    const syncProject = async () => {
      setLoading(true);
      setError(null);

      try {
        const existing = projectStore.getProjectById(projectId);
        if (existing) {
          projectStore.setActiveProject(projectId);
          const latestTaskId =
            project.sessions[project.sessions.length - 1]?.taskId;
          activateLatestChatStore(projectStore, projectId, latestTaskId);
          return;
        }

        if (project.sessions.length > 0 && !isWebUiMock()) {
          const taskIds = project.sessions.map((session) => session.taskId);
          const latestTask = project.sessions[project.sessions.length - 1];
          await projectStore.loadProjectFromHistory(
            taskIds,
            latestTask.question,
            projectId,
            undefined,
            project.name
          );
          if (!cancelled) {
            activateLatestChatStore(
              useProjectStore.getState(),
              projectId,
              latestTask.taskId
            );
          }
          return;
        }

        projectStore.createProject(
          project.name,
          isWebUiMock()
            ? 'Mock task workspace'
            : 'Created from Eigent Dispatch',
          projectId,
          undefined,
          undefined,
          true
        );
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to prepare task chat'
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void syncProject();

    return () => {
      cancelled = true;
    };
  }, [project, projectId]);

  return { loading, error };
}
