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
import GroupedHistoryView from '@/components/Dashboard/GroupedHistoryView';
import VerticalNavigation, {
  type VerticalNavItem,
} from '@/components/Dashboard/VerticalNav';
import AlertDialog from '@/components/ui/alertDialog';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { loadProjectFromHistory } from '@/lib';
import { share } from '@/lib/share';
import { ChatTaskStatus } from '@/types/constants';
import { Folder, ListChecks, MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

const PROJECT_PAGE_TABS = ['project', 'sessions', 'tasks'] as const;
type ProjectPageTab = (typeof PROJECT_PAGE_TABS)[number];

export default function Project() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [deleteCallback, setDeleteCallback] = useState<() => void>(() => {});
  const { chatStore, projectStore } = useChatStoreAdapter();
  const [projectPageTab, setProjectPageTab] =
    useState<ProjectPageTab>('project');
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

  const sidebarNavItems = [
    {
      id: 'project' as const,
      name: t('layout.projects-heading'),
      icon: <Folder className="h-4 w-4 shrink-0" />,
    },
    {
      id: 'sessions' as const,
      name: t('layout.sessions-heading'),
      icon: <MessageCircle className="h-4 w-4 shrink-0" />,
    },
    {
      id: 'tasks' as const,
      name: t('layout.tasks-heading'),
      icon: <ListChecks className="h-4 w-4 shrink-0" />,
    },
  ];

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

      <div className="flex h-auto min-h-[calc(100vh-86px)] w-full">
        <div className="top-20 w-40 pr-6 pt-8 min-h-0 sticky flex h-full flex-shrink-0 flex-grow-0 flex-col self-start">
          <VerticalNavigation
            items={
              sidebarNavItems.map((item) => ({
                value: item.id,
                icon: item.icon,
                label: (
                  <span className="text-body-sm font-bold">{item.name}</span>
                ),
              })) as VerticalNavItem[]
            }
            value={projectPageTab}
            onValueChange={(v) => {
              if (PROJECT_PAGE_TABS.includes(v as ProjectPageTab)) {
                setProjectPageTab(v as ProjectPageTab);
              }
            }}
            className="min-h-0 gap-0 h-full w-full flex-1"
            listClassName="w-full h-full overflow-y-auto"
            contentClassName="hidden"
          />
        </div>

        <div className="min-h-0 min-w-0 flex w-full flex-1 flex-col">
          {projectPageTab === 'project' && (
            <>
              {/* Header Section */}
              <div className="top-0 px-6 pb-6 pt-8 sticky z-10 flex w-full items-center justify-between">
                <div className="gap-4 flex w-full flex-col items-start justify-between">
                  <div className="flex flex-col">
                    <div className="text-heading-sm font-bold text-ds-text-neutral-default-default">
                      {t('layout.projects-hub')}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex w-full">
                <div className="pb-8 mx-auto flex min-h-[calc(100vh-86px)] w-full max-w-[940px] flex-col items-start justify-start">
                  <GroupedHistoryView
                    onTaskSelect={handleSetActive}
                    onTaskDelete={handleDelete}
                    onTaskShare={handleShare}
                    activeTaskId={chatStore.activeTaskId || undefined}
                    ongoingTasks={chatStore.tasks}
                    onOngoingTaskClick={(taskId) => {
                      chatStore.setActiveTaskId(taskId);
                      navigate(`/`);
                    }}
                    onOngoingTaskPause={(taskId) =>
                      handleTakeControl('pause', taskId)
                    }
                    onOngoingTaskResume={(taskId) =>
                      handleTakeControl('resume', taskId)
                    }
                    onOngoingTaskDelete={(taskId) => handleDelete(taskId)}
                    onProjectDelete={handleProjectDelete}
                  />
                </div>
              </div>
            </>
          )}

          {projectPageTab === 'sessions' && (
            <div className="min-h-0 py-8 flex flex-1 flex-col overflow-hidden">
              <div className="min-h-0 flex-1 overflow-hidden" />
            </div>
          )}

          {projectPageTab === 'tasks' && (
            <div className="min-h-0 py-8 flex flex-1 flex-col overflow-hidden">
              <div className="min-h-0 flex-1 overflow-hidden" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
