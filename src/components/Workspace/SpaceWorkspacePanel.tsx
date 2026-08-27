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

import { fetchGet } from '@/api/http';
import { RIGHT_RAIL_CONTENT_WIDTH_CLASS } from '@/components/Layout/rightRail';
import { Button } from '@/components/ui/button';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { DS_FOCUS_RING } from '@/components/ui/semanticProps';
import { Skeleton } from '@/components/ui/skeleton';
import { Tag } from '@/components/ui/tag';
import { filterVisibleAgentFiles } from '@/lib/agentFileFilters';
import { cn } from '@/lib/utils';
import { fetchGroupedHistoryProjects } from '@/service/historyApi';
import { proxyFetchTriggers } from '@/service/triggerApi';
import { useAuthStore } from '@/store/authStore';
import {
  getVisibleProjectMetasForSpace,
  useSpaceStore,
  type Space,
} from '@/store/spaceStore';
import type { WorkspaceGuideTabId } from '@/store/workspaceGuidePreferences';
import type { Trigger } from '@/types';
import type { ProjectGroup } from '@/types/history';
import {
  BookOpen,
  Cable,
  ListTodo,
  Megaphone,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  buildSevenDayActivity,
  buildThirtyDayActivity,
  categorizeSpaceFile,
  getSpaceAgeInDays,
  getSpaceSummaryVariantIndex,
  hasUserBoundLocalFolder,
  type SpaceContentCategory,
} from './spaceWorkspacePanelData';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

type RemoteFileRecord = {
  filename?: string;
  name?: string;
  projectId?: string;
  relativePath?: string;
  relative_path?: string;
  isFolder?: boolean;
};

interface SpaceWorkspacePanelProps {
  space: Space;
  onUsePrompt: (prompt: string) => void;
  onConnectApp: () => void;
  onExploreUseCases: () => void;
  onOpenFolder: () => void;
  canOpenFolder: boolean;
}

function Section({
  title,
  first = false,
  end,
  children,
}: {
  title?: string;
  first?: boolean;
  end?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      className={
        first
          ? 'pb-ds-16'
          : 'border-x-0 border-t border-b-0 border-solid border-ds-hairline-subtle-default py-ds-16'
      }
    >
      {title || end ? (
        <div className="mb-ds-16 flex min-w-0 items-center gap-ds-8">
          {title ? (
            <DsText
              as="h2"
              role="base"
              weight="semibold"
              className="min-w-0 flex-1 text-ds-ink-default-default"
            >
              {title}
            </DsText>
          ) : (
            <span className="flex-1" />
          )}
          {end}
        </div>
      ) : null}
      {children}
    </section>
  );
}

function OnboardingTile({
  id,
  label,
  icon,
  dismissLabel,
  onClick,
  onDismiss,
}: {
  id: WorkspaceGuideTabId;
  label: string;
  icon: LucideIcon;
  dismissLabel: string;
  onClick: () => void;
  onDismiss: () => void;
}) {
  return (
    <div data-workspace-guide-tab={id} className="group relative min-w-0">
      <button
        type="button"
        className={cn(
          'box-border flex h-fit w-full min-w-0 cursor-pointer flex-row items-center justify-start gap-ds-16 rounded-ds-card border-[length:var(--ds-border-hairline)] border-x-[length:var(--ds-border-hairline)] border-y-[length:var(--ds-border-hairline)] border-solid border-ds-hairline-default-default bg-transparent p-ds-16 pr-ds-48 text-left text-ds-ink-default-default ring-offset-ds-neutral-subtle-default transition-[background-color,box-shadow,opacity,transform] duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-ds-neutral-default-default active:scale-[0.97] active:shadow-ds-elevation-control-pressed',
          DS_FOCUS_RING
        )}
        onClick={onClick}
      >
        <DsIcon icon={icon} recipe="detailed" />
        <DsText
          as="span"
          role="base"
          weight="semibold"
          className="text-ds-ink-default-default"
        >
          {label}
        </DsText>
      </button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        buttonContent="icon-only"
        aria-label={dismissLabel}
        title={dismissLabel}
        className="absolute top-1/2 right-ds-8 -translate-y-1/2 opacity-0 transition-opacity duration-[160ms] group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
        onClick={onDismiss}
      >
        <DsIcon icon={X} recipe="main" />
      </Button>
    </div>
  );
}

