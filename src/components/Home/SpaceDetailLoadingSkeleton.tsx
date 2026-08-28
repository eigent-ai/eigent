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

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import type { HomeHubItemKind } from './components/HomeHubItemShared';
import { HOME_HUB_LIST_GRID_CLASS } from './components/HomeHubItemShared';
import HomeHubListTable from './components/HomeHubListTable';
import type { SpaceDetailTab } from './SpaceDetailTabsNav';

const LIST_SKELETON_WIDTHS: Record<
  Extract<HomeHubItemKind, 'project' | 'task' | 'trigger'>,
  string[]
> = {
  project: ['w-40', 'w-20', 'w-8', 'w-8', 'w-14', 'w-16'],
  task: ['w-48', 'w-20', 'w-14', 'w-16'],
  trigger: ['w-40', 'w-20', 'w-16', 'w-14', 'w-16'],
};

export function SpaceDetailListSkeleton({
  kind,
  rows = 5,
}: {
  kind: 'project' | 'task' | 'trigger';
  rows?: number;
}) {
  const { t } = useTranslation();
  const kindLabel =
    kind === 'project'
      ? t('layout.sessions', { defaultValue: 'Sessions' })
      : kind === 'task'
        ? t('layout.tasks', { defaultValue: 'Tasks' })
        : t('layout.automations', { defaultValue: 'Automations' });
  return (
    <div
      role="status"
      aria-label={t('layout.loading-list', {
        value: kindLabel,
        defaultValue: 'Loading {{value}} list',
      })}
      data-space-detail-list-skeleton={kind}
      className="mb-12 w-full min-w-0"
    >
      <HomeHubListTable kind={kind}>
        {Array.from({ length: rows }, (_, rowIndex) => (
          <div
            key={rowIndex}
            data-space-detail-skeleton-row
            className={cn(
              'grid min-h-14 items-center gap-x-4 rounded-xl bg-ds-neutral-default-default px-3 py-2.5',
              HOME_HUB_LIST_GRID_CLASS[kind]
            )}
          >
            {LIST_SKELETON_WIDTHS[kind].map((width, columnIndex) => (
              <div
                key={columnIndex}
                className={cn(
                  'flex min-w-0',
                  columnIndex === 0 ? 'justify-start' : 'justify-end'
                )}
              >
                <Skeleton
                  className={cn(
                    'h-3 max-w-full',
                    width,
                    columnIndex === 0 && rowIndex % 2 === 1 && 'w-32'
                  )}
                />
              </div>
            ))}
          </div>
        ))}
      </HomeHubListTable>
      <span className="sr-only">
        {t('layout.loading-content', { defaultValue: 'Loading content' })}
      </span>
    </div>
  );
}

