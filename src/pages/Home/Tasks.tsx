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

import { HistoryTask, ProjectGroup as ProjectGroupType } from '@/types/history';
import { ListChecks } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import HomeHubCard from './components/HomeHubCard';
import HomeHubListItem from './components/HomeHubListItem';
import SectionHeader from './components/SectionHeader';
import { useHomeHub } from './context';
import { useSpaceLabel } from './hooks/useSpaceLabel';
import { capitalizeLabel, matchesHubNameSearch } from './utils';

type TaskWithContext = HistoryTask & { projectName?: string };

function TaskRow({
  task,
  viewMode,
  subtitle,
  project,
  onDelete,
  onShare,
}: {
  task: TaskWithContext;
  viewMode: 'grid' | 'list';
  subtitle: string;
  project?: ProjectGroupType;
  onDelete: () => void;
  onShare: () => void;
}) {
  const spaceLabel = useSpaceLabel(task.space_id);
  const sharedProps = {
    kind: 'task' as const,
    task,
    spaceLabel,
    subtitle,
    project,
    onDelete,
    onShare,
  };

  return viewMode === 'grid' ? (
    <HomeHubCard {...sharedProps} />
  ) : (
    <HomeHubListItem {...sharedProps} />
  );
}

export default function Tasks() {
  const { t } = useTranslation();
  const {
    viewMode,
    searchQuery,
    projects,
    projectsLoading,
    onTaskDelete,
    onTaskShare,
  } = useHomeHub();

  const tasks = useMemo<TaskWithContext[]>(() => {
    return projects
      .flatMap((project) =>
        project.tasks.map((task) => ({
          ...task,
          projectName: project.project_name,
          space_id: task.space_id || project.space_id,
        }))
      )
      .sort(
        (a, b) =>
          new Date(b.updated_at || b.created_at || 0).getTime() -
          new Date(a.updated_at || a.created_at || 0).getTime()
      );
  }, [projects]);

  const filteredTasks = useMemo(() => {
    if (!searchQuery.trim()) return tasks;
    const fallbackName = t('layout.new-project');
    return tasks.filter((task) =>
      matchesHubNameSearch(searchQuery, task.question?.trim() || fallbackName)
    );
  }, [tasks, searchQuery, t]);

  if (projectsLoading) {
    return (
      <div className="min-w-0 flex w-full flex-col">
        <SectionHeader
          title={capitalizeLabel(t('layout.tasks'))}
          searchPlaceholder={t('layout.search-tasks')}
        />
        <div className="pb-12 text-body-sm text-ds-text-neutral-muted-default">
          {t('layout.loading')}
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0 flex w-full flex-col">
      <SectionHeader
        title={capitalizeLabel(t('layout.tasks'))}
        searchPlaceholder={t('layout.search-tasks')}
      />

      <div className="mb-12 min-w-0 w-full">
        {tasks.length === 0 ? (
          <div className="p-8 flex flex-col items-center justify-center text-center">
            <ListChecks className="mb-4 h-12 w-12 text-ds-icon-neutral-muted-default" />
            <div className="text-sm text-ds-text-neutral-muted-default">
              {t('dashboard.no-tasks-found') || t('layout.total-tasks')}
            </div>
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="p-8 flex flex-col items-center justify-center text-center">
            <div className="text-sm text-ds-text-neutral-muted-default">
              {t('layout.search-no-results')}
            </div>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="gap-4 sm:grid-cols-2 grid auto-rows-fr grid-cols-1">
            {filteredTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                viewMode={viewMode}
                subtitle={
                  task.summary?.trim() ||
                  task.projectName ||
                  t('layout.no-description', {
                    defaultValue: 'No description yet.',
                  })
                }
                project={projects.find((p) => p.project_id === task.project_id)}
                onDelete={() => onTaskDelete(String(task.id))}
                onShare={() => onTaskShare(task.task_id)}
              />
            ))}
          </div>
        ) : (
          <div className="gap-3 flex flex-col">
            {filteredTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                viewMode={viewMode}
                subtitle={
                  task.summary?.trim() ||
                  task.projectName ||
                  t('layout.no-description', {
                    defaultValue: 'No description yet.',
                  })
                }
                project={projects.find((p) => p.project_id === task.project_id)}
                onDelete={() => onTaskDelete(String(task.id))}
                onShare={() => onTaskShare(task.task_id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
