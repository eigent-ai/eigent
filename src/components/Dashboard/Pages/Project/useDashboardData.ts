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

import { useGroupedHistory } from '@/hooks/useGroupedHistory';
import { useDashboardStore } from '@/store/dashboardStore';
import { useProjectStore, type ProjectStore } from '@/store/projectStore';
import {
  BOARD_COLUMN_ORDER,
  toBucket,
  type DashboardTask,
  type TaskStatusBucket,
} from '@/types/dashboard';
import type { ProjectGroup } from '@/types/history';
import { useMemo } from 'react';

export type DashboardHub = 'project' | 'task';
export type DashboardViewMode = 'board' | 'list';

export type DashboardStats = {
  projectCount: number;
  taskCount: number;
  filteredTaskCount: number;
  triggerCount: number;
  totalTokens: number;
  completedTaskCount: number;
  runningTaskCount: number;
};

const EMPTY_BUCKETS: Record<TaskStatusBucket, DashboardTask[]> = {
  draft: [],
  todo: [],
  in_progress: [],
  done: [],
  failed: [],
  human_review: [],
  canceled: [],
  rework: [],
};

function buildEmptyProjectGroups(
  projectStore: ProjectStore,
  projects: ProjectGroup[]
): ProjectGroup[] {
  const existingProjectIds = new Set(projects.map((p) => p.project_id));

  return projectStore
    .getAllProjects()
    .filter((project) => projectStore.isEmptyProject(project))
    .filter((project) => !existingProjectIds.has(project.id))
    .map((project) => ({
      project_id: project.id,
      project_name: project.name,
      total_tokens: 0,
      task_count: 0,
      latest_task_date: new Date(project.updatedAt).toISOString(),
      last_prompt: '',
      tasks: [],
      total_completed_tasks: 0,
      total_triggers: 0,
      total_ongoing_tasks: 0,
      average_tokens_per_task: 0,
    }));
}

export function useDashboardData() {
  const groupedHistory = useGroupedHistory();
  const projectStore = useProjectStore();
  const { filters, columnVisibility } = useDashboardStore();

  const projects = useMemo(() => {
    const emptyProjects = buildEmptyProjectGroups(
      projectStore,
      groupedHistory.projects
    );
    return [...emptyProjects, ...groupedHistory.projects];
  }, [groupedHistory.projects, projectStore]);

  const tasks = useMemo<DashboardTask[]>(
    () =>
      projects.flatMap((project) =>
        project.tasks.map((task) => ({
          ...task,
          project_name: project.project_name ?? project.project_id,
        }))
      ),
    [projects]
  );

  const filteredTasks = useMemo(() => {
    let nextTasks = tasks;

    if (filters.projectId) {
      nextTasks = nextTasks.filter(
        (task) => task.project_id === filters.projectId
      );
    }

    if (filters.bucket) {
      nextTasks = nextTasks.filter(
        (task) => toBucket(task.status) === filters.bucket
      );
    }

    if (filters.search.trim()) {
      const q = filters.search.trim().toLowerCase();
      nextTasks = nextTasks.filter(
        (task) =>
          (task.summary ?? task.question).toLowerCase().includes(q) ||
          task.project_name.toLowerCase().includes(q)
      );
    }

    return nextTasks;
  }, [filters.bucket, filters.projectId, filters.search, tasks]);

  const taskBuckets = useMemo(() => {
    const buckets: Record<TaskStatusBucket, DashboardTask[]> = {
      ...EMPTY_BUCKETS,
    };

    for (const task of filteredTasks) {
      buckets[toBucket(task.status)].push(task);
    }

    return buckets;
  }, [filteredTasks]);

  const stats = useMemo<DashboardStats>(
    () => ({
      projectCount: projects.length,
      taskCount: tasks.length,
      filteredTaskCount: filteredTasks.length,
      triggerCount: projects.reduce(
        (total, project) => total + (project.total_triggers || 0),
        0
      ),
      totalTokens: projects.reduce(
        (total, project) => total + (project.total_tokens || 0),
        0
      ),
      completedTaskCount: filteredTasks.filter(
        (task) => toBucket(task.status) === 'done'
      ).length,
      runningTaskCount: filteredTasks.filter(
        (task) => toBucket(task.status) === 'in_progress'
      ).length,
    }),
    [filteredTasks, projects, tasks]
  );

  const visibleBuckets = BOARD_COLUMN_ORDER.filter(
    (bucket) => columnVisibility[bucket]
  );
  const hiddenBuckets = BOARD_COLUMN_ORDER.filter(
    (bucket) => !columnVisibility[bucket]
  );

  return {
    ...groupedHistory,
    projects,
    tasks,
    filteredTasks,
    taskBuckets,
    stats,
    visibleBuckets,
    hiddenBuckets,
    isError: groupedHistory.isError,
    error: groupedHistory.error,
  };
}
