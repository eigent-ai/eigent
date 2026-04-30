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

import { DashboardPageTitleRow } from '@/components/Dashboard/Pages/DashboardPageLayout';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tag } from '@/components/ui/tag';
import { cn } from '@/lib/utils';
import { useDashboardStore } from '@/store/dashboardStore';
import { BOARD_COLUMN_ORDER, TASK_BUCKET_LABEL_KEY } from '@/types/dashboard';
import {
  AlertTriangle,
  Filter,
  Folder,
  LayoutGrid,
  List,
  ListChecks,
  Plus,
  Zap,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Project from './Project';
import Task from './Task';
import {
  useDashboardData,
  type DashboardHub,
  type DashboardStats,
  type DashboardViewMode,
} from './useDashboardData';

function ViewModeToggle({
  value,
  onChange,
}: {
  value: DashboardViewMode;
  onChange: (value: DashboardViewMode) => void;
}) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as DashboardViewMode)}>
      <TabsList appearance="default">
        <TabsTrigger value="board">
          <LayoutGrid size={14} />
        </TabsTrigger>
        <TabsTrigger value="list">
          <List size={14} />
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

function DashboardMetrics({
  hub,
  stats,
}: {
  hub: DashboardHub;
  stats: DashboardStats;
}) {
  const { t } = useTranslation();

  const metrics =
    hub === 'project'
      ? [
          {
            key: 'projects',
            icon: <Folder />,
            label: t('layout.projects'),
            value: stats.projectCount,
          },
          {
            key: 'tasks',
            icon: <ListChecks />,
            label: t('layout.total-tasks'),
            value: stats.taskCount,
          },
          {
            key: 'triggers',
            icon: <Zap />,
            label: t('layout.triggers'),
            value: stats.triggerCount,
          },
        ]
      : [
          {
            key: 'visible',
            icon: <ListChecks />,
            label: t('layout.total-tasks'),
            value: stats.filteredTaskCount,
          },
          {
            key: 'running',
            icon: <Zap />,
            label: t('layout.running'),
            value: stats.runningTaskCount,
          },
          {
            key: 'completed',
            icon: <Folder />,
            label: t('layout.completed'),
            value: stats.completedTaskCount,
          },
        ];

  return (
    <div className="gap-2 min-w-0 flex flex-wrap items-center">
      {metrics.map((metric) => (
        <Tag
          key={metric.key}
          variant="ghost"
          tone="neutral"
          size="sm"
          className="gap-2"
        >
          {metric.icon}
          <span className="text-body-sm">{metric.label}</span>
          <span className="tabular-nums">{metric.value.toLocaleString()}</span>
        </Tag>
      ))}
    </div>
  );
}