function WorkspaceGuideTabs({
  tabs,
  onDismiss,
}: {
  tabs: Array<{
    id: WorkspaceGuideTabId;
    label: string;
    icon: LucideIcon;
    onClick: () => void;
    dismissLabel: string;
  }>;
  onDismiss: (tabId: WorkspaceGuideTabId) => void;
}) {
  return (
    <Section first>
      <div className="flex min-w-0 flex-col gap-ds-8">
        {tabs.map((tab) => (
          <OnboardingTile
            key={tab.id}
            {...tab}
            onDismiss={() => onDismiss(tab.id)}
          />
        ))}
      </div>
    </Section>
  );
}

const contentCategoryClasses: Record<SpaceContentCategory, string> = {
  Documents: 'bg-[var(--ds-category-blue-solid-default)]',
  Code: 'bg-[var(--ds-category-purple-solid-default)]',
  Data: 'bg-[var(--ds-category-green-solid-default)]',
  Media: 'bg-[var(--ds-category-orange-solid-default)]',
  Other: 'bg-[var(--ds-category-gray-solid-default)]',
};

const contentCategoryTranslationKeys: Record<SpaceContentCategory, string> = {
  Documents: 'layout.workspace-overview-content-documents',
  Code: 'layout.workspace-overview-content-code',
  Data: 'layout.workspace-overview-content-data',
  Media: 'layout.workspace-overview-content-media',
  Other: 'layout.workspace-overview-content-other',
};

function ActivityLineGraph({
  activity,
}: {
  activity: ReturnType<typeof buildSevenDayActivity>;
}) {
  const { t } = useTranslation();
  const [activePointIndex, setActivePointIndex] = useState<number | null>(null);
  const width = 300;
  const height = 104;
  const inset = 5;
  const maxCount = Math.max(...activity.map((day) => day.count), 1);
  const coordinates = activity.map((day, index) => ({
    x: inset + (index / Math.max(activity.length - 1, 1)) * (width - inset * 2),
    y: height - inset - (day.count / maxCount) * (height - inset * 2),
  }));
  const smoothPath = coordinates.reduce((path, point, index) => {
    if (index === 0) return `M ${point.x} ${point.y}`;
    const previous = coordinates[index - 1];
    const midpointX = (previous.x + point.x) / 2;
    return `${path} C ${midpointX} ${previous.y}, ${midpointX} ${point.y}, ${point.x} ${point.y}`;
  }, '');
  const firstPoint = coordinates[0] ?? { x: inset, y: height - inset };
  const lastPoint = coordinates.at(-1) ?? {
    x: width - inset,
    y: height - inset,
  };
  const areaPath = `${smoothPath} L ${lastPoint.x} ${height - inset} L ${firstPoint.x} ${height - inset} Z`;
  const labelIndexes = new Set(
    activity.length <= 7
      ? activity.map((_, index) => index)
      : [0, 5, 10, 15, 20, 25, activity.length - 1]
  );
  const activePoint =
    activePointIndex == null ? null : coordinates[activePointIndex];
  const activeDay =
    activePointIndex == null ? null : activity[activePointIndex];

  return (
    <div className="min-w-0">
      <div className="relative h-[104px]">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="h-full w-full overflow-visible text-ds-accent-default-default"
          onPointerLeave={() => setActivePointIndex(null)}
        >
          <line
            x1={inset}
            y1={height - inset}
            x2={width - inset}
            y2={height - inset}
            className="stroke-ds-border-neutral-default-default"
            strokeWidth="1"
          />
          <path d={areaPath} fill="currentColor" opacity="0.08" />
          <path
            d={smoothPath}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {activity.map((day, index) => {
            const point = coordinates[index];
            const active = activePointIndex === index;
            return (
              <circle
                key={day.key}
                tabIndex={0}
                role="img"
                aria-label={t('layout.workspace-overview-activity-point', {
                  defaultValue: '{{count}} Tasks',
                  count: day.count,
                })}
                cx={point.x}
                cy={point.y}
                r={active ? 4 : 2.5}
                fill="currentColor"
                className="cursor-default outline-none focus-visible:stroke-ds-ring-focus"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
                onPointerEnter={() => setActivePointIndex(index)}
                onFocus={() => setActivePointIndex(index)}
                onBlur={() => setActivePointIndex(null)}
              />
            );
          })}
        </svg>
        {activePoint && activeDay ? (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+6px)] rounded-md bg-ds-neutral-strong-default px-2 py-1 text-ds-text-meta font-medium text-ds-ink-default-default shadow-ds-elevation-popover"
            style={{
              left: `${(activePoint.x / width) * 100}%`,
              top: `${(activePoint.y / height) * 100}%`,
            }}
          >
            {activeDay.count}
          </div>
        ) : null}
      </div>
      <div className="mt-1 flex justify-between" aria-hidden>
        {activity.map((day, index) =>
          labelIndexes.has(index) ? (
            <span
              key={day.key}
              className="!text-ds-text-meta text-ds-ink-muted-default"
            >
              {activity.length <= 7 ? day.label : day.shortLabel}
            </span>
          ) : null
        )}
      </div>
    </div>
  );
}

