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
import { fetchLocalRuns, RunSummary } from '@/service/localEventApi';
import { HistoryTask, ProjectGroup } from '@/types/history';

const normalizeTask = (task: Partial<HistoryTask>): HistoryTask => ({
  id: task.id ?? '',
  task_id: task.task_id ?? '',
  project_id: task.project_id ?? task.task_id ?? '',
  question: task.question ?? '',
  language: task.language ?? 'local',
  model_platform: task.model_platform ?? 'local',
  model_type: task.model_type ?? 'local',
  api_key: task.api_key ?? '',
  api_url: task.api_url,
  max_retries: task.max_retries ?? 0,
  file_save_path: task.file_save_path,
  installed_mcp: task.installed_mcp,
  project_name: task.project_name,
  summary: task.summary,
  tokens: task.tokens ?? 0,
  status: task.status ?? 1,
  created_at: task.created_at,
  updated_at: task.updated_at,
  sync_status: task.sync_status,
});

const localRunToTask = (run: RunSummary): HistoryTask =>
  normalizeTask({
    id: run.id || `local:${run.run_id}`,
    task_id: run.task_id || run.run_id,
    project_id: run.project_id,
    question: run.question || 'Untitled task',
    summary: run.summary,
    status: run.status ?? 1,
    created_at: run.first_event,
    updated_at: run.last_event,
    sync_status: run.sync_status,
  });

const normalizeCloudTask = (task: HistoryTask): HistoryTask =>
  normalizeTask({
    ...task,
    sync_status: task.sync_status ?? 'synced',
  });

const sortTasks = (tasks: HistoryTask[]): HistoryTask[] =>
  tasks.sort((a, b) => {
    const dateA = new Date(a.updated_at || a.created_at || 0).getTime();
    const dateB = new Date(b.updated_at || b.created_at || 0).getTime();
    return dateB - dateA;
  });

const mergeTasks = (
  localRuns: RunSummary[],
  cloudTasks: HistoryTask[]
): HistoryTask[] => {
  const taskMap = new Map<string, HistoryTask>();

  cloudTasks.forEach((task) => {
    taskMap.set(task.task_id, normalizeCloudTask(task));
  });

  localRuns.map(localRunToTask).forEach((localTask) => {
    const cloudTask = taskMap.get(localTask.task_id);
    if (!cloudTask) {
      taskMap.set(localTask.task_id, localTask);
      return;
    }

    taskMap.set(
      localTask.task_id,
      normalizeTask({
        ...cloudTask,
        ...localTask,
        id: cloudTask.id ?? localTask.id,
        project_name: cloudTask.project_name ?? localTask.project_name,
        language: cloudTask.language || localTask.language,
        model_platform: cloudTask.model_platform || localTask.model_platform,
        model_type: cloudTask.model_type || localTask.model_type,
        max_retries: cloudTask.max_retries ?? localTask.max_retries,
        tokens: cloudTask.tokens ?? localTask.tokens,
        question: localTask.question || cloudTask.question,
        summary: localTask.summary || cloudTask.summary,
        created_at: localTask.created_at || cloudTask.created_at,
        updated_at: localTask.updated_at || cloudTask.updated_at,
        sync_status: localTask.sync_status,
      })
    );
  });

  return sortTasks(Array.from(taskMap.values()));
};

const getProjectSyncStatus = (
  tasks: HistoryTask[]
): ProjectGroup['sync_status'] => {
  const statuses = new Set(tasks.map((task) => task.sync_status || 'synced'));
  if (statuses.size === 1 && statuses.has('synced')) {
    return 'synced';
  }
  if (statuses.size === 1 && statuses.has('local')) {
    return 'local';
  }
  return 'partial';
};

