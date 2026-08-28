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
import {
  getFilesTabBindingLabel,
  hasUserBoundLocalFolder,
} from '@/lib/spaceLabel';
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
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  categorizeSpaceFile,
  getSpaceAgeInDays,
  getSpaceSummaryVariantIndex,
  resolveSpaceFileTargets,
  SPACE_CONTENT_CATEGORY_ORDER,
  SPACE_FILE_LISTING_LIMIT,
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

const TRIGGER_PAGE_SIZE = 100;
const TRIGGER_PAGE_LIMIT = 10;
const COARSE_POINTER_HIT_AREA_XS =
  'relative after:absolute after:inset-x-0 after:hidden after:-inset-y-ds-10 [@media(pointer:coarse)]:min-w-ds-48 [@media(pointer:coarse)]:after:block';
const COARSE_POINTER_HIT_AREA_SM =
  'after:absolute after:hidden after:-inset-ds-8 [@media(pointer:coarse)]:after:block';

/**
 * The trigger endpoint has no Space filter, so the whole account list is
 * paged in and filtered here. A single page would silently undercount any
 * account past `TRIGGER_PAGE_SIZE` automations.
 */
async function fetchAllTriggers(): Promise<Trigger[]> {
  // Keyed by trigger id rather than appended: a bare-array response carries no
  // `total`, so an endpoint that ignores `page` and replays the same full page
  // would otherwise multiply every automation count by the pages requested.
  const collected = new Map<number, Trigger>();
  for (let page = 1; page <= TRIGGER_PAGE_LIMIT; page += 1) {
    const response = await proxyFetchTriggers(
      undefined,
      undefined,
      page,
      TRIGGER_PAGE_SIZE
    );
    const items = (response?.items ?? response ?? []) as Trigger[];
    if (!Array.isArray(items) || items.length === 0) break;
    const countBeforePage = collected.size;
    items.forEach((trigger) => collected.set(trigger.id, trigger));
    // A page that adds nothing new means the endpoint is not paging.
    if (collected.size === countBeforePage) break;
    const total = Number(response?.total);
    if (Number.isFinite(total) && collected.size >= total) break;
    if (items.length < TRIGGER_PAGE_SIZE) break;
  }
  return [...collected.values()];
}

interface SpaceWorkspacePanelProps {
  space: Space;
  onUsePrompt: (prompt: string) => void;
  onConnectApp: () => void;
  onExploreUseCases: () => void;
  onOpenFiles: () => void;
  onOpenFolder: () => void;
  canOpenFolder: boolean;
  canUsePrompt?: boolean;
}

