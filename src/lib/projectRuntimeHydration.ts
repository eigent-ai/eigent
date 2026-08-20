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

import { proxyFetchGet } from '@/api/http';
import {
  buildTaskQuestionsById,
  computeProjectFreshnessAnchor,
} from '@/lib/replay';
import { getSessionNavLeadFromHistoryProject } from '@/lib/sessionNavLead';
import type { ProjectRuntimeStore } from '@/store/projectRuntimeStore';

interface EnsureProjectRuntimeLoadedOptions {
  onHydrationStarted?: () => void;
  requireActiveSelection?: boolean;
}

/**
 * Hydrates a Project runtime on demand while preserving the sidebar's replay
 * and remote-history merge semantics. Callers may safely invoke this for an
 * already-loaded Project; that path is a no-op.
 */
export async function ensureProjectRuntimeLoaded(
  projectStore: ProjectRuntimeStore,
  projectId: string,
  options: EnsureProjectRuntimeLoadedOptions = {}
): Promise<void> {
  const project = projectStore.getProjectById(projectId);
  const needsRemoteHistoryHydration =
    project?.metadata?.remoteHistoryHydrationPending === true;
  if (
    projectStore.peekActiveChatStore(projectId) &&
    !projectStore.historyLoadIncompleteProjectIds[projectId] &&
    !needsRemoteHistoryHydration
  ) {
    return;
  }

  try {
    const historyProject = await proxyFetchGet(
      `/api/v1/chat/histories/grouped/${projectId}`,
      { include_tasks: true }
    );
    const taskIdsList = (historyProject?.tasks ?? [])
      .map((task: { task_id?: string | null }) => task.task_id)
      .filter((taskId: string | null | undefined): taskId is string =>
        Boolean(taskId)
      );

    if (taskIdsList.length === 0) {
      if (needsRemoteHistoryHydration) {
        projectStore.updateProject(projectId, {
          metadata: { remoteHistoryHydrationPending: false },
        });
        return;
      }
      projectStore.appendInitChatStore(projectId);
      return;
    }

    projectStore.setProjectNavLead(
      projectId,
      getSessionNavLeadFromHistoryProject(historyProject)
    );

    const firstTask = historyProject.tasks[0];
    const taskQuestionsById = buildTaskQuestionsById(historyProject?.tasks);
    if (needsRemoteHistoryHydration) {
      const mergePromise = projectStore.mergeProjectHistory(
        projectId,
        historyProject.tasks,
        firstTask?.question || historyProject.last_prompt || ''
      );
      options.onHydrationStarted?.();
      await mergePromise;
      return;
    }

    const loadPromise = projectStore.loadProjectFromHistory(
      taskIdsList,
      firstTask?.question || historyProject.last_prompt || '',
      projectId,
      firstTask?.id != null ? String(firstTask.id) : undefined,
      historyProject.project_name,
      undefined,
      taskQuestionsById,
      computeProjectFreshnessAnchor(historyProject),
      { requireActiveSelection: options.requireActiveSelection ?? true }
    );
    options.onHydrationStarted?.();
    await loadPromise;
  } catch (error) {
    console.error(`Failed to load Project ${projectId} from history:`, error);
    if (!projectStore.peekActiveChatStore(projectId)) {
      projectStore.appendInitChatStore(projectId);
    }
  }
}
