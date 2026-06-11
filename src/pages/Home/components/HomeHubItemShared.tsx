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
import { getSpaceStatusLabel } from '@/lib/spaceLabel';
import { cn } from '@/lib/utils';
import type { Space } from '@/store/spaceStore';
import { Trigger } from '@/types';
import { HistoryTask, ProjectGroup as ProjectGroupType } from '@/types/history';
import { Folder, ListChecks, MoreHorizontal, Zap } from 'lucide-react';
import {
  Fragment,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { formatHubRelativeAgo } from '../utils';

export type HomeHubItemKind = 'space' | 'project' | 'task' | 'trigger';

export const HOME_HUB_LIST_GRID_CLASS: Record<HomeHubItemKind, string> = {
  space: 'grid-cols-[minmax(0,2fr)_112px_72px_72px_72px_96px]',
  project: 'grid-cols-[minmax(0,2fr)_112px_72px_72px_80px_96px]',
  task: 'grid-cols-[minmax(0,2fr)_112px_80px_96px]',
  trigger: 'grid-cols-[minmax(0,2fr)_112px_100px_96px_96px]',
};

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

export const homeHubBoardSurfaceClass =
  'h-auto w-full rounded-xl bg-ds-bg-neutral-subtle-default px-6 py-4 ring-1 ring-transparent hover:ring-ds-ring-neutral-subtle-disabled ease-in-out cursor-pointer text-left transition-all duration-200 hover:ring-4';

export { getSpaceKindLabel } from '@/lib/spaceLabel';

export function resolveProjectTokenCount(project: ProjectGroupType): number {
  const direct = Number(project.total_tokens);
  if (Number.isFinite(direct)) return direct;
  return (project.tasks || []).reduce(
    (sum, task) => sum + (Number(task.tokens) || 0),
    0
  );
}

export function HomeHubHeaderTag({
  label,
  tone = 'neutral',
  emphasis = 'muted',
}: {
  label: string;
  tone?: 'default' | 'neutral' | 'success' | 'error' | 'information';
  emphasis?: 'subtle' | 'muted' | 'default' | 'strong';
}) {
  if (!label) return null;
  return (
    <Tag
      size="xs"
      tone={tone}
      emphasis={emphasis}
      variant="primary"
      text={label}
      className="rounded-md w-fit max-w-[12rem] shrink-0 truncate"
    />
  );
}

function getSpaceStatusTagTone(
  status: Space['status']
): 'success' | 'error' | 'neutral' {
  switch (status) {
    case 'disconnected':
      return 'error';
    case 'archived':
      return 'neutral';
    case 'active':
    default:
      return 'success';
  }
}

export function HomeHubSpaceStatusTag({
  status,
  label,
}: {
  status: Space['status'];
  label: string;
}) {
  return <HomeHubToneTag label={label} tone={getSpaceStatusTagTone(status)} />;
}

export function HomeHubToneTag({
  label,
  tone = 'neutral',
  emphasis = 'muted',
}: {
  label: string;
  tone?: 'success' | 'error' | 'neutral' | 'information';
  emphasis?: 'subtle' | 'muted' | 'default' | 'strong';
}) {
  if (!label) return null;
  return (
    <Tag
      size="xs"
      tone={tone}
      emphasis={emphasis}
      variant="primary"
      text={label}
      className="rounded-md w-fit shrink-0 truncate"
    />
  );
}

export function HomeHubRuntimeStatusTag({
  status,
}: {
  status: 'running' | 'success' | 'error';
}) {
  const { t } = useTranslation();
  const config = {
    running: {
      label: t('layout.home-project-status-running'),
      tone: 'information' as const,
    },
    success: {
      label: t('layout.home-project-status-succeeded'),
      tone: 'success' as const,
    },
    error: {
      label: t('layout.home-project-status-failed'),
      tone: 'error' as const,
    },
  }[status];

  return (
    <HomeHubToneTag
      label={config.label}
      tone={config.tone}
      emphasis="default"
    />
  );
}

function HomeHubCardStatsLine({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="gap-2 text-body-xs text-ds-text-neutral-muted-default flex flex-wrap items-center">
      {items.map((item, index) => (
        <Fragment key={index}>
          {index > 0 ? (
            <span className="text-ds-text-neutral-subtle-default" aria-hidden>
              |
            </span>
          ) : null}
          <span>{item}</span>
        </Fragment>
      ))}
    </div>
  );
}

export type HomeHubBoardStatRow = {
  label: string;
  value: string | number;
};

function HomeHubBoardStats({ rows }: { rows: HomeHubBoardStatRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-4 gap-2 flex w-fit flex-col items-start">
      {rows.map((row) => (
        <div key={row.label} className="gap-x-2 flex w-fit items-baseline">
          <span className="text-body-xs text-ds-text-neutral-muted-default">
            {row.label}
          </span>
          <span className="text-body-xs text-ds-text-neutral-default-default tabular-nums">
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}

type HomeHubBoardCardBodyProps = {
  title: string;
  icon: ReactNode;
  menuItems: HomeHubMenuItem[];
  statRows: HomeHubBoardStatRow[];
  otherContent?: ReactNode;
  titleClassName?: string;
};

export function HomeHubBoardCardBody({
  title,
  icon,
  menuItems,
  statRows,
  otherContent,
  titleClassName,
}: HomeHubBoardCardBodyProps) {
  return (
    <div className="min-w-0 flex w-full flex-col items-start">
      <div className="gap-2 min-w-0 flex w-full items-start justify-between">
        <div className="min-w-0 gap-1 flex flex-1 flex-col items-start">
          <span className="h-4 w-4 text-ds-icon-neutral-muted-default [&_svg]:h-4 [&_svg]:w-4 inline-flex shrink-0 items-center justify-center">
            {icon}
          </span>
          <span
            className={cn(
              'min-w-0 text-body-md font-semibold text-ds-text-neutral-default-default w-full break-words whitespace-normal',
              titleClassName
            )}
          >
            {title}
          </span>
        </div>
        <div className="shrink-0">
          <HomeHubCardMenu items={menuItems} />
        </div>
      </div>

      <HomeHubBoardStats rows={statRows} />

      {otherContent ? (
        <div className="mt-4 gap-1.5 flex w-fit flex-wrap items-center">
          {otherContent}
        </div>
      ) : null}
    </div>
  );
}

type HomeHubHubCardBodyProps = {
  title: string;
  icon: ReactNode;
  menuItems: HomeHubMenuItem[];
  statItems: string[];
  footerTags: ReactNode;
  updatedAt?: string | number | null;
  titleClassName?: string;
};

export function HomeHubHubCardBody({
  title,
  icon,
  menuItems,
  statItems,
  footerTags,
  updatedAt,
  titleClassName,
}: HomeHubHubCardBodyProps) {
  const { t } = useTranslation();
  const lastUpdated = formatHubRelativeAgo(updatedAt, t);

  return (
    <>
      <div className="gap-2 flex items-center justify-between">
        <div className="min-w-0 gap-2 flex flex-1 items-center">
          <span className="h-4 w-4 text-ds-icon-neutral-muted-default [&_svg]:h-4 [&_svg]:w-4 inline-flex shrink-0 items-center justify-center">
            {icon}
          </span>
          <span
            className={cn(
              'min-w-0 text-body-md font-semibold text-ds-text-neutral-default-default truncate',
              titleClassName
            )}
          >
            {title}
          </span>
        </div>
        <HomeHubCardMenu items={menuItems} />
      </div>

      {statItems.length > 0 ? (
        <div className="mt-4 min-h-0 flex flex-1 flex-col">
          <HomeHubCardStatsLine items={statItems} />
        </div>
      ) : null}

      <div className="gap-3 pt-4 mt-auto flex items-center justify-between">
        <div className="min-w-0 gap-1.5 flex flex-wrap items-center">
          {footerTags}
        </div>
        {lastUpdated ? (
          <span className="text-body-xs text-ds-text-neutral-subtle-default shrink-0">
            {t('layout.home-space-last-updated', { time: lastUpdated })}
          </span>
        ) : null}
      </div>
    </>
  );
}

function HomeHubMenuDropdownItems({ items }: { items: HomeHubMenuItem[] }) {
  return items.map((item) => (
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
  ));
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
        <HomeHubMenuDropdownItems items={items} />
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

export type HomeHubListCell = {
  id: string;
  content: ReactNode;
  align?: 'left' | 'right';
  textSize?: 'sm' | 'xs';
};

const homeHubListNameClass =
  'truncate !text-label-sm font-normal leading-none text-ds-text-neutral-default-default';

type HomeHubItemBodyProps = {
  title: string;
  nameIcon?: ReactNode;
  listCells?: HomeHubListCell[];
};

export function HomeHubItemBody({
  title,
  nameIcon,
  listCells = [],
}: HomeHubItemBodyProps) {
  return (
    <>
      <div className="min-w-0 gap-2 flex items-center">
        {nameIcon ? (
          <span className="h-4 w-4 text-ds-icon-neutral-muted-default [&_svg]:h-4 [&_svg]:w-4 inline-flex shrink-0 items-center justify-center">
            {nameIcon}
          </span>
        ) : null}
        <span className={homeHubListNameClass}>{title}</span>
      </div>
      {listCells.map((cell) => (
        <span
          key={cell.id}
          className={cn(
            'font-normal text-ds-text-neutral-muted-default truncate leading-none',
            cell.textSize === 'xs' ? '!text-label-xs' : '!text-label-sm',
            cell.align === 'right' ? 'text-right tabular-nums' : 'text-left'
          )}
        >
          {cell.content}
        </span>
      ))}
    </>
  );
}

type HomeHubSpaceCardBodyProps = {
  title: string;
  spaceKindLabel: string;
  projectCount: number;
  taskCount: number;
  triggerCount: number;
  status: Space['status'];
  updatedAt?: number;
  menuItems: HomeHubMenuItem[];
};

export function HomeHubSpaceCardBody({
  title,
  spaceKindLabel,
  projectCount,
  taskCount,
  triggerCount,
  status,
  updatedAt,
  menuItems,
}: HomeHubSpaceCardBodyProps) {
  const { t } = useTranslation();
  const statusLabel = getSpaceStatusLabel(status, t);
  const statItems = [
    t('layout.home-space-stat-projects', { count: projectCount }),
    t('layout.home-space-stat-tasks', { count: taskCount }),
    t('layout.home-space-stat-triggers', { count: triggerCount }),
  ];

  return (
    <HomeHubHubCardBody
      title={title}
      icon={<Folder />}
      menuItems={menuItems}
      statItems={statItems}
      updatedAt={updatedAt}
      footerTags={
        <>
          <HomeHubSpaceStatusTag status={status} label={statusLabel} />
          <HomeHubHeaderTag label={spaceKindLabel} />
        </>
      }
    />
  );
}

export function HomeHubSpaceBoardCardBody({
  title,
  spaceKindLabel,
  projectCount,
  taskCount,
  triggerCount,
  status,
  menuItems,
}: Omit<HomeHubSpaceCardBodyProps, 'updatedAt'>) {
  const { t } = useTranslation();
  const statusLabel = getSpaceStatusLabel(status, t);

  return (
    <HomeHubBoardCardBody
      title={title}
      icon={<Folder />}
      menuItems={menuItems}
      statRows={[
        { label: t('layout.projects'), value: projectCount },
        { label: t('layout.tasks'), value: taskCount },
        { label: t('layout.triggers'), value: triggerCount },
      ]}
      otherContent={
        <>
          <HomeHubSpaceStatusTag status={status} label={statusLabel} />
          <HomeHubHeaderTag
            label={spaceKindLabel}
            emphasis="default"
            tone="default"
          />
        </>
      }
    />
  );
}

type HomeHubProjectCardBodyProps = {
  title: string;
  taskCount: number;
  triggerCount: number;
  tokenCount: number;
  spaceLabel: string;
  runtimeStatus?: 'running' | 'success' | 'error' | null;
  updatedAt?: string | number | null;
  menuItems: HomeHubMenuItem[];
};

export function HomeHubProjectCardBody({
  title,
  taskCount,
  triggerCount,
  tokenCount,
  spaceLabel,
  runtimeStatus,
  updatedAt,
  menuItems,
}: HomeHubProjectCardBodyProps) {
  const { t } = useTranslation();
  const statItems = [
    t('layout.home-space-stat-tasks', { count: taskCount }),
    t('layout.home-space-stat-triggers', { count: triggerCount }),
  ];

  return (
    <HomeHubHubCardBody
      title={title}
      icon={<Folder />}
      menuItems={menuItems}
      statItems={statItems}
      updatedAt={updatedAt}
      footerTags={
        <>
          {runtimeStatus ? (
            <HomeHubRuntimeStatusTag status={runtimeStatus} />
          ) : null}
          <HomeHubHeaderTag label={spaceLabel} />
        </>
      }
    />
  );
}

export function HomeHubProjectBoardCardBody({
  title,
  taskCount,
  triggerCount,
  tokenCount,
  spaceLabel,
  runtimeStatus,
  menuItems,
}: Omit<HomeHubProjectCardBodyProps, 'updatedAt'>) {
  const { t } = useTranslation();

  return (
    <HomeHubBoardCardBody
      title={title}
      icon={<Folder />}
      menuItems={menuItems}
      statRows={[
        { label: t('layout.tasks'), value: taskCount },
        { label: t('layout.triggers'), value: triggerCount },
      ]}
      otherContent={
        <>
          {runtimeStatus ? (
            <HomeHubRuntimeStatusTag status={runtimeStatus} />
          ) : null}
          <HomeHubHeaderTag
            label={spaceLabel}
            emphasis="default"
            tone="default"
          />
        </>
      }
    />
  );
}

type HomeHubTaskCardBodyProps = {
  title: string;
  tokenCount: number;
  projectName?: string;
  spaceLabel: string;
  updatedAt?: string | number | null;
  menuItems: HomeHubMenuItem[];
};

export function HomeHubTaskCardBody({
  title,
  tokenCount,
  projectName,
  spaceLabel,
  updatedAt,
  menuItems,
}: HomeHubTaskCardBodyProps) {
  const { t } = useTranslation();
  const statItems = [...(projectName?.trim() ? [projectName.trim()] : [])];

  return (
    <HomeHubHubCardBody
      title={title}
      icon={<ListChecks />}
      menuItems={menuItems}
      statItems={statItems}
      updatedAt={updatedAt}
      footerTags={<HomeHubHeaderTag label={spaceLabel} />}
    />
  );
}

export function HomeHubTaskBoardCardBody({
  title,
  tokenCount,
  projectName,
  spaceLabel,
  menuItems,
}: Omit<HomeHubTaskCardBodyProps, 'updatedAt'>) {
  const { t } = useTranslation();
  const statRows: HomeHubBoardStatRow[] = [];

  if (projectName?.trim()) {
    statRows.push({
      label: t('layout.projects'),
      value: projectName.trim(),
    });
  }

  return (
    <HomeHubBoardCardBody
      title={title}
      icon={<ListChecks />}
      menuItems={menuItems}
      statRows={statRows}
      otherContent={
        <HomeHubHeaderTag
          label={spaceLabel}
          emphasis="default"
          tone="default"
        />
      }
    />
  );
}

type HomeHubTriggerCardBodyProps = {
  title: string;
  triggerTypeLabel: string;
  executionCount: number;
  spaceLabel: string;
  isActive: boolean;
  activeLabel: string;
  inactiveLabel: string;
  updatedAt?: string | number | null;
  menuItems: HomeHubMenuItem[];
};

export function HomeHubTriggerCardBody({
  title,
  triggerTypeLabel,
  executionCount,
  spaceLabel,
  isActive,
  activeLabel,
  inactiveLabel,
  updatedAt,
  menuItems,
}: HomeHubTriggerCardBodyProps) {
  const { t } = useTranslation();
  const statItems = [
    triggerTypeLabel,
    t('layout.home-trigger-stat-executions', { count: executionCount }),
  ];

  return (
    <HomeHubHubCardBody
      title={title}
      icon={<Zap />}
      menuItems={menuItems}
      statItems={statItems}
      updatedAt={updatedAt}
      footerTags={
        <>
          <HomeHubToneTag
            label={isActive ? activeLabel : inactiveLabel}
            tone={isActive ? 'success' : 'neutral'}
          />
          <HomeHubHeaderTag label={spaceLabel} />
        </>
      }
    />
  );
}

export function HomeHubTriggerBoardCardBody({
  title,
  triggerTypeLabel,
  executionCount,
  spaceLabel,
  isActive,
  activeLabel,
  inactiveLabel,
  menuItems,
}: Omit<HomeHubTriggerCardBodyProps, 'updatedAt'>) {
  const { t } = useTranslation();

  return (
    <HomeHubBoardCardBody
      title={title}
      icon={<Zap />}
      menuItems={menuItems}
      statRows={[
        { label: t('layout.home-list-type'), value: triggerTypeLabel },
        {
          label: t('layout.home-board-stat-executions'),
          value: executionCount,
        },
      ]}
      otherContent={
        <>
          <HomeHubToneTag
            label={isActive ? activeLabel : inactiveLabel}
            tone={isActive ? 'success' : 'neutral'}
          />
          <HomeHubHeaderTag
            label={spaceLabel}
            emphasis="default"
            tone="default"
          />
        </>
      }
    />
  );
}

type HomeHubItemShellProps = {
  onClick: () => void;
  layout: 'card' | 'list' | 'board';
  className?: string;
  children: ReactNode;
  kind?: HomeHubItemKind;
  menuItems?: HomeHubMenuItem[];
};

export function HomeHubItemShell({
  onClick,
  layout,
  className,
  children,
  kind,
  menuItems = [],
}: HomeHubItemShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPoint, setMenuPoint] = useState({ x: 0, y: 0 });
  const hasListContextMenu = layout === 'list' && menuItems.length > 0;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  };

  const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (!hasListContextMenu) return;
    event.preventDefault();
    event.stopPropagation();
    setMenuPoint({ x: event.clientX, y: event.clientY });
    setMenuOpen(true);
  };

  const row = (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
        className={cn(
          layout === 'card' && homeHubSurfaceClass,
          layout === 'board' && homeHubBoardSurfaceClass,
          layout === 'card' && 'relative flex h-full min-h-[11rem] flex-col',
          layout === 'board' &&
            'min-w-0 relative flex h-auto w-full flex-col items-start overflow-hidden',
          layout === 'list' &&
            cn(
              'gap-x-4 rounded-xl bg-ds-bg-neutral-default-default px-3 py-2.5 hover:bg-ds-bg-neutral-default-hover hover:border-ds-border-neutral-subtle-default grid w-full cursor-pointer items-center border border-solid border-transparent text-left transition-colors duration-150',
              kind ? HOME_HUB_LIST_GRID_CLASS[kind] : undefined
            ),
          className
        )}
      >
        {children}
      </div>
      {hasListContextMenu ? (
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden
            className="pointer-events-none fixed h-px w-px opacity-0"
            style={{ left: menuPoint.x, top: menuPoint.y }}
          />
        </DropdownMenuTrigger>
      ) : null}
    </>
  );

  if (!hasListContextMenu) {
    return row;
  }

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
      {row}
      <DropdownMenuContent
        align="start"
        className="z-50"
        onClick={(event) => event.stopPropagation()}
      >
        <HomeHubMenuDropdownItems items={menuItems} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type HomeHubSpaceItemProps = {
  layout: 'card' | 'list' | 'board';
  space: Space;
  subtitle: string;
  isLegacy: boolean;
  projectCount: number;
  taskCount: number;
  triggerCount: number;
};

export type HomeHubProjectItemProps = {
  layout: 'card' | 'list' | 'board';
  project: ProjectGroupType;
  spaceLabel: string;
  onProjectDelete?: (projectId: string) => void;
  onProjectRename?: (projectId: string, newName: string) => void;
};

export type HomeHubTaskItemProps = {
  layout: 'card' | 'list' | 'board';
  task: HistoryTask;
  spaceLabel: string;
  project?: ProjectGroupType;
  onDelete: () => void;
  onShare: () => void;
};

export type HomeHubTriggerItemProps = {
  layout: 'card' | 'list' | 'board';
  trigger: Trigger;
  spaceLabel: string;
  triggerTypeLabel: string;
  onEdit: (trigger: Trigger) => void;
  onDelete: (trigger: Trigger) => void;
  onToggleActive: (trigger: Trigger) => void;
};