export function SpaceWorkspacePanel({
  space,
  onUsePrompt,
  onConnectApp,
  onExploreUseCases,
  onOpenFolder,
  canOpenFolder,
}: SpaceWorkspacePanelProps) {
  const { t } = useTranslation();
  const email = useAuthStore((state) => state.email);
  const userId = useAuthStore((state) => state.user_id);
  const workspaceGuideAudience = useAuthStore(
    (state) => state.workspaceGuideAudience
  );
  const dismissedWorkspaceGuideTabs = useAuthStore(
    (state) => state.dismissedWorkspaceGuideTabs
  );
  const dismissWorkspaceGuideTab = useAuthStore(
    (state) => state.dismissWorkspaceGuideTab
  );
  const projectsBySpaceId = useSpaceStore((state) => state.projectsBySpaceId);
  const sessionMetas = useMemo(
    () =>
      getVisibleProjectMetasForSpace(projectsBySpaceId, space.id).sort(
        (left, right) => right.updatedAt - left.updatedAt
      ),
    [projectsBySpaceId, space.id]
  );
  const totalSessionCount = useMemo(
    () =>
      Object.keys(projectsBySpaceId).reduce(
        (total, spaceId) =>
          total +
          getVisibleProjectMetasForSpace(projectsBySpaceId, spaceId).length,
        0
      ),
    [projectsBySpaceId]
  );
  const isFirstTimeUser =
    workspaceGuideAudience === 'new' && totalSessionCount === 0;
  const hasOverviewSource =
    sessionMetas.length > 0 || hasUserBoundLocalFolder(space);
  const [historyProjects, setHistoryProjects] = useState<ProjectGroup[]>([]);
  const [historyState, setHistoryState] = useState<LoadState>('idle');
  const [spaceTriggers, setSpaceTriggers] = useState<Trigger[]>([]);
  const [triggerState, setTriggerState] = useState<LoadState>('idle');
  const [spaceFiles, setSpaceFiles] = useState<RemoteFileRecord[]>([]);
  const [activityRange, setActivityRange] = useState<7 | 30>(7);

  useEffect(() => {
    if (!hasOverviewSource) return;
    const store = useSpaceStore.getState();
    if (store.shouldSyncProjects(space.id)) {
      void store.syncProjectsFromServer(space.id);
    }
  }, [hasOverviewSource, space.id]);

  useEffect(() => {
    if (!hasOverviewSource) {
      setHistoryProjects([]);
      setHistoryState('idle');
      return;
    }
    let cancelled = false;
    setHistoryState('loading');
    void fetchGroupedHistoryProjects({
      spaceId: space.id,
      includeTasks: true,
    })
      .then((projects) => {
        if (cancelled) return;
        setHistoryProjects(projects ?? []);
        setHistoryState('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn('[SpaceWorkspacePanel] Failed to load activity:', error);
        setHistoryProjects([]);
        setHistoryState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [hasOverviewSource, space.id]);

  const sessionIds = useMemo(
    () => new Set(sessionMetas.map((session) => session.id)),
    [sessionMetas]
  );

  useEffect(() => {
    if (!hasOverviewSource) {
      setSpaceTriggers([]);
      setTriggerState('idle');
      return;
    }
    let cancelled = false;
    setTriggerState('loading');
    void proxyFetchTriggers(undefined, undefined, 1, 100)
      .then((response) => {
        if (cancelled) return;
        const triggers = (response?.items ?? response ?? []) as Trigger[];
        setSpaceTriggers(
          triggers.filter(
            (trigger) =>
              trigger.space_id === space.id ||
              Boolean(trigger.project_id && sessionIds.has(trigger.project_id))
          )
        );
        setTriggerState('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn(
          '[SpaceWorkspacePanel] Failed to load automations:',
          error
        );
        setSpaceTriggers([]);
        setTriggerState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [hasOverviewSource, sessionIds, space.id]);

  const projectIdsKey = sessionMetas.map((session) => session.id).join(',');
  useEffect(() => {
    if (!hasOverviewSource || !email) {
      setSpaceFiles([]);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    const targetIds = space.rootPath
      ? [space.id]
      : projectIdsKey.split(',').filter(Boolean);
    if (targetIds.length === 0) {
      setSpaceFiles([]);
      return;
    }

    void Promise.all(
      targetIds.map(async (projectId) => {
        const response = await fetchGet(
          '/files',
          {
            project_id: projectId,
            email,
            space_id: space.id,
            ...(userId != null ? { user_id: String(userId) } : {}),
          },
          undefined,
          { signal: controller.signal }
        );
        if (!Array.isArray(response)) return [];
        return response.map((item: RemoteFileRecord) => ({
          ...item,
          filename: item.filename || item.name || '',
          projectId,
        }));
      })
    )
      .then((lists) => {
        if (cancelled) return;
        const uniqueFiles = new Map<string, RemoteFileRecord>();
        filterVisibleAgentFiles(lists.flat()).forEach((file) => {
          const name = file.filename || file.name || '';
          const key = `${file.projectId ?? ''}:${
            file.relativePath || file.relative_path || name
          }`;
          if (name && key) uniqueFiles.set(key, file);
        });
        setSpaceFiles([...uniqueFiles.values()]);
      })
      .catch((error) => {
        if (cancelled || controller.signal.aborted) return;
        console.warn('[SpaceWorkspacePanel] Failed to load files:', error);
        setSpaceFiles([]);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    email,
    hasOverviewSource,
    projectIdsKey,
    space.id,
    space.rootPath,
    userId,
  ]);

  const tasks = useMemo(
    () => historyProjects.flatMap((project) => project.tasks ?? []),
    [historyProjects]
  );
  const taskCount = historyProjects.reduce(
    (total, project) =>
      total + (project.task_count ?? project.tasks?.length ?? 0),
    0
  );
  const sevenDayActivity = useMemo(() => buildSevenDayActivity(tasks), [tasks]);
  const thirtyDayActivity = useMemo(
    () => buildThirtyDayActivity(tasks),
    [tasks]
  );
  const activity = activityRange === 7 ? sevenDayActivity : thirtyDayActivity;
  const thirtyDayActivityCount = thirtyDayActivity.reduce(
    (total, day) => total + day.count,
    0
  );
  const contentCounts = useMemo(() => {
    const counts = new Map<SpaceContentCategory, number>();
    spaceFiles.forEach((file) => {
      if (file.isFolder) return;
      const name = file.filename || file.name || '';
      const category = categorizeSpaceFile(name);
      counts.set(category, (counts.get(category) ?? 0) + 1);
    });
    return [...counts.entries()].filter(([, count]) => count > 0);
  }, [spaceFiles]);
  const contentFileCount = contentCounts.reduce(
    (total, [, count]) => total + count,
    0
  );
  const showContents = contentCounts.length > 0;
  const showActivity = historyState === 'ready' && thirtyDayActivityCount > 0;
  const summaryReady =
    (historyState === 'ready' || historyState === 'error') &&
    (triggerState === 'ready' || triggerState === 'error');
  const spaceAgeInDays = getSpaceAgeInDays(space.createdAt);
  const summaryVariantIndex = getSpaceSummaryVariantIndex(space.id);
  const summaryVariants = [
    {
      key: 'layout.workspace-overview-summary-one',
      defaultValue:
        "You've brought together {{sessionCount}} Sessions and {{taskCount}} Tasks, with {{automationCount}} automations over {{dayCount}} days.",
    },
    {
      key: 'layout.workspace-overview-summary-two',
      defaultValue:
        'Over {{dayCount}} days, this Space has grown to {{sessionCount}} Sessions, {{taskCount}} Tasks, and {{automationCount}} automations.',
    },
    {
      key: 'layout.workspace-overview-summary-three',
      defaultValue:
        "In {{dayCount}} days, you've built a Space with {{sessionCount}} Sessions, {{taskCount}} Tasks, and {{automationCount}} automations.",
    },
  ] as const;
  const summaryVariant = summaryVariants[summaryVariantIndex];
  const primaryGuideLabel = isFirstTimeUser
    ? t('layout.workspace-onboarding-make-something', {
        defaultValue: 'Show me how to use Eigent',
      })
    : t('layout.workspace-onboarding-whats-new', {
        defaultValue: "What's new about Eigent",
      });
  const primaryGuidePrompt = isFirstTimeUser
    ? t('layout.workspace-onboarding-recommended-prompt', {
        defaultValue:
          'Ask me 1–2 questions about who I am and what I do, then suggest how Eigent can help with one of my tasks and create a personalised interactive HTML guide with a ready-to-use prompt.',
      })
    : t('layout.workspace-onboarding-whats-new-prompt', {
        defaultValue:
          'Search for the latest Eigent release blog and summarise it in a short introduction.',
      });
  const guideTabs = [
    {
      id: 'primary' as const,
      label: primaryGuideLabel,
      icon: isFirstTimeUser ? ListTodo : Megaphone,
      onClick: () => onUsePrompt(primaryGuidePrompt),
    },
    {
      id: 'connect-tools' as const,
      label: t('layout.workspace-onboarding-connect-app', {
        defaultValue: 'Connect tools',
      }),
      icon: Cable,
      onClick: onConnectApp,
    },
    {
      id: 'use-cases' as const,
      label: t('layout.workspace-onboarding-use-cases', {
        defaultValue: 'Explore use cases',
      }),
      icon: BookOpen,
      onClick: onExploreUseCases,
    },
  ];
  const dismissedGuideTabs = new Set(dismissedWorkspaceGuideTabs);
  const visibleGuideTabs = guideTabs
    .filter((tab) => !dismissedGuideTabs.has(tab.id))
    .map((tab) => ({
      ...tab,
      dismissLabel: t('layout.workspace-onboarding-dismiss', {
        defaultValue: 'Hide {{label}}',
        label: tab.label,
      }),
    }));

  return (
    <aside
      data-space-workspace-panel="unified"
      aria-label={t('layout.workspace-space-panel-label', {
        defaultValue: 'Space workspace information',
      })}
      className={cn(
        'scrollbar-always-visible block h-fit max-h-full min-h-0 shrink-0 self-start overflow-y-auto bg-ds-neutral-subtle-default py-3 pl-3',
        RIGHT_RAIL_CONTENT_WIDTH_CLASS
      )}
    >
      {visibleGuideTabs.length > 0 ? (
        <WorkspaceGuideTabs
          tabs={visibleGuideTabs}
          onDismiss={dismissWorkspaceGuideTab}
        />
      ) : null}

      <Section
        first
        title={t('layout.workspace-overview-activity', {
          defaultValue: 'Activity',
        })}
        end={
          showActivity ? (
            <div className="flex shrink-0 gap-1">
              <Button
                type="button"
                size="xs"
                variant={activityRange === 7 ? 'secondary' : 'ghost'}
                aria-pressed={activityRange === 7}
                onClick={() => setActivityRange(7)}
              >
                {t('layout.workspace-overview-activity-seven-days', {
                  defaultValue: '7 days',
                })}
              </Button>
              <Button
                type="button"
                size="xs"
                variant={activityRange === 30 ? 'secondary' : 'ghost'}
                aria-pressed={activityRange === 30}
                onClick={() => setActivityRange(30)}
              >
                {t('layout.workspace-overview-activity-thirty-days', {
                  defaultValue: '30 days',
                })}
              </Button>
            </div>
          ) : undefined
        }
      >
        {hasOverviewSource ? (
          summaryReady ? (
            <DsText as="p" role="base" className="text-ds-ink-muted-default">
              {t(summaryVariant.key, {
                defaultValue: summaryVariant.defaultValue,
                sessionCount: sessionMetas.length,
                taskCount,
                automationCount: spaceTriggers.length,
                dayCount: spaceAgeInDays,
              })}
            </DsText>
          ) : (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-[82%]" />
            </div>
          )
        ) : (
          <DsText role="meta" className="text-ds-ink-muted-default">
            {t('layout.workspace-overview-activity-empty', {
              defaultValue: 'Activity will appear after your first Task.',
            })}
          </DsText>
        )}

        {showActivity ? (
          <div className="mt-4">
            <ActivityLineGraph activity={activity} />
          </div>
        ) : null}
      </Section>

      <Section
        title={t('layout.workspace-overview-contents', {
          defaultValue: 'Files',
        })}
        end={
          <Button
            type="button"
            size="xs"
            variant="secondary"
            disabled={!canOpenFolder}
            onClick={onOpenFolder}
          >
            {t('layout.workspace-overview-open-folder', {
              defaultValue: 'Open folder',
            })}
          </Button>
        }
      >
        {showContents ? (
          <>
            <div className="flex min-w-0 items-center gap-3">
              <DsText
                role="meta"
                weight="semibold"
                className="min-w-0 flex-1 truncate"
                title={space.name}
              >
                {space.name}
              </DsText>
              <DsText
                role="meta"
                className="shrink-0 text-ds-ink-muted-default"
              >
                {t('layout.workspace-overview-file-count', {
                  defaultValue: '{{count}} files',
                  count: contentFileCount,
                })}
              </DsText>
            </div>
            <div
              aria-hidden
              className="mt-3 flex h-2.5 gap-0.5 overflow-hidden rounded-lg bg-ds-neutral-muted-default"
            >
              {contentCounts.map(([category, count]) => (
                <span
                  key={category}
                  className={contentCategoryClasses[category]}
                  style={{ flexGrow: count, flexBasis: 0 }}
                />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {contentCounts.map(([category, count]) => (
                <Tag key={category} size="xs" variant="text" tone="neutral">
                  <span
                    aria-hidden
                    className={cn(
                      'size-2 rounded-full',
                      contentCategoryClasses[category]
                    )}
                  />
                  <span>
                    {t(contentCategoryTranslationKeys[category], {
                      defaultValue: category,
                    })}
                  </span>
                  <span>{count}</span>
                </Tag>
              ))}
            </div>
          </>
        ) : (
          <DsText role="meta" className="text-ds-ink-muted-default">
            {t('layout.workspace-overview-context-empty', {
              defaultValue: 'Files and other Space context will appear here.',
            })}
          </DsText>
        )}
      </Section>
    </aside>
  );
}
