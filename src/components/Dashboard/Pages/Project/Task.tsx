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

import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { loadProjectFromHistory } from '@/lib';
import { cn } from '@/lib/utils';
import type { ProjectStore } from '@/store/projectStore';
import {
  TASK_BUCKET_LABEL_KEY,
  type BoardColumnDef,
  type DashboardTask,
  type TaskStatusBucket,
} from '@/types/dashboard';
import type { ProjectGroup } from '@/types/history';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { BoardColumn } from './components/BoardColumn';

function activateTaskSession(
  projectStore: ProjectStore,
  projectId: string,
  camelTaskId: string
) {
  const project = projectStore.projects[projectId];
  if (!project) return;
  for (const chatId of Object.keys(project.chatStores)) {
    const vanilla = project.chatStores[chatId];
    if (vanilla.getState().tasks[camelTaskId]) {
      projectStore.setActiveChatStore(projectId, chatId);
      vanilla.getState().setActiveTaskId(camelTaskId);
      return;
    }
  }
  projectStore
    .getActiveChatStore(projectId)
    ?.getState()
    .setActiveTaskId(camelTaskId);
}

const HIDDEN_BADGE: Record<TaskStatusBucket, string> = {
  draft: 'bg-ds-bg-neutral-subtle-default text-ds-text-neutral-muted-default',
  todo: 'bg-ds-bg-status-pending-subtle-default text-ds-text-status-pending-muted-default',
  in_progress:
    'bg-ds-bg-status-running-subtle-default text-ds-text-status-running-muted-default',
  done: 'bg-ds-bg-status-completed-subtle-default text-ds-text-status-completed-muted-default',
  failed:
    'bg-ds-bg-status-error-subtle-default text-ds-text-status-error-muted-default',
  human_review:
    'bg-ds-bg-caution-subtle-default text-ds-text-caution-muted-default',
  canceled:
    'bg-ds-bg-neutral-subtle-default text-ds-text-neutral-muted-default',
  rework: 'bg-ds-bg-warning-subtle-default text-ds-text-warning-muted-default',
};

type Props = {
  /** Horizontal gutter for the board row (matches hub shell, e.g. `px-4` / `px-[70px]`). */
  horizontalPaddingClass: string;
  taskBuckets: Record<TaskStatusBucket, DashboardTask[]>;
  visibleBuckets: TaskStatusBucket[];
  hiddenBuckets: TaskStatusBucket[];
  projects: ProjectGroup[];
};

export default function Task({
  horizontalPaddingClass,
  taskBuckets,
  visibleBuckets,
  hiddenBuckets,
  projects,
}: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectStore } = useChatStoreAdapter();

  const openTaskSession = useCallback(
    async (task: DashboardTask) => {
      if (!projectStore) return;
      const projectId = task.project_id;
      const question = task.question;
      const historyId = String(task.id);
      const camelTaskId = task.task_id;

      const existingProject = projectStore.getProjectById(projectId);
      const projectGroup = projects.find((p) => p.project_id === projectId);

      if (existingProject) {
        projectStore.setHistoryId(projectId, historyId);
        projectStore.setActiveProject(projectId);
        activateTaskSession(projectStore, projectId, camelTaskId);
        navigate('/');
      } else {
        const taskIdsList = projectGroup?.tasks
          ?.map((t) => t.task_id)
          .filter(Boolean) || [camelTaskId];
        await loadProjectFromHistory(
          projectStore,
          navigate,
          projectId,
          question,
          historyId,
          taskIdsList,
          projectGroup?.project_name ?? task.project_name
        );
        // Re-read from store after async load to avoid stale closure
        const loadedProject = projectStore.getProjectById(projectId);
        if (loadedProject) {
          activateTaskSession(projectStore, projectId, camelTaskId);
        }
      }
    },
    [navigate, projectStore, projects]
  );

  const buildCol = (id: TaskStatusBucket): BoardColumnDef => ({
    id,
    label: t(TASK_BUCKET_LABEL_KEY[id]),
    tasks: taskBuckets[id],
  });

  const visibleColumns = visibleBuckets.map(buildCol);
  const hiddenColumns = hiddenBuckets.map(buildCol);

  return (
    <div className="gap-3 min-h-0 min-w-0 flex flex-1 flex-col">
      <div
        className={cn(
          'gap-4 pb-4 min-h-0 min-w-0 flex flex-1 flex-row items-start overflow-x-auto overscroll-x-contain',
          horizontalPaddingClass
        )}
      >
        {visibleColumns.map((col) => (
          <BoardColumn
            key={col.id}
            column={col}
            onOpenSession={openTaskSession}
          />
        ))}

        <div className="bg-ds-border-neutral-subtle-disabled mx-1 w-px shrink-0 self-stretch" />

        <div className="gap-2 flex shrink-0 flex-col">
          {hiddenColumns.map((col) => (
            <div
              key={col.id}
              className="gap-3 w-64 py-2 flex flex-row items-center"
            >
              <span
                className={cn(
                  'w-5 h-5 text-label-xs font-bold inline-flex items-center justify-center rounded-full tabular-nums',
                  HIDDEN_BADGE[col.id]
                )}
              >
                {col.tasks.length}
              </span>
              <span className="text-label-xs font-semibold text-ds-text-neutral-muted-default whitespace-nowrap">
                {t(TASK_BUCKET_LABEL_KEY[col.id])}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
