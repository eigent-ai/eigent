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

import {
  buildTaskQuestionsById,
  computeProjectFreshnessAnchor,
  loadProjectFromHistory,
} from '@/lib/replay';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSpaceStore } from '@/store/spaceStore';
import type { Trigger } from '@/types';
import type {
  HistoryTask,
  ProjectGroup as ProjectGroupType,
} from '@/types/history';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export function useHomeHubNavigation() {
  const navigate = useNavigate();
  const projectStore = useProjectRuntimeStore();
  const setActiveSpace = useSpaceStore((s) => s.setActiveSpace);
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);
  const requestSelectTrigger = usePageTabStore((s) => s.requestSelectTrigger);
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null);

  const openSpace = useCallback(
    (spaceId: string) => {
      setActiveSpace(spaceId);
      projectStore.setActiveProject(null);
      setActiveWorkspaceTab('workforce');
      navigate('/');
    },
    [navigate, projectStore, setActiveSpace, setActiveWorkspaceTab]
  );

  const openProject = useCallback(
    async (project: ProjectGroupType) => {
      const projectId = project.project_id;
      setLoadingProjectId(projectId);

      try {
        const existingProject = projectStore.getProjectById(projectId);

        if (existingProject) {
          if (project.space_id) {
            setActiveSpace(project.space_id);
          }
          projectStore.setActiveProject(projectId);
          setActiveWorkspaceTab('project');
          navigate('/');
          return;
        }

        const firstTask = project.tasks?.[0];
        if (firstTask) {
          const question = firstTask.question || project.last_prompt || '';
          const historyId = firstTask.id?.toString() || '';
          const taskIdsList = project.tasks
            ?.map((task) => task.task_id)
            .filter(Boolean) || [projectId];

          await loadProjectFromHistory(
            projectStore,
            navigate,
            projectId,
            question,
            historyId,
            taskIdsList,
            project.project_name,
            project.space_id,
            buildTaskQuestionsById(project.tasks),
            computeProjectFreshnessAnchor(project)
          );
          setActiveWorkspaceTab('project');
          return;
        }

        if (project.space_id) {
          setActiveSpace(project.space_id);
        }
        projectStore.createProject(
          project.project_name || 'Project',
          'Project with triggers',
          projectId
        );
        setActiveWorkspaceTab('project');
        navigate('/');
      } catch (error) {
        console.error('[HomeHub] Failed to open project:', error);
      } finally {
        setLoadingProjectId(null);
      }
    },
    [navigate, projectStore, setActiveSpace, setActiveWorkspaceTab]
  );

  const openTask = useCallback(
    async (task: HistoryTask, project?: ProjectGroupType) => {
      const projectId = task.project_id;
      const historyId = String(task.id);
      const question = task.question || project?.last_prompt || '';
      setLoadingProjectId(projectId);

      try {
        const existingProject = projectStore.getProjectById(projectId);

        if (existingProject) {
          if (project?.space_id || task.space_id) {
            setActiveSpace(project?.space_id || task.space_id!);
          }
          projectStore.setHistoryId(projectId, historyId);
          projectStore.setActiveProject(projectId);
          setActiveWorkspaceTab('project');
          navigate('/');
          return;
        }

        const taskIdsList = project?.tasks
          ?.map((entry) => entry.task_id)
          .filter(Boolean) || [projectId];

        await loadProjectFromHistory(
          projectStore,
          navigate,
          projectId,
          question,
          historyId,
          taskIdsList,
          project?.project_name,
          project?.space_id || task.space_id,
          project
            ? buildTaskQuestionsById(project.tasks)
            : { [taskIdsList[0]]: question },
          computeProjectFreshnessAnchor(project)
        );
        setActiveWorkspaceTab('project');
      } catch (error) {
        console.error('[HomeHub] Failed to open task:', error);
      } finally {
        setLoadingProjectId(null);
      }
    },
    [navigate, projectStore, setActiveSpace, setActiveWorkspaceTab]
  );

  const openTrigger = useCallback(
    async (trigger: Trigger) => {
      if (trigger.space_id) {
        setActiveSpace(trigger.space_id);
      }

      if (trigger.project_id) {
        const existingProject = projectStore.getProjectById(trigger.project_id);
        if (existingProject) {
          projectStore.setActiveProject(trigger.project_id);
        } else {
          projectStore.createProject(
            trigger.name || 'Project',
            'Project with triggers',
            trigger.project_id
          );
        }
      } else {
        projectStore.setActiveProject(null);
      }

      setActiveWorkspaceTab('triggers');
      requestSelectTrigger(trigger.id);
      navigate('/');
    },
    [
      navigate,
      projectStore,
      requestSelectTrigger,
      setActiveSpace,
      setActiveWorkspaceTab,
    ]
  );

  return {
    openSpace,
    openProject,
    openTask,
    openTrigger,
    loadingProjectId,
  };
}
