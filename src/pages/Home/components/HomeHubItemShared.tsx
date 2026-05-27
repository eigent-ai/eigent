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

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tag } from '@/components/ui/tag';
import { cn } from '@/lib/utils';
import type { Space } from '@/store/spaceStore';
import { Trigger } from '@/types';
import { HistoryTask, ProjectGroup as ProjectGroupType } from '@/types/history';
import { MoreHorizontal } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatHubCreatedTime } from '../utils';

export type HomeHubItemKind = 'space' | 'project' | 'task' | 'trigger';

export type HomeHubMenuItem = {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
};

export type HomeHubStat = {
  icon?: ReactNode;
  label: string;
};

export const homeHubSurfaceClass =
  'rounded-xl bg-ds-bg-neutral-default-default px-6 py-4 shadow-sm hover:bg-ds-bg-neutral-default-hover hover:ring-ds-bg-neutral-muted-default ease-in-out cursor-pointer text-left transition-all duration-200 hover:ring-4';

export { getSpaceKindLabel } from '@/lib/spaceLabel';

export function resolveProjectTokenCount(project: ProjectGroupType): number {
  const direct = Number(project.total_tokens);
  if (Number.isFinite(direct)) return direct;
  return (project.tasks || []).reduce(
    (sum, task) => sum + (Number(task.tokens) || 0),
    0
  );
}

export function HomeHubHeaderTag({ label }: { label: string }) {
  if (!label) return null;
  return (
    <Tag
      size="xs"
      tone="neutral"
      emphasis="muted"
      variant="primary"
      text={label}
      className="rounded-md max-w-[12rem] truncate"
    />
  );
}

export function HomeHubCardMenu({ items }: { items: HomeHubMenuItem[] }) {
  const { t } = useTranslation();
  if (items.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          buttonContent="icon-only"
          buttonRadius="full"
          className="hover:bg-ds-bg-neutral-subtle-default"
          aria-label={t('layout.more-actions', {
            defaultValue: 'More actions',
          })}
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal className="h-4 w-4 text-ds-icon-neutral-default-default" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="z-50"
        onClick={(event) => event.stopPropagation()}
      >
        {items.map((item) => (
          <DropdownMenuItem
            key={item.label}
            className={cn(
              'cursor-pointer',
              item.destructive &&
                'bg-ds-bg-neutral-subtle-default text-ds-text-error-default-default hover:bg-ds-bg-neutral-subtle-hover hover:text-ds-text-error-default-default focus:text-ds-text-error-default-default data-[highlighted]:text-ds-text-error-default-default [&>svg]:text-ds-icon-error-default-default hover:[&>svg]:text-ds-icon-error-default-default focus:[&>svg]:text-ds-icon-error-default-default data-[highlighted]:[&>svg]:text-ds-icon-error-default-default'
            )}
            disabled={item.disabled}
            onSelect={(event) => {
              event.preventDefault();
              if (!item.disabled) item.onSelect();
            }}
          >
            {item.icon}
            <span>{item.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function HomeHubStatTags({ stats }: { stats: HomeHubStat[] }) {
  if (stats.length === 0) return null;
  return (
    <>
      {stats.map((stat) => (
        <Tag
          key={stat.label}
          variant="primary"
          tone="neutral"
          emphasis="subtle"
          size="xxs"
          className="gap-1.5"
        >
          {stat.icon}
          <span>{stat.label}</span>
        </Tag>
      ))}
    </>
  );
}

type HomeHubItemBodyProps = {
  headerTag: string;
  title: string;
  subtitle: string;
  createdAt?: string | number | null;
  stats: HomeHubStat[];
  menuItems: HomeHubMenuItem[];
  layout: 'card' | 'list';
};

export function HomeHubItemBody({
  headerTag,
  title,
  subtitle,
  createdAt,
  stats,
  menuItems,
  layout,
}: HomeHubItemBodyProps) {
  const { t } = useTranslation();
  const createdLabel = formatHubCreatedTime(createdAt);
  const createdText = createdLabel
    ? `${t('layout.created')} ${createdLabel}`
    : '';

  if (layout === 'list') {
    return (
      <>
        <div className="shrink-0">
          <HomeHubHeaderTag label={headerTag} />
        </div>
        <div className="min-w-0">
          <span className="text-body-md font-semibold text-ds-text-neutral-default-default block truncate">
            {title}
          </span>
          <span className="text-body-xs text-ds-text-neutral-muted-default mt-1 block truncate">
            {subtitle}
          </span>
        </div>
        <span className="text-body-xs text-ds-text-neutral-subtle-default whitespace-nowrap">
          {createdText}
        </span>
        <div className="gap-2 flex shrink-0 items-center">
          <HomeHubStatTags stats={stats} />
        </div>
        <HomeHubCardMenu items={menuItems} />
      </>
    );
  }

  return (
    <>
      <div className="gap-3 -ml-2 flex items-center justify-between">
        <HomeHubHeaderTag label={headerTag} />
        <HomeHubCardMenu items={menuItems} />
      </div>

      <div className="mt-3 min-h-0 flex-1">
        <span className="text-body-md font-semibold text-ds-text-neutral-default-default min-w-0 line-clamp-2 block overflow-hidden text-ellipsis">
          {title}
        </span>
        <span className="mt-2 text-body-xs text-ds-text-neutral-muted-default line-clamp-3">
          {subtitle}
        </span>
      </div>

      <div className="gap-3 pt-2 mt-auto flex items-center justify-between">
        <span className="text-body-xs text-ds-text-neutral-subtle-default min-w-0 truncate">
          {createdText}
        </span>
        <div className="gap-2 flex shrink-0 items-center">
          <HomeHubStatTags stats={stats} />
        </div>
      </div>
    </>
  );
}

type HomeHubItemShellProps = {
  onClick: () => void;
  layout: 'card' | 'list';
  className?: string;
  children: ReactNode;
};

export function HomeHubItemShell({
  onClick,
  layout,
  className,
  children,
}: HomeHubItemShellProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className={cn(
        homeHubSurfaceClass,
        layout === 'card'
          ? 'relative flex h-full min-h-[11rem] flex-col'
          : 'gap-4 grid w-full grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] items-center',
        className
      )}
    >
      {children}
    </div>
  );
}

export type HomeHubSpaceItemProps = {
  layout: 'card' | 'list';
  space: Space;
  subtitle: string;
  isLegacy: boolean;
  projectCount: number;
  taskCount: number;
  triggerCount: number;
};

export type HomeHubProjectItemProps = {
  layout: 'card' | 'list';
  project: ProjectGroupType;
  spaceLabel: string;
  onProjectDelete?: (projectId: string) => void;
  onProjectRename?: (projectId: string, newName: string) => void;
};

export type HomeHubTaskItemProps = {
  layout: 'card' | 'list';
  task: HistoryTask;
  spaceLabel: string;
  subtitle: string;
  project?: ProjectGroupType;
  onDelete: () => void;
  onShare: () => void;
};

export type HomeHubTriggerItemProps = {
  layout: 'card' | 'list';
  trigger: Trigger;
  spaceLabel: string;
  triggerTypeLabel: string;
  onEdit: (trigger: Trigger) => void;
  onDelete: (trigger: Trigger) => void;
  onToggleActive: (trigger: Trigger) => void;
};