function Section({
  title,
  titleHref,
  onTitleClick,
  titleAccessory,
  first = false,
  end,
  children,
}: {
  title?: string;
  titleHref?: string;
  onTitleClick?: () => void;
  titleAccessory?: ReactNode;
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
      {title || titleAccessory || end ? (
        <div className="mb-ds-16 flex min-w-0 items-center gap-ds-8">
          {title || titleAccessory ? (
            <div className="flex min-w-0 flex-1 items-center gap-ds-8 self-stretch">
              {title ? (
                <DsText
                  as="h2"
                  role="base"
                  weight="semibold"
                  className="min-w-0 text-ds-ink-default-default"
                >
                  {titleHref ? (
                    <Link
                      to={titleHref}
                      onClick={onTitleClick}
                      className={cn(
                        'rounded-ds-control text-inherit no-underline underline-offset-2 ring-offset-ds-neutral-subtle-default hover:underline',
                        DS_FOCUS_RING
                      )}
                    >
                      {title}
                    </Link>
                  ) : (
                    title
                  )}
                </DsText>
              ) : null}
              {titleAccessory}
            </div>
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
        className={cn(
          'absolute top-1/2 right-ds-8 -translate-y-1/2 opacity-0 transition-opacity duration-[160ms] group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100',
          COARSE_POINTER_HIT_AREA_SM
        )}
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

export function SpaceWorkspacePanel({
  space,
  onUsePrompt,
  onConnectApp,
  onExploreUseCases,
  onOpenFiles,
  onOpenFolder,
  canOpenFolder,
  canUsePrompt = true,
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
  const restoreWorkspaceGuideTabs = useAuthStore(
    (state) => state.restoreWorkspaceGuideTabs
  );
  const setWorkspaceGuideAudience = useAuthStore(
    (state) => state.setWorkspaceGuideAudience
  );
  const projectsBySpaceId = useSpaceStore((state) => state.projectsBySpaceId);
  const sessionMetas = useMemo(
    () => getVisibleProjectMetasForSpace(projectsBySpaceId, space.id),
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
  const [filesTruncated, setFilesTruncated] = useState(false);

  // Space-identifying primitives, so a new Space object from a server sync
  // does not re-issue every `/files` request on its own.
  const spaceId = space.id;
  const spaceRootPath = space.rootPath ?? null;
  const spaceSourceType = space.sourceType;
  const spaceBindingSource = space.metadata?.bindingSource;
  const spaceLocalWorkspaceSource = space.metadata?.localWorkspaceSource;

  // Deliberately not gated on `hasOverviewSource`: that flag is derived from
  // the project list this sync populates, so gating on it would leave a Space
  // whose Sessions live only on the server permanently showing the empty
  // state. `shouldSyncProjects` already carries the TTL that stops repeat work.
  useEffect(() => {
    const store = useSpaceStore.getState();
    if (store.shouldSyncProjects(space.id)) {
      void store.syncProjectsFromServer(space.id);
    }
  }, [space.id]);

  // Having done work is a one-way door out of the first-run guide. Without
  // this the audience stays 'new' for the life of the install, so archiving
  // every Session would put a seasoned user back on the onboarding tile.
  useEffect(() => {
    if (workspaceGuideAudience !== 'new' || totalSessionCount === 0) return;
    setWorkspaceGuideAudience('existing');
  }, [setWorkspaceGuideAudience, totalSessionCount, workspaceGuideAudience]);

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
        if (!projects) {
          // `null` means the response carried no `projects` field — the shape
          // `fetchGroupedHistoryTasks` falls back to legacy grouping for.
          // Reading it as an empty list would render a confident "0 Sessions,
          // 0 Tasks" over a Space that is not empty.
          setHistoryProjects([]);
          setHistoryState('error');
          return;
        }
        setHistoryProjects(projects);
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

  const projectIdsKey = sessionMetas.map((session) => session.id).join(',');

  useEffect(() => {
    if (!hasOverviewSource) {
      setSpaceTriggers([]);
      setTriggerState('idle');
      return;
    }
    let cancelled = false;
    setTriggerState('loading');
    // `projectIdsKey` rather than a Set: `projectsBySpaceId` gets a fresh
    // identity on every project-meta write, and depending on a derived Set
    // would refetch the account-wide trigger list on each of them.
    const sessionIds = new Set(projectIdsKey.split(',').filter(Boolean));
    void fetchAllTriggers()
      .then((triggers) => {
        if (cancelled) return;
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
  }, [hasOverviewSource, projectIdsKey, space.id]);

  useLayoutEffect(() => {
    // Clear before paint when the Space or its source changes. Keeping the
    // previous aggregate visible while the next listing loads attributes one
    // Space's files to another.
    setSpaceFiles([]);
    setFilesTruncated(false);
    if (!hasOverviewSource || !email) {
      return;
    }
    const attempts = resolveSpaceFileTargets(
      {
        id: spaceId,
        rootPath: spaceRootPath,
        sourceType: spaceSourceType,
        metadata: {
          bindingSource: spaceBindingSource,
          localWorkspaceSource: spaceLocalWorkspaceSource,
        },
      },
      projectIdsKey.split(',').filter(Boolean)
    );
    if (attempts.length === 0) {
      return;
    }
    const controller = new AbortController();
    let cancelled = false;

    const listFiles = async (projectId: string) => {
      const response = await fetchGet(
        '/files',
        {
          project_id: projectId,
          email,
          space_id: spaceId,
          ...(userId != null ? { user_id: String(userId) } : {}),
        },
        undefined,
        { signal: controller.signal }
      );
      if (!Array.isArray(response)) return [];
      return response.map((item: RemoteFileRecord) => {
        const filename = item.filename || item.name || '';
        return {
          ...item,
          filename,
          // `filterVisibleAgentFiles` reads `name` for the entry and
          // `relativePath` for the directory it sits in; Brain returns
          // `filename` and `relative_path`, so mirror both or `camel_logs`
          // entries and task-root folders slip through.
          name: filename,
          relativePath: item.relativePath || item.relative_path || filename,
          projectId,
        };
      });
    };

    const run = async () => {
      for (const attempt of attempts) {
        // Partial results beat none: one unreachable Project should not blank
        // out the file breakdown for every other Project in the Space.
        const settled = await Promise.allSettled(attempt.ids.map(listFiles));
        if (cancelled || controller.signal.aborted) return;
        const lists: RemoteFileRecord[][] = [];
        settled.forEach((result) => {
          if (result.status === 'fulfilled') {
            lists.push(result.value);
            return;
          }
          console.warn(
            '[SpaceWorkspacePanel] Failed to load files:',
            result.reason
          );
        });
        const truncated = lists.some(
          (list) => list.length >= SPACE_FILE_LISTING_LIMIT
        );
        const uniqueFiles = new Map<string, RemoteFileRecord>();
        filterVisibleAgentFiles(lists.flat()).forEach((file) => {
          const name = file.filename || file.name || '';
          const relativePath = file.relativePath || file.relative_path || name;
          // A Space-scoped listing resolves to a single workspace root, so the
          // path alone identifies a file. Only the per-Project fan-out reads
          // from distinct roots that may repeat a relative path.
          const key =
            attempt.scope === 'space-root'
              ? relativePath
              : `${file.projectId ?? ''}:${relativePath}`;
          if (name && key) uniqueFiles.set(key, file);
        });
        if (uniqueFiles.size === 0 && attempt !== attempts.at(-1)) {
          // A Space carrying a rootPath synced from another machine can be
          // unbound in this Brain; fall through to the per-Project roots.
          continue;
        }
        setSpaceFiles([...uniqueFiles.values()]);
        setFilesTruncated(truncated);
        return;
      }
      setSpaceFiles([]);
      setFilesTruncated(false);
    };

    void run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    email,
    hasOverviewSource,
    projectIdsKey,
    spaceBindingSource,
    spaceId,
    spaceLocalWorkspaceSource,
    spaceRootPath,
    spaceSourceType,
    userId,
  ]);

  const { sessionCount, taskCount } = historyProjects.reduce(
    (totals, project) => {
      const projectTaskCount = project.task_count ?? project.tasks?.length ?? 0;
      return {
        sessionCount: totals.sessionCount + (projectTaskCount > 0 ? 1 : 0),
        taskCount: totals.taskCount + projectTaskCount,
      };
    },
    { sessionCount: 0, taskCount: 0 }
  );
  const contentCounts = useMemo(() => {
    const counts = new Map<SpaceContentCategory, number>();
    spaceFiles.forEach((file) => {
      if (file.isFolder) return;
      const name = file.filename || file.name || '';
      const category = categorizeSpaceFile(name);
      counts.set(category, (counts.get(category) ?? 0) + 1);
    });
    // Fixed order, not Map insertion order: the latter follows whichever file
    // type the listing happened to return first, so segments would reshuffle
    // between refetches of the same Space.
    return SPACE_CONTENT_CATEGORY_ORDER.map(
      (category) => [category, counts.get(category) ?? 0] as const
    ).filter(([, count]) => count > 0);
  }, [spaceFiles]);
  const contentFileCount = contentCounts.reduce(
    (total, [, count]) => total + count,
    0
  );
  const showContents = contentCounts.length > 0;
  const bindingLabel = getFilesTabBindingLabel(space, t);
  const summaryUnavailable =
    historyState === 'error' || triggerState === 'error';
  const summaryReady = historyState === 'ready' && triggerState === 'ready';
  const spaceAgeInDays = getSpaceAgeInDays(space.createdAt);
  const summaryVariantIndex = getSpaceSummaryVariantIndex(space.id);
  const summaryVariants = [
    {
      key: 'layout.workspace-overview-summary-one',
      defaultValue:
        "You've brought together <highlight>{{sessionCountLabel}}</highlight> and <highlight>{{taskCountLabel}}</highlight>, with <highlight>{{automationCountLabel}}</highlight> over <highlight>{{dayCountLabel}}</highlight>.",
    },
    {
      key: 'layout.workspace-overview-summary-two',
      defaultValue:
        'Over <highlight>{{dayCountLabel}}</highlight>, this Space has grown to <highlight>{{sessionCountLabel}}</highlight>, <highlight>{{taskCountLabel}}</highlight>, and <highlight>{{automationCountLabel}}</highlight>.',
    },
    {
      key: 'layout.workspace-overview-summary-three',
      defaultValue:
        "In <highlight>{{dayCountLabel}}</highlight>, you've built a Space with <highlight>{{sessionCountLabel}}</highlight>, <highlight>{{taskCountLabel}}</highlight>, and <highlight>{{automationCountLabel}}</highlight>.",
    },
  ] as const;
  const summaryVariant = summaryVariants[summaryVariantIndex];
  const sessionCountLabel = t('layout.workspace-overview-session-count', {
    defaultValue:
      sessionCount === 1 ? '{{count}} Session' : '{{count}} Sessions',
    count: sessionCount,
  });
  const taskCountLabel = t('layout.workspace-overview-task-count', {
    defaultValue: taskCount === 1 ? '{{count}} Task' : '{{count}} Tasks',
    count: taskCount,
  });
  const automationCountLabel = t('layout.workspace-overview-automation-count', {
    defaultValue:
      spaceTriggers.length === 1
        ? '{{count}} automation'
        : '{{count}} automations',
    count: spaceTriggers.length,
  });
  const dayCountLabel = t('layout.workspace-overview-day-count', {
    defaultValue: spaceAgeInDays === 1 ? '{{count}} day' : '{{count}} days',
    count: spaceAgeInDays,
  });
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
    ...(canUsePrompt
      ? [
          {
            id: 'primary' as const,
            label: primaryGuideLabel,
            icon: isFirstTimeUser ? ListTodo : Megaphone,
            onClick: () => onUsePrompt(primaryGuidePrompt),
          },
        ]
      : []),
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
  // Dismissal is permanent and applies to every Space, so a stray click on the
  // hover-revealed close button needs a way back.
  const handleDismissGuideTab = (tabId: WorkspaceGuideTabId) => {
    dismissWorkspaceGuideTab(tabId);
    const toastId = toast(
      t('layout.workspace-onboarding-dismissed', {
        defaultValue: 'Shortcut hidden',
      }),
      {
        action: {
          label: t('layout.workspace-onboarding-dismiss-undo', {
            defaultValue: 'Undo',
          }),
          onClick: () => {
            restoreWorkspaceGuideTabs([tabId]);
            toast.dismiss(toastId);
          },
        },
      }
    );
  };

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
          onDismiss={handleDismissGuideTab}
        />
      ) : null}

      <Section
        first={visibleGuideTabs.length === 0}
        title={t('layout.workspace-overview-activity', {
          defaultValue: 'Activity',
        })}
      >
        {hasOverviewSource ? (
          summaryUnavailable ? (
            <DsText as="p" role="base" className="text-ds-ink-muted-default">
              {t('layout.workspace-overview-summary-unavailable', {
                defaultValue: 'Activity summary is temporarily unavailable.',
              })}
            </DsText>
          ) : summaryReady ? (
            <DsText as="p" role="base" className="text-ds-ink-muted-default">
              <Trans
                t={t}
                i18nKey={summaryVariant.key}
                defaults={summaryVariant.defaultValue}
                values={{
                  sessionCountLabel,
                  taskCountLabel,
                  automationCountLabel,
                  dayCountLabel,
                }}
                components={{
                  highlight: (
                    <strong className="font-bold text-ds-accent-default-default" />
                  ),
                }}
              />
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
      </Section>

      <Section
        title={t('layout.workspace-overview-contents', {
          defaultValue: 'Files',
        })}
        titleHref="/"
        onTitleClick={onOpenFiles}
        titleAccessory={
          /*
           * Brain resolves a bound Space to one workspace root and an
           * unbound one to per-Project roots, so keep that provenance beside
           * the Files title rather than grouping it with the folder action.
           */
          bindingLabel ? (
            <Tag
              size="xxs"
              variant="secondary"
              tone="neutral"
              title={bindingLabel.tooltip}
              className="shrink-0 self-stretch"
            >
              {bindingLabel.label}
            </Tag>
          ) : null
        }
        end={
          <Button
            type="button"
            size="xs"
            variant="secondary"
            className={COARSE_POINTER_HIT_AREA_XS}
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
                {filesTruncated
                  ? t('layout.workspace-overview-file-count-capped', {
                      defaultValue: '{{count}}+ files',
                      count: contentFileCount,
                    })
                  : t('layout.workspace-overview-file-count', {
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
