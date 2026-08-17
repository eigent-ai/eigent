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

import { proxyFetchDelete, proxyFetchPut } from '@/api/http';
import { useHost } from '@/host';
import { fetchGroupedHistoryTasks } from '@/service/historyApi';
import { getAuthStore, useAuthStore } from '@/store/authStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import {
  getVisibleProjectMetasForSpace,
  useSpaceStore,
  type SpaceProjectMeta,
} from '@/store/spaceStore';
import { ProjectGroup as ProjectGroupType } from '@/types/history';
import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

let groupedHistorySnapshot: {
  email: string | null;
  projects: ProjectGroupType[];
} | null = null;

export function useHomeHubProjects() {
  const email = useAuthStore((s) => s.email);
  const host = useHost();
  const ipcRenderer = host?.ipcRenderer;
  const projectStore = useProjectRuntimeStore();

  const [projects, setProjects] = useState<ProjectGroupType[]>(() => {
    const snap = groupedHistorySnapshot;
    if (snap && snap.email === (email ?? null)) {
      return snap.projects;
    }
    return [];
  });
  const [loading, setLoading] = useState(() => {
    const snap = groupedHistorySnapshot;
    return !(snap && snap.email === (email ?? null));
  });

  const loadProjects = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      const u = email ?? null;
      try {
        const snapshotSetter: Dispatch<SetStateAction<ProjectGroupType[]>> = (
          action
        ) => {
          setProjects((prev) => {
            const next =
              typeof action === 'function'
                ? (action as (p: ProjectGroupType[]) => ProjectGroupType[])(
                    prev
                  )
                : action;
            groupedHistorySnapshot = { email: u, projects: next };
            return next;
          });
        };
        await fetchGroupedHistoryTasks(snapshotSetter);
      } catch (error) {
        console.error('Failed to load grouped projects:', error);
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [email]
  );

  useEffect(() => {
    const u = email ?? null;
    const snap = groupedHistorySnapshot;
    if (snap && snap.email === u) {
      setProjects(snap.projects);
      setLoading(false);
      void loadProjects({ silent: true });
      return;
    }
    void loadProjects();
  }, [email, loadProjects]);

  const removeTaskFromProjects = useCallback((historyId: string) => {
    setProjects((prevProjects) =>
      prevProjects
        .map((project) => {
          const filteredTasks = project.tasks.filter(
            (task) => String(task.id) !== historyId
          );
          return {
            ...project,
            tasks: filteredTasks,
            task_count: filteredTasks.length,
            total_tokens: filteredTasks.reduce(
              (sum, task) => sum + (task.tokens || 0),
              0
            ),
          };
        })
        .filter((project) => project.tasks.length > 0)
    );
  }, []);

  const handleProjectRename = useCallback(
    async (projectId: string, newName: string) => {
      setProjects((prevProjects) =>
        prevProjects.map((project) =>
          project.project_id === projectId
            ? { ...project, project_name: newName }
            : project
        )
      );

      try {
        const response = await proxyFetchPut(
          `/api/v1/chat/project/${projectId}/name?new_name=${encodeURIComponent(newName)}`
        );
        if (response && response.code !== undefined && response.code !== 0) {
          console.error(`Failed to update project name: ${response.code}`);
        }
      } catch (error) {
        console.error('Error updating project name:', error);
      }
    },
    []
  );

  const handleProjectDelete = useCallback(
    (
      projectId: string,
      onConfirm?: (callback: () => Promise<void>) => void
    ) => {
      const deleteCallback = async () => {
        const targetProject = projects.find(
          (project) => project.project_id === projectId
        );

        if (
          targetProject &&
          targetProject.tasks &&
          targetProject.tasks.length > 0
        ) {
          for (const history of targetProject.tasks) {
            try {
              await proxyFetchDelete(`/api/v1/chat/history/${history.id}`);
              const { email: authEmail } = getAuthStore();
              if (history.task_id && ipcRenderer) {
                try {
                  await ipcRenderer.invoke(
                    'delete-task-files',
                    authEmail,
                    history.task_id,
                    history.project_id ?? undefined
                  );
                } catch (error) {
                  console.warn(
                    `Local file cleanup failed for task ${history.task_id}:`,
                    error
                  );
                }
              }
            } catch (error) {
              console.error(`Failed to delete task ${history.task_id}:`, error);
            }
          }
          projectStore.removeProject(projectId);
          setProjects((prevProjects) =>
            prevProjects.filter((project) => project.project_id !== projectId)
          );
        } else if (targetProject) {
          projectStore.removeProject(projectId);
          setProjects((prevProjects) =>
            prevProjects.filter((project) => project.project_id !== projectId)
          );
        }
      };

      if (onConfirm) {
        onConfirm(deleteCallback);
      } else {
        void deleteCallback();
      }
    },
    [ipcRenderer, projectStore, projects]
  );

  /**
   * Canonical project list = `spaceStore.projectsBySpaceId`, enriched with
   * history details (task list, tokens, last_prompt) when available. History
   * projects with no matching meta (e.g. server returned them before they
   * synced into the Space store) are appended as a fallback so nothing is
   * lost during the migration window.
   */
  const projectsBySpaceId = useSpaceStore((state) => state.projectsBySpaceId);
  const canonicalMetas = useMemo(() => {
    const out: SpaceProjectMeta[] = [];
    for (const spaceId of Object.keys(projectsBySpaceId)) {
      out.push(...getVisibleProjectMetasForSpace(projectsBySpaceId, spaceId));
    }
    return out;
  }, [projectsBySpaceId]);

  const mergedProjects = useMemo<ProjectGroupType[]>(() => {
    const historyById = new Map<string, ProjectGroupType>();
    for (const project of projects) {
      historyById.set(project.project_id, project);
    }

    const fromMetas: ProjectGroupType[] = canonicalMetas.map((meta) => {
      const history = historyById.get(meta.id);
      if (history) {
        return {
          ...history,
          project_name: meta.name?.trim() || history.project_name,
          space_id: meta.spaceId ?? history.space_id,
        };
      }
      return {
        project_id: meta.id,
        space_id: meta.spaceId,
        project_name: meta.name,
        total_tokens: 0,
        task_count: 0,
        total_triggers: 0,
        latest_task_date: new Date(meta.updatedAt).toISOString(),
        last_prompt: '',
        tasks: [],
        total_completed_tasks: 0,
        total_ongoing_tasks: 0,
        average_tokens_per_task: 0,
      };
    });

    const metaIds = new Set(canonicalMetas.map((m) => m.id));
    const historyOnly = projects.filter(
      (project) => !metaIds.has(project.project_id)
    );

    return [...fromMetas, ...historyOnly].sort((a, b) => {
      const aTime = new Date(a.latest_task_date || 0).getTime();
      const bTime = new Date(b.latest_task_date || 0).getTime();
      return bTime - aTime;
    });
  }, [canonicalMetas, projects]);

  return {
    projects: mergedProjects,
    loading,
    loadProjects,
    removeTaskFromProjects,
    handleProjectRename,
    handleProjectDelete,
  };
}
