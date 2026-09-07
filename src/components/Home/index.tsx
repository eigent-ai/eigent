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

import { proxyFetchDelete } from '@/api/http';
import AlertDialog from '@/components/ui/alertDialog';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { share } from '@/lib/share';
import { takeControlOfTask } from '@/lib/taskRuntimeControl';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  HomeHubProvider,
  type HomeSortBy,
  type HomeSortDirection,
  type HomeViewMode,
} from './context';
import { useHomeHubCounts } from './hooks/useHomeHubCounts';
import { useHomeHubProjects } from './hooks/useHomeHubProjects';
import { useHomeHubTriggers } from './hooks/useHomeHubTriggers';
import { useHomeSection } from './hooks/useHomeSection';
import { useNewSpaceCreation } from './hooks/useNewSpaceCreation';
import NewSpaceDialog from './NewSpaceDialog';
import { persistHomeViewMode, readStoredHomeViewMode } from './utils';

export { default as HomeGreeting } from './HomeGreeting';
export { default as HomeHeader } from './HomeHeader';
export { default as HomeSections } from './HomeSections';
export { HomeSidebarNavGroup } from './HomeSidebarNav';

/**
 * Data + dialog host for the home surface. Rendered above the app shell so the
 * sidebar rail (tab counts) and the content pane (header controls + tables)
 * read the same hub state.
 */
export default function HomeHubRoot({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { section: activeTab } = useHomeSection();
  const { chatStore } = useChatStoreAdapter();
  const {
    projects,
    loading: projectsLoading,
    removeTaskFromProjects,
    handleProjectRename,
    handleProjectDelete: hubHandleProjectDelete,
  } = useHomeHubProjects();
  const { triggers, triggersLoading, reloadTriggers } = useHomeHubTriggers();
  const sectionCounts = useHomeHubCounts(projects);

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteCallback, setDeleteCallback] = useState<() => void>(() => {});
  const [curHistoryId, setCurHistoryId] = useState('');
  const [deleteProjectModalOpen, setDeleteProjectModalOpen] = useState(false);
  const [curProjectId, setCurProjectId] = useState('');
  const [projectDeleteCallback, setProjectDeleteCallback] = useState<
    (() => Promise<void>) | null
  >(null);

  const [viewMode, setViewModeState] = useState<HomeViewMode>(
    readStoredHomeViewMode
  );
  const setViewMode = useCallback((mode: HomeViewMode) => {
    setViewModeState(mode);
    persistHomeViewMode(mode);
  }, []);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<HomeSortBy>('created');
  const [sortDirection, setSortDirection] = useState<HomeSortDirection>('desc');
  const [newSpaceDialogOpen, setNewSpaceDialogOpen] = useState(false);
  const { createBlankSpace, createSpaceFromFolder } =
    useNewSpaceCreation('home_hub');

  useEffect(() => {
    setSearchQuery('');
    setSortBy('created');
    setSortDirection('desc');
  }, [activeTab]);

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

  const handleTakeControl = useCallback(
    (type: 'pause' | 'resume', taskId: string, projectId: string) =>
      takeControlOfTask({ chatStore, action: type, projectId, taskId }),
    [chatStore]
  );

  const hubContextValue = useMemo(
    () => ({
      sectionCounts,
      viewMode,
      setViewMode,
      searchQuery,
      setSearchQuery,
      sortBy,
      setSortBy,
      sortDirection,
      setSortDirection,
      openNewSpaceDialog: () => setNewSpaceDialogOpen(true),
      projects,
      projectsLoading,
      triggers,
      triggersLoading,
      reloadTriggers,
      chatTasks: chatStore?.tasks,
      onTaskDelete: handleDelete,
      onTaskShare: handleShare,
      onProjectDelete: handleProjectDelete,
      onProjectRename: handleProjectRename,
      activeTaskId: chatStore?.activeTaskId || undefined,
      onOngoingTaskPause: async (taskId: string, projectId: string) => {
        await handleTakeControl('pause', taskId, projectId);
      },
      onOngoingTaskResume: async (taskId: string, projectId: string) => {
        await handleTakeControl('resume', taskId, projectId);
      },
    }),
    // `handle*` callbacks aren't memoized themselves and the parent re-renders
    // are infrequent; include only the data dependencies React tracks here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      sectionCounts,
      viewMode,
      searchQuery,
      sortBy,
      sortDirection,
      projects,
      projectsLoading,
      triggers,
      triggersLoading,
      reloadTriggers,
      chatStore?.tasks,
      chatStore?.activeTaskId,
      handleTakeControl,
    ]
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
        title={t('layout.delete-project') || 'Delete session'}
        message={
          t('layout.delete-project-confirmation') ||
          'Are you sure you want to delete this session and all its tasks? This action cannot be undone.'
        }
        confirmText={t('layout.delete')}
        cancelText={t('layout.cancel')}
        confirmVariant="secondary"
        confirmTone="error"
      />

      <NewSpaceDialog
        open={newSpaceDialogOpen}
        onOpenChange={setNewSpaceDialogOpen}
        onStartFromScratch={createBlankSpace}
        onUseLocalFolder={createSpaceFromFolder}
      />

      {children}
    </HomeHubProvider>
  );
}
