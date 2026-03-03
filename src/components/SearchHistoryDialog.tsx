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

'use client';

import { proxyFetchDelete } from '@/api/http';
import GroupedHistoryView from '@/components/GroupedHistoryView';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { loadProjectFromHistory } from '@/lib';
import { share } from '@/lib/share';
import { fetchHistoryTasks } from '@/service/historyApi';
import { getAuthStore } from '@/store/authStore';
import { useGlobalStore } from '@/store/globalStore';
import { HistoryTask } from '@/types/history';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { Ellipsis, ScanFace, Search, Share2, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { DialogTitle } from './ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

export function SearchHistoryDialog() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [historyTasks, setHistoryTasks] = useState<any[]>([]);
  const { history_type } = useGlobalStore();
  //Get Chatstore for the active project's task
  const { chatStore, projectStore } = useChatStoreAdapter();

  const navigate = useNavigate();
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
      setOpen(false);
    } else {
      setOpen(false);
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

  const handleDelete = async (
    historyId: string,
    task: HistoryTask | undefined,
    callback: () => void
  ) => {
    try {
      await proxyFetchDelete(`/api/chat/history/${historyId}`);

      if (
        task?.task_id &&
        (window as unknown as { ipcRenderer?: object }).ipcRenderer
      ) {
        const { email } = getAuthStore();
        try {
          await (
            window as unknown as {
              ipcRenderer: {
                invoke: (
                  a: string,
                  b: string,
                  c: string,
                  d?: string
                ) => Promise<void>;
              };
            }
          ).ipcRenderer.invoke(
            'delete-task-files',
            email,
            task.task_id,
            task.project_id ?? undefined
          );
        } catch (error) {
          console.warn('Local file cleanup failed:', error);
        }
      }

      callback();
      toast.success(t('layout.delete-success') || 'Task deleted successfully');
    } catch (error) {
      console.error('Failed to delete history task:', error);
      toast.error(t('layout.delete-failed') || 'Failed to delete task');
    }
  };

  const handleShare = async (taskId: string) => {
    setOpen(false);
    await share(taskId);
  };

  useEffect(() => {
    fetchHistoryTasks(setHistoryTasks);
  }, []);

  if (!chatStore) {
    return <div>Loading...</div>;
  }

  return (
    <>
      <Button
        variant="ghost"
        className="h-[32px] border border-solid border-menutabs-border-default bg-menutabs-bg-default"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <Search className="text-menutabs-icon-active" size={16} />
        <span>{t('dashboard.search')}</span>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <DialogTitle asChild>
          <VisuallyHidden>{t('dashboard.search-dialog')}</VisuallyHidden>
        </DialogTitle>
        <CommandInput placeholder={t('dashboard.search-dialog-placeholder')} />
        <CommandList>
          <CommandEmpty>{t('dashboard.no-results')}</CommandEmpty>
          {history_type === 'grid' ? (
            <div className="p-4">
              <GroupedHistoryView
                onTaskSelect={handleSetActive}
                onTaskDelete={handleDelete}
                onTaskShare={handleShare}
                activeTaskId={chatStore.activeTaskId || undefined}
              />
            </div>
          ) : (
            <CommandGroup heading="Today">
              {historyTasks.map((task) => (
                <CommandItem
                  key={task.id}
                  className="flex cursor-pointer items-center justify-between gap-2"
                  onSelect={() =>
                    handleSetActive(
                      task.project_id || task.task_id,
                      task.question,
                      String(task.id),
                      {
                        tasks: task.tasks || [{ task_id: task.task_id }],
                        project_name: task.project_name,
                      }
                    )
                  }
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <ScanFace className="h-4 w-4 flex-shrink-0" />
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                      {task.question}
                    </span>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 flex-shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Ellipsis className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          handleShare(task.task_id || String(task.id));
                        }}
                      >
                        <Share2 className="mr-2 h-4 w-4" />
                        {t('layout.share')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-text-cuation"
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            await handleDelete(
                              String(task.id),
                              task,
                              () => {
                                setHistoryTasks((prev) =>
                                  prev.filter((t) => t.id !== task.id)
                                );
                              }
                            );
                          } catch {
                            // Error already handled in handleDelete
                          }
                        }}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {t('layout.delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          <CommandSeparator />
        </CommandList>
      </CommandDialog>
    </>
  );
}