function TaskFilters({
  projects,
}: {
  projects: ReturnType<typeof useDashboardData>['projects'];
}) {
  const { t } = useTranslation();
  const { filters, setFilter, columnVisibility, setColumnBucketVisible } =
    useDashboardStore();
  const [searchDraft, setSearchDraft] = useState(filters.search);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeFilterCount = [filters.search, filters.projectId].filter(
    Boolean
  ).length;

  const handleSearchChange = (value: string) => {
    setSearchDraft(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setFilter({ search: value });
    }, 300);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          tone="neutral"
          textWeight="semibold"
          buttonContent="icon-only"
          buttonRadius="lg"
          aria-label={t('layout.dashboard-filter')}
        >
          <Filter size={13} />
          {activeFilterCount > 0 && (
            <span className="ml-0.5 h-4 w-4 bg-ds-bg-brand-default-default text-label-xs text-ds-text-brand-inverse-default inline-flex items-center justify-center rounded-full">
              {activeFilterCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="gap-3 p-3 flex w-[min(20rem,calc(100vw-32px))] flex-col overflow-visible"
      >
        <div className="gap-1 flex flex-col">
          <span className="text-label-sm font-medium text-ds-text-neutral-muted-default">
            {t('layout.search')}
          </span>
          <input
            type="text"
            value={searchDraft}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder={t('layout.dashboard-search-placeholder')}
            className="rounded-lg border-ds-border-neutral-subtle-disabled bg-ds-bg-neutral-default-default py-1.5 px-2.5 text-body-sm text-ds-text-neutral-default-default placeholder:text-ds-text-neutral-muted-default focus:border-ds-border-brand-default-focus w-full border border-solid focus:outline-none"
          />
        </div>

        <div className="gap-1 flex flex-col">
          <span className="text-label-sm font-medium text-ds-text-neutral-muted-default">
            {t('layout.project-name')}
          </span>
          <select
            value={filters.projectId ?? ''}
            onChange={(e) => setFilter({ projectId: e.target.value || null })}
            className="rounded-lg border-ds-border-neutral-subtle-disabled bg-ds-bg-neutral-default-default py-1.5 px-2.5 text-body-sm text-ds-text-neutral-default-default focus:border-ds-border-brand-default-focus w-full border border-solid focus:outline-none"
          >
            <option value="">{t('layout.dashboard-all-projects')}</option>
            {projects.map((project) => (
              <option key={project.project_id} value={project.project_id}>
                {project.project_name ?? project.project_id}
              </option>
            ))}
          </select>
        </div>

        <div className="gap-2 pt-3 flex flex-col">
          <span className="text-label-sm font-medium text-ds-text-neutral-muted-default">
            {t('layout.dashboard-board-columns')}
          </span>
          <div className="gap-2 flex flex-col">
            {BOARD_COLUMN_ORDER.map((bucket) => (
              <label
                key={bucket}
                className="gap-2 flex cursor-pointer flex-row items-center"
              >
                <Checkbox
                  checked={columnVisibility[bucket]}
                  onCheckedChange={(v) =>
                    setColumnBucketVisible(bucket, v === true)
                  }
                />
                <span className="text-body-sm text-ds-text-neutral-default-default select-none">
                  {t(TASK_BUCKET_LABEL_KEY[bucket])}
                </span>
              </label>
            ))}
          </div>
        </div>

        {activeFilterCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            tone="error"
            onClick={() => {
              setSearchDraft('');
              setFilter({ search: '', projectId: null, bucket: null });
            }}
            className="self-start"
          >
            {t('layout.dashboard-clear-filters')}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function DashboardHubInner({
  embedded,
  hub: hubProp,
}: {
  embedded?: boolean;
  hub?: DashboardHub;
}) {
  const { t } = useTranslation();

  const hub = embedded ? (hubProp ?? 'project') : 'project';

  const [projectViewMode, setProjectViewMode] =
    useState<DashboardViewMode>('board');
  const dashboardData = useDashboardData();

  const hPad = embedded ? 'px-6' : 'px-[70px]';

  useEffect(() => {
    document.title = `${
      hub === 'project'
        ? t('layout.dashboard-overview')
        : t('layout.dashboard-tasks')
    } — ${t('layout.dashboard')}`;
  }, [hub, t]);

  useEffect(
    () => () => {
      document.title = 'Eigent';
    },
    []
  );

  if (dashboardData.isError) {
    return (
      <div className="gap-3 py-24 flex h-full flex-col items-center justify-center text-center">
        <AlertTriangle className="h-8 w-8 text-ds-icon-status-error-default-default" />
        <p className="text-body-sm text-ds-text-neutral-muted-default">
          {t('layout.dashboard-load-error')}
        </p>
        <Button
          variant="ghost"
          size="sm"
          tone="neutral"
          onClick={() => dashboardData.invalidate()}
        >
          {t('layout.retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-1 flex-col">
      <div className="min-w-0 flex h-auto min-h-[calc(100vh-86px)] w-full flex-col">
        <div className="min-h-0 min-w-0 flex w-full flex-1 flex-col">
          <div className="top-0 bg-ds-bg-neutral-subtle-default sticky z-20">
            <DashboardPageTitleRow
              title={
                hub === 'project'
                  ? t('layout.dashboard-overview')
                  : t('layout.dashboard-tasks')
              }
              horizontalPadding={hPad}
            />

            <div
              className={cn(
                'border-ds-border-neutral-subtle-hover px-6 pb-6 gap-3 mx-0 flex shrink-0 items-center justify-between border-x-0 border-t-0 border-b border-solid',
                hPad
              )}
            >
              <div className="gap-3 min-w-0 flex flex-1 flex-wrap items-center">
                <DashboardMetrics hub={hub} stats={dashboardData.stats} />
              </div>
              <div className="gap-2 flex shrink-0 items-center">
                {hub === 'task' && (
                  <TaskFilters projects={dashboardData.projects} />
                )}
                {hub === 'project' ? (
                  <ViewModeToggle
                    value={projectViewMode}
                    onChange={setProjectViewMode}
                  />
                ) : null}
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  tone="default"
                  textWeight="semibold"
                  buttonContent="icon-only"
                  buttonRadius="full"
                  aria-label={t('layout.dashboard-new-tasks')}
                >
                  <Plus size={13} />
                </Button>
              </div>
            </div>
          </div>

          {hub === 'project' ? (
            <div className={cn('mt-0 pt-4', hPad)}>
              <Project
                projects={dashboardData.projects}
                isLoading={dashboardData.isLoading}
                updateProjects={dashboardData.updateProjects}
                invalidate={dashboardData.invalidate}
                viewMode={projectViewMode}
              />
            </div>
          ) : (
            <div className="mt-0 min-h-0 min-w-0 px-0 pt-4 flex flex-1 flex-col">
              <Task
                horizontalPaddingClass={hPad}
                taskBuckets={dashboardData.taskBuckets}
                visibleBuckets={dashboardData.visibleBuckets}
                hiddenBuckets={dashboardData.hiddenBuckets}
                projects={dashboardData.projects}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DashboardHub(
  props: Parameters<typeof DashboardHubInner>[0]
) {
  return (
    <ErrorBoundary>
      <DashboardHubInner {...props} />
    </ErrorBoundary>
  );
}