function ContextSkeleton() {
  return (
    <div className="flex h-full min-h-[32rem] flex-col overflow-hidden rounded-xl bg-ds-neutral-subtle-default">
      <div className="flex h-ds-layout-row-header shrink-0 items-center justify-between border-x-0 border-t-0 border-r-0 border-b border-l-0 border-solid border-ds-hairline-subtle-default px-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-7 rounded-lg" />
          <Skeleton className="h-3 w-28" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-36 rounded-lg" />
          <Skeleton className="h-7 w-24 rounded-lg" />
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-64 shrink-0 space-y-3 border-y-0 border-r border-l-0 border-solid border-ds-hairline-subtle-default p-3">
          <Skeleton className="h-3 w-20" />
          {Array.from({ length: 7 }, (_, index) => (
            <Skeleton
              key={index}
              className={cn('h-3', index % 3 === 0 ? 'w-40' : 'ml-4 w-32')}
            />
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-[82%]" />
          <Skeleton className="h-3 w-[68%]" />
        </div>
      </div>
    </div>
  );
}

function SettingsRowsSkeleton({ titles }: { titles: string[] }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-ds-neutral-default-default">
      {titles.map((title, index) => (
        <div
          key={title}
          className={cn(
            'grid min-h-16 items-center gap-4 px-4 py-3 md:grid-cols-[minmax(180px,0.8fr)_minmax(260px,1.2fr)]',
            index > 0 &&
              'border-x-0 border-t border-r-0 border-b-0 border-l-0 border-solid border-ds-hairline-subtle-default'
          )}
        >
          <div className="min-w-0">
            <span className="block text-ds-text-base font-bold text-ds-ink-default-default">
              {title}
            </span>
            <Skeleton className="mt-2 h-2.5 w-40 max-w-full" />
          </div>
          <Skeleton className="h-9 w-full rounded-xl" />
        </div>
      ))}
    </div>
  );
}

export function MemorySettingsSkeleton() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4 py-4" data-memory-settings-skeleton>
      <SettingsRowsSkeleton
        titles={[
          t('setting.memory-auto-title', { defaultValue: 'Auto Memory' }),
          t('setting.memory-use-title', { defaultValue: 'Use Memory' }),
          t('setting.memory-sync-title', { defaultValue: 'Memory Sync' }),
          t('setting.memory-storage', { defaultValue: 'Memory storage' }),
          t('setting.memory-organise-title', {
            defaultValue: 'Organise Memory',
          }),
        ]}
      />
      <div className="rounded-2xl bg-ds-neutral-default-default p-4">
        <span className="text-ds-text-base font-bold text-ds-ink-default-default">
          {t('setting.memory-saved-title', {
            defaultValue: 'Saved Memory',
          })}
        </span>
        <Skeleton className="mt-2 h-2.5 w-64 max-w-full" />
        <Skeleton className="mt-4 h-28 w-full rounded-xl" />
        <div className="mt-4 space-y-2">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function WorkspaceSettingsSkeleton() {
  const { t } = useTranslation();
  const tabs = [
    t('layout.identity', { defaultValue: 'Identity' }),
    t('setting.model', { defaultValue: 'Model' }),
    t('layout.environment', { defaultValue: 'Environment' }),
    t('layout.instructions', { defaultValue: 'Instructions' }),
    t('layout.context', { defaultValue: 'Context' }),
    t('layout.agents', { defaultValue: 'Agents' }),
    t('agents.skills', { defaultValue: 'Skills' }),
    t('setting.connectors', { defaultValue: 'Connectors' }),
    t('setting.mcp-servers-title', { defaultValue: 'MCP servers' }),
  ];
  return (
    <div
      className="grid gap-6 py-4 md:grid-cols-[180px_minmax(0,1fr)] md:items-start"
      data-workspace-settings-skeleton
    >
      <div className="rounded-2xl bg-ds-neutral-default-default p-1">
        {tabs.map((tab, index) => (
          <div
            key={tab}
            className={cn(
              'flex h-8 items-center rounded-xl px-3 text-ds-text-base',
              index === 0
                ? 'bg-ds-neutral-subtle-default font-medium'
                : 'text-ds-ink-muted-default'
            )}
          >
            {tab}
          </div>
        ))}
      </div>
      <div className="space-y-4">
        <SettingsRowsSkeleton
          titles={[
            t('layout.draft-version', { defaultValue: 'Draft version' }),
            t('layout.profile', { defaultValue: 'Profile' }),
          ]}
        />
        <SettingsRowsSkeleton
          titles={[
            t('layout.bundle-name', { defaultValue: 'Bundle name' }),
            t('layout.workspace-bundle-approval-mode', {
              defaultValue: 'Approval mode',
            }),
            t('layout.track-space-in-git', {
              defaultValue: 'Track this Space in Git',
            }),
            t('layout.remote-policy', { defaultValue: 'Remote policy' }),
          ]}
        />
        <SettingsRowsSkeleton
          titles={[
            t('setting.model', { defaultValue: 'Model' }),
            t('setting.thinking-effort', {
              defaultValue: 'Thinking effort',
            }),
          ]}
        />
      </div>
    </div>
  );
}

export function SpaceDetailTabSkeleton({ tab }: { tab: SpaceDetailTab }) {
  const { t } = useTranslation();
  const tabLabel =
    tab === 'projects'
      ? t('layout.sessions', { defaultValue: 'Sessions' })
      : tab === 'tasks'
        ? t('layout.tasks', { defaultValue: 'Tasks' })
        : tab === 'triggers'
          ? t('layout.automations', { defaultValue: 'Automations' })
          : tab === 'context'
            ? t('layout.context', { defaultValue: 'Context' })
            : tab === 'memory'
              ? t('setting.memory', { defaultValue: 'Memory' })
              : t('layout.workspace-settings', {
                  defaultValue: 'Workspace settings',
                });
  const content =
    tab === 'projects' ? (
      <SpaceDetailListSkeleton kind="project" />
    ) : tab === 'tasks' ? (
      <SpaceDetailListSkeleton kind="task" />
    ) : tab === 'triggers' ? (
      <SpaceDetailListSkeleton kind="trigger" />
    ) : tab === 'context' ? (
      <ContextSkeleton />
    ) : tab === 'memory' ? (
      <MemorySettingsSkeleton />
    ) : (
      <WorkspaceSettingsSkeleton />
    );

  return (
    <div
      role="status"
      aria-label={t('layout.loading-content-for', {
        value: tabLabel,
        defaultValue: 'Loading {{value}} content',
      })}
      data-space-detail-tab-skeleton={tab}
      className="h-full min-h-0"
    >
      {content}
      <span className="sr-only">
        {t('layout.loading-space-content', {
          defaultValue: 'Loading Space content',
        })}
      </span>
    </div>
  );
}
