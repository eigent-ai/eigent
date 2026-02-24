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

import { ScanFace, Search } from 'lucide-react';
import { useEffect, useState } from 'react';

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
import { fetchHistoryTasks } from '@/service/historyApi';
import { useGlobalStore } from '@/store/globalStore';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from './ui/button';
import { DialogTitle } from './ui/dialog';

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
    project?: {
      tasks: { task_id: string; question?: string }[];
      project_name?: string;
    }
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
      const questions = project?.tasks?.map((t) => t.question || question) || [
        question,
      ];
      await loadProjectFromHistory(
        projectStore,
        navigate,
        projectId,
        questions,
        historyId,
        taskIdsList,
        project?.project_name
      );
    }
  };

  const handleDelete = (taskId: string) => {
    // TODO: Implement delete functionality similar to HistorySidebar
    console.log('Delete task:', taskId);
  };

  const handleShare = (taskId: string) => {
    // TODO: Implement share functionality similar to HistorySidebar
    console.log('Share task:', taskId);
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
                  className="cursor-pointer"
                  /**
                   * TODO(history): Update to use project_id field
                   * after update instead.
                   */
                  onSelect={() =>
                    handleSetActive(
                      task.task_id,
                      task.question,
                      String(task.id)
                    )
                  }
                >
                  <ScanFace />
                  <div className="overflow-hidden text-ellipsis whitespace-nowrap">
                    {task.question}
                  </div>
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
