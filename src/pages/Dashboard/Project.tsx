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

import { fetchPut, proxyFetchDelete } from '@/api/http';
import AlertDialog from '@/components/ui/alertDialog';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { loadProjectFromHistory } from '@/lib';
import { share } from '@/lib/share';
import { ChatTaskStatus } from '@/types/constants';
import type { ProjectGroup } from '@/types/history';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import GroupedHistoryView from './GroupedHistoryView';
import type { DashboardViewMode } from './useDashboardData';

type Props = {
  projects: ProjectGroup[];
  isLoading: boolean;
  updateProjects: (updater: (prev: ProjectGroup[]) => ProjectGroup[]) => void;
  invalidate: () => Promise<void>;
  viewMode: DashboardViewMode;
};

export default function Project({
  projects,
  isLoading,
  updateProjects,
  invalidate,
  viewMode,
}: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [deleteCallback, setDeleteCallback] = useState<() => void>(() => {});
  const { chatStore, projectStore } = useChatStoreAdapter();
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [curHistoryId, setCurHistoryId] = useState('');
  const [deleteProjectModalOpen, setDeleteProjectModalOpen] = useState(false);
  const [curProjectId, setCurProjectId] = useState('');
  const [projectDeleteCallback, setProjectDeleteCallback] = useState<
    (() => Promise<void>) | null
  >(null);

  if (!chatStore || !projectStore) {
    return <div>Loading...</div>;
  }
  const handleDelete = (id: string, callback?: () => void) => {
    setCurHistoryId(id);
    setDeleteModalOpen(true);
    if (callback) setDeleteCallback(callback);
  };

  const confirmDelete = async () => {
    const id = curHistoryId;
    if (!id) return;
    try {
      await proxyFetchDelete(`/api/v1/chat/history/${id}`);
      if (chatStore.tasks[id]) {
        chatStore.removeTask(id);
      }
    } catch (error) {
      console.error('Failed to delete history task:', error);
    } finally {
      setCurHistoryId('');
      setDeleteModalOpen(false);
      deleteCallback();
    }
  };

  const handleProjectDelete = (
    projectId: string,
    callback: () => Promise<void>
  ) => {
    setCurProjectId(projectId);
    setProjectDeleteCallback(() => callback);
    setDeleteProjectModalOpen(true);
  };

  const confirmProjectDelete = async () => {
    const projectId = curProjectId;
    if (!projectId || !projectDeleteCallback) return;

    try {
      // Execute the deletion callback provided by GroupedHistoryView
      await projectDeleteCallback();
    } catch (error) {
      console.error('Failed to delete project:', error);
    } finally {
      setCurProjectId('');
      setProjectDeleteCallback(null);
      setDeleteProjectModalOpen(false);
    }
  };

  const handleShare = async (taskId: string) => {
    share(taskId);
  };

  const handleSetActive = async (
    projectId: string,
    question: string,
    historyId: string,
    project?: { tasks: { task_id: string }[]; project_name?: string }
  ) => {
    const existingProject = projectStore.getProjectById(projectId);
    if (existingProject) {
      projectStore.setHistoryId(projectId, historyId);
      projectStore.setActiveProject(projectId);
      navigate(`/`);
    } else {
      const taskIdsList = project?.tasks
        ?.map((t) => t.task_id)
        .filter(Boolean) || [projectId];
      await loadProjectFromHistory(
        projectStore,
        navigate,
        projectId,
        question,
        historyId,
        taskIdsList,
        project?.project_name
      );
    }
  };

  const handleTakeControl = (type: 'pause' | 'resume', taskId: string) => {
    if (type === 'pause') {
      let { taskTime, elapsed } = chatStore.tasks[taskId];

      const now = Date.now();
      elapsed += now - taskTime;
      chatStore.setElapsed(taskId, elapsed);
      chatStore.setTaskTime(taskId, 0);
    } else {
      chatStore.setTaskTime(taskId, Date.now());
    }
    fetchPut(`/task/${taskId}/take-control`, {
      action: type,
    });
    if (type === 'pause') {
      chatStore.setStatus(taskId, ChatTaskStatus.PAUSE);
    } else {
      chatStore.setStatus(taskId, ChatTaskStatus.RUNNING);
    }
  };

  return (
    <div className="flex w-full flex-1 flex-col">
      {/* alert dialog for task deletion */}
      <AlertDialog
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={confirmDelete}
        title={t('layout.delete-task')}
        message={t('layout.delete-task-confirmation')}
        confirmText={t('layout.delete')}
        cancelText={t('layout.cancel')}
      />

      {/* alert dialog for project deletion */}
      <AlertDialog
        isOpen={deleteProjectModalOpen}
        onClose={() => setDeleteProjectModalOpen(false)}
        onConfirm={confirmProjectDelete}
        title={t('layout.delete-project') || 'Delete Project'}
        message={
          t('layout.delete-project-confirmation') ||
          'Are you sure you want to delete this project and all its tasks? This action cannot be undone.'
        }
        confirmText={t('layout.delete')}
        cancelText={t('layout.cancel')}
      />

      <div className="min-w-0 flex h-auto min-h-[calc(100vh-86px)] w-full flex-col">
        <div className="pb-8 mx-auto flex min-h-[calc(100vh-86px)] w-full flex-col items-start justify-start">
          <GroupedHistoryView
            projects={projects}
            isLoading={isLoading}
            updateProjects={updateProjects}
            invalidate={invalidate}
            viewMode={viewMode}
            onTaskSelect={handleSetActive}
            onTaskDelete={handleDelete}
            onTaskShare={handleShare}
            activeTaskId={chatStore.activeTaskId || undefined}
            ongoingTasks={chatStore.tasks}
            onOngoingTaskClick={(taskId) => {
              chatStore.setActiveTaskId(taskId);
              navigate(`/`);
            }}
            onOngoingTaskPause={(taskId) => handleTakeControl('pause', taskId)}
            onOngoingTaskResume={(taskId) =>
              handleTakeControl('resume', taskId)
            }
            onOngoingTaskDelete={(taskId) => handleDelete(taskId)}
            onProjectDelete={handleProjectDelete}
          />
        </div>
      </div>
    </div>
  );
}
