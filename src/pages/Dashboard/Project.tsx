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
import GroupedHistoryView from '@/components/GroupedHistoryView';
import AlertDialog from '@/components/ui/alertDialog';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { share } from '@/lib/share';
import { fetchHistoryTasks } from '@/service/historyApi';
import { Bird, CodeXml, FileText, Globe, Image } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

export default function Project() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [deleteCallback, setDeleteCallback] = useState<() => void>(() => {});
  const { chatStore, projectStore } = useChatStoreAdapter();
  // const { history_type, setHistoryType } = useGlobalStore();
  const [_historyTasks, setHistoryTasks] = useState<any[]>([]);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [curHistoryId, setCurHistoryId] = useState('');
  const [deleteProjectModalOpen, setDeleteProjectModalOpen] = useState(false);
  const [curProjectId, setCurProjectId] = useState('');
  const [refreshTrigger, _setRefreshTrigger] = useState(0);
  const [projectDeleteCallback, setProjectDeleteCallback] = useState<
    (() => Promise<void>) | null
  >(null);

  useEffect(() => {
    if (!chatStore || !projectStore) return;
    fetchHistoryTasks(setHistoryTasks);
  }, [chatStore, projectStore]);

  if (!chatStore || !projectStore) {
    return <div>Loading...</div>;
  }
  const agentMap = {
    developer_agent: {
      name: t('dashboard.developer-agent'),
      textColor: 'text-text-developer',
      bgColor: 'bg-bg-fill-coding-active',
      shapeColor: 'bg-bg-fill-coding-default',
      borderColor: 'border-bg-fill-coding-active',
      bgColorLight: 'bg-emerald-200',
    },
    browser_agent: {
      name: t('dashboard.browser-agent'),

      textColor: 'text-blue-700',
      bgColor: 'bg-bg-fill-browser-active',
      shapeColor: 'bg-bg-fill-browser-default',
      borderColor: 'border-bg-fill-browser-active',
      bgColorLight: 'bg-blue-200',
    },
    document_agent: {
      name: t('dashboard.document-agent'),

      textColor: 'text-yellow-700',
      bgColor: 'bg-bg-fill-writing-active',
      shapeColor: 'bg-bg-fill-writing-default',
      borderColor: 'border-bg-fill-writing-active',
      bgColorLight: 'bg-yellow-200',
    },
    multi_modal_agent: {
      name: t('dashboard.multi-modal-agent'),

      textColor: 'text-fuchsia-700',
      bgColor: 'bg-bg-fill-multimodal-active',
      shapeColor: 'bg-bg-fill-multimodal-default',
      borderColor: 'border-bg-fill-multimodal-active',
      bgColorLight: 'bg-fuchsia-200',
    },
    social_media_agent: {
      name: t('dashboard.social-media-agent'),

      textColor: 'text-purple-700',
      bgColor: 'bg-violet-700',
      shapeColor: 'bg-violet-300',
      borderColor: 'border-violet-700',
      bgColorLight: 'bg-purple-50',
    },
  };

  const _agentIconMap = {
    developer_agent: (
      <CodeXml
        className={`!h-[10px] !w-[10px] ${agentMap.developer_agent.textColor}`}
      />
    ),
    browser_agent: (
      <Globe
        className={`!h-[10px] !w-[10px] ${agentMap.browser_agent.textColor}`}
      />
    ),
    document_agent: (
      <FileText
        className={`!h-[10px] !w-[10px] ${agentMap.document_agent.textColor}`}
      />
    ),
    multi_modal_agent: (
      <Image
        className={`!h-[10px] !w-[10px] ${agentMap.multi_modal_agent.textColor}`}
      />
    ),
    social_media_agent: (
      <Bird
        className={`!h-[10px] !w-[10px] ${agentMap.social_media_agent.textColor}`}
      />
    ),
  };

  const _handleClickAgent = (taskId: string, agent_id: string) => {
    chatStore.setActiveTaskId(taskId);
    chatStore.setActiveWorkSpace(taskId, 'workflow');
    chatStore.setActiveAgent(taskId, agent_id);
    navigate(`/`);
  };

  const handleDelete = (id: string, callback?: () => void) => {
    setCurHistoryId(id);
    setDeleteModalOpen(true);
    if (callback) setDeleteCallback(callback);
  };

  const confirmDelete = async () => {
    const id = curHistoryId;
    if (!id) return;
    try {
      await proxyFetchDelete(`/api/chat/history/${id}`);
      setHistoryTasks((list) => list.filter((item) => item.id !== id));
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

  const handleReplay = async (taskId: string, question: string) => {
    chatStore.replay(taskId, question, 0);
    navigate({ pathname: '/' });
  };

  const handleSetActive = (taskId: string, question: string) => {
    const task = chatStore.tasks[taskId];
    if (task) {
      // if there is a record, display the result
      chatStore.setActiveTaskId(taskId);
      navigate(`/`);
    } else {
      // if there is no record, execute replay
      handleReplay(taskId, question);
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
      chatStore.setStatus(taskId, 'pause');
    } else {
      chatStore.setStatus(taskId, 'running');
    }
  };

  // Feature flag to hide table view without deleting code
  const _TABLE_VIEW_ENABLED = false;

  return (
    <div className="m-auto h-auto flex-1">
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

      {/* Header Section */}
      <div className="flex w-full border-x-0 border-t-0 border-solid border-border-disabled">
        <div className="mx-auto flex w-full max-w-[900px] items-center justify-between px-6 pb-4 pt-8">
          <div className="flex w-full flex-row items-center justify-between gap-4">
            <div className="flex flex-col">
              <div className="text-heading-sm font-bold text-text-heading">
                {t('layout.projects-hub')}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex w-full">
        <div className="mx-auto flex min-h-[calc(100vh-86px)] w-full max-w-[900px] flex-col items-start justify-start px-6 py-8">
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
            onOngoingTaskPause={(taskId) => handleTakeControl('pause', taskId)}
            onOngoingTaskResume={(taskId) =>
              handleTakeControl('resume', taskId)
            }
            onOngoingTaskDelete={(taskId) => handleDelete(taskId)}
            onProjectDelete={handleProjectDelete}
            refreshTrigger={refreshTrigger}
          />
        </div>
      </div>
    </div>
  );
}