const groupTasksByProject = (
  tasks: HistoryTask[],
  projectMetadata = new Map<string, Partial<ProjectGroup>>()
): ProjectGroup[] => {
  const projectMap = new Map<string, ProjectGroup>();

  tasks.forEach((task) => {
    const projectId = task.project_id;
    const metadata = projectMetadata.get(projectId);

    if (!projectMap.has(projectId)) {
      projectMap.set(projectId, {
        project_id: projectId,
        project_name:
          task.project_name ||
          metadata?.project_name ||
          `Project ${projectId}`,
        total_tokens: 0,
        task_count: 0,
        total_triggers: metadata?.total_triggers || 0,
        latest_task_date:
          task.updated_at || task.created_at || new Date().toISOString(),
        tasks: [],
        total_completed_tasks: 0,
        total_ongoing_tasks: 0,
        average_tokens_per_task: 0,
        last_prompt: task.question || metadata?.last_prompt || '',
        sync_status: 'local',
      });
    }

    const project = projectMap.get(projectId)!;
    project.tasks.push(task);
    project.task_count++;
    project.total_tokens += task.tokens || 0;

    if (task.status === 2) {
      project.total_completed_tasks++;
    } else if (task.status === 1) {
      project.total_ongoing_tasks++;
    }

    const candidateDate =
      task.updated_at || task.created_at || project.latest_task_date;
    if (candidateDate >= project.latest_task_date) {
      project.latest_task_date = candidateDate;
      project.last_prompt = task.question || project.last_prompt;
      project.project_name =
        task.project_name || metadata?.project_name || project.project_name;
    }
  });

  projectMap.forEach((project) => {
    project.average_tokens_per_task =
      project.task_count > 0
        ? Math.round(project.total_tokens / project.task_count)
        : 0;
    project.sync_status = getProjectSyncStatus(project.tasks);
    project.tasks = sortTasks(project.tasks);
  });

  return Array.from(projectMap.values()).sort((a, b) => {
    const dateA = new Date(a.latest_task_date).getTime();
    const dateB = new Date(b.latest_task_date).getTime();
    return dateB - dateA;
  });
};

const fetchCloudHistoryTasks = async (): Promise<HistoryTask[]> => {
  try {
    const res = await proxyFetchGet(`/api/v1/chat/histories`);
    return Array.isArray(res?.items)
      ? res.items.map((task: HistoryTask) => normalizeCloudTask(task))
      : [];
  } catch (error) {
    console.error('Failed to fetch cloud history tasks:', error);
    return [];
  }
};

const fetchCloudGroupedProjects = async (): Promise<ProjectGroup[]> => {
  try {
    const res = await proxyFetchGet(
      `/api/v1/chat/histories/grouped?include_tasks=true`
    );
    return Array.isArray(res?.projects) ? res.projects : [];
  } catch (error) {
    console.error('Failed to fetch grouped cloud history tasks:', error);
    return [];
  }
};

export const fetchHistoryTasks = async (
  setTasks: React.Dispatch<React.SetStateAction<HistoryTask[]>>
) => {
  try {
    const [localRuns, cloudTasks] = await Promise.all([
      fetchLocalRuns(),
      fetchCloudHistoryTasks(),
    ]);
    setTasks(mergeTasks(localRuns, cloudTasks));
  } catch (error) {
    console.error('Failed to fetch history tasks:', error);
    setTasks([]);
  }
};

export const fetchGroupedHistoryTasks = async (
  setProjects: React.Dispatch<React.SetStateAction<ProjectGroup[]>>
) => {
  try {
    const [localRuns, cloudProjects] = await Promise.all([
      fetchLocalRuns(),
      fetchCloudGroupedProjects(),
    ]);
    const cloudTasks = cloudProjects.flatMap((project) => project.tasks || []);
    const mergedTasks = mergeTasks(localRuns, cloudTasks);
    const metadata = new Map(
      cloudProjects.map((project) => [
        project.project_id,
        {
          project_name: project.project_name,
          total_triggers: project.total_triggers,
          last_prompt: project.last_prompt,
        },
      ])
    );
    setProjects(groupTasksByProject(mergedTasks, metadata));
  } catch (error) {
    console.error('Failed to fetch grouped history tasks:', error);
    setProjects([]);
  }
};

export const fetchGroupedHistorySummaries = async (
  setProjects: React.Dispatch<React.SetStateAction<ProjectGroup[]>>
) => {
  await fetchGroupedHistoryTasks(setProjects);
};

export const fetchGroupedHistoryTasksLegacy = async (
  setProjects: React.Dispatch<React.SetStateAction<ProjectGroup[]>>
) => {
  await fetchGroupedHistoryTasks(setProjects);
};

export const flattenProjectTasks = (
  projects: ProjectGroup[]
): HistoryTask[] => {
  return projects.flatMap((project) => project.tasks);
};
