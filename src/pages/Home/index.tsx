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
import VerticalNavigation, {
  type VerticalNavItem,
} from '@/components/Dashboard/VerticalNav';
import AlertDialog from '@/components/ui/alertDialog';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { share } from '@/lib/share';
import { ChatTaskStatus } from '@/types/constants';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { HomeHubProvider, type HomeViewMode } from './context';
import { useHomeHubCounts } from './hooks/useHomeHubCounts';
import { useHomeHubProjects } from './hooks/useHomeHubProjects';
import Projects from './Projects';
import Spaces from './Spaces';
import Tasks from './Tasks';
import Triggers from './Triggers';
import { capitalizeLabel } from './utils';

const HOME_SECTIONS = ['spaces', 'projects', 'tasks', 'triggers'] as const;
type HomeSection = (typeof HOME_SECTIONS)[number];

function isHomeSection(value: string | null): value is HomeSection {
  return value !== null && HOME_SECTIONS.includes(value as HomeSection);
}

export default function HomeHub() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sectionFromUrl = searchParams.get('section');
  const { chatStore } = useChatStoreAdapter();
  const {
    projects,
    loading: projectsLoading,
    removeTaskFromProjects,
    handleProjectRename,
    handleProjectDelete: hubHandleProjectDelete,
  } = useHomeHubProjects();
  const sectionCounts = useHomeHubCounts(projects);

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteCallback, setDeleteCallback] = useState<() => void>(() => {});
  const [curHistoryId, setCurHistoryId] = useState('');
  const [deleteProjectModalOpen, setDeleteProjectModalOpen] = useState(false);
  const [curProjectId, setCurProjectId] = useState('');
  const [projectDeleteCallback, setProjectDeleteCallback] = useState<
    (() => Promise<void>) | null
  >(null);

  // URL is the source of truth for the active section — derive directly
  // instead of mirroring into local state (avoids a resync window).
  const activeTab: HomeSection = isHomeSection(sectionFromUrl)
    ? sectionFromUrl
    : 'spaces';
  const [viewMode, setViewMode] = useState<HomeViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    setSearchQuery('');
  }, [activeTab]);

  const menuItems = useMemo(
    () => [
      {
        id: 'spaces' as const,
        name: capitalizeLabel(t('layout.spaces')),
        count: sectionCounts.spaces,
      },
      {
        id: 'projects' as const,
        name: capitalizeLabel(t('layout.projects')),
        count: sectionCounts.projects,
      },
      {
        id: 'tasks' as const,
        name: capitalizeLabel(t('layout.tasks')),
        count: sectionCounts.tasks,
      },
      {
        id: 'triggers' as const,
        name: capitalizeLabel(t('layout.triggers')),
        count: sectionCounts.triggers,
      },
    ],
    [sectionCounts, t]
  );

  const handleTabChange = (tabId: string) => {
    if (!HOME_SECTIONS.includes(tabId as HomeSection)) return;
    navigate(`?tab=home&section=${tabId}`, { replace: true });
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
      await proxyFetchDelete(`/api/v1/chat/history/${id}`);
      if (chatStore?.tasks?.[id]) {
        chatStore.removeTask(id);
      }
      removeTaskFromProjects(id);
    } catch (error) {
      console.error('Failed to delete history task:', error);
    } finally {
      setCurHistoryId('');
      setDeleteModalOpen(false);
      deleteCallback();
    }
  };

  const handleProjectDelete = (projectId: string) => {
    hubHandleProjectDelete(projectId, (deleteCallbackFn) => {
      setCurProjectId(projectId);
      setProjectDeleteCallback(() => deleteCallbackFn);
      setDeleteProjectModalOpen(true);
    });
  };

  const confirmProjectDelete = async () => {
    const projectId = curProjectId;
    if (!projectId || !projectDeleteCallback) return;

    try {
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

  const handleTakeControl = (type: 'pause' | 'resume', taskId: string) => {
    if (!chatStore?.tasks?.[taskId]) return;

    if (type === 'pause') {
      let { taskTime, elapsed } = chatStore.tasks[taskId];
      const now = Date.now();
      elapsed += now - taskTime;
      chatStore.setElapsed(taskId, elapsed);
      chatStore.setTaskTime(taskId, 0);
    } else {
      chatStore.setTaskTime(taskId, Date.now());
    }
    fetchPut(`/task/${taskId}/take-control`, { action: type });
    if (type === 'pause') {
      chatStore.setStatus(taskId, ChatTaskStatus.PAUSE);
    } else {
      chatStore.setStatus(taskId, ChatTaskStatus.RUNNING);
    }
  };

  const hubContextValue = useMemo(
    () => ({
      viewMode,
      setViewMode,
      searchQuery,
      setSearchQuery,
      projects,
      projectsLoading,
      onTaskDelete: handleDelete,
      onTaskShare: handleShare,
      onProjectDelete: handleProjectDelete,
      onProjectRename: handleProjectRename,
      activeTaskId: chatStore?.activeTaskId || undefined,
      onOngoingTaskPause: (taskId: string) =>
        handleTakeControl('pause', taskId),
      onOngoingTaskResume: (taskId: string) =>
        handleTakeControl('resume', taskId),
    }),
    // `handle*` callbacks aren't memoized themselves and the parent re-renders
    // are infrequent; include only the data dependencies React tracks here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewMode, searchQuery, projects, projectsLoading, chatStore?.activeTaskId]
  );

  return (
    <HomeHubProvider value={hubContextValue}>
      <AlertDialog
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={confirmDelete}
        title={t('layout.delete-task')}
        message={t('layout.delete-task-confirmation')}
        confirmText={t('layout.delete')}
        cancelText={t('layout.cancel')}
      />

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

      <div className="flex h-auto w-full">
        <div className="top-20 w-40 pr-6 pt-8 sticky flex h-full flex-shrink-0 flex-grow-0 flex-col justify-between self-start">
          <VerticalNavigation
            items={
              menuItems.map((menu) => ({
                value: menu.id,
                label: (
                  <div className="flex w-full items-center justify-between">
                    <span className="text-body-sm font-bold w-full text-left">
                      {menu.name}
                    </span>
                    <div className="bg-ds-bg-brand-subtle-disabled px-1 flex items-center justify-center rounded-full">
                      <span className="font-normal text-label-xs text-ds-text-brand-strong-default tabular-nums">
                        {menu.count}
                      </span>
                    </div>
                  </div>
                ),
              })) as VerticalNavItem[]
            }
            value={activeTab}
            onValueChange={handleTabChange}
            className="min-h-0 gap-0 h-full w-full flex-1"
            listClassName="w-full h-full overflow-y-auto"
            contentClassName="hidden"
          />
        </div>

        <div className="min-w-0 mx-auto flex min-h-[calc(100vh-86px)] w-full max-w-[940px] flex-1 flex-col">
          {activeTab === 'spaces' && <Spaces />}
          {activeTab === 'projects' && <Projects />}
          {activeTab === 'tasks' && <Tasks />}
          {activeTab === 'triggers' && <Triggers />}
        </div>
      </div>
    </HomeHubProvider>
  );
}
