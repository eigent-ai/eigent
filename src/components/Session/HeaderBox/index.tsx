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

import tokenDarkIcon from '@/assets/custom/token-dark.svg';
import tokenLightIcon from '@/assets/custom/token-light.svg';
import { AnimatedTokenNumber } from '@/components/ChatBox/MessageItem/TokenUtils';
import { CONTENT_HEADER_CLASS } from '@/components/Layout/ContentHeader';
import { TriggerDialog } from '@/components/Trigger/TriggerDialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DsIcon } from '@/components/ui/ds-icon';
import { ShortcutTooltipContent } from '@/components/ui/shortcut-tooltip';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TooltipSimple } from '@/components/ui/tooltip';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useIsCompactWidth } from '@/hooks/useIsCompactWidth';
import { useProjectEventRuntime } from '@/hooks/useProjectEventRuntime';
import { useSessionPageTabStore } from '@/hooks/useSessionPageTabStore';
import {
  parseAutomationDraft,
  type AutomationDraftV1,
} from '@/lib/automationDraft';
import { AUTOMATION_ICON } from '@/lib/triggerIcon';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { isChatEventTimelineEnabled } from '@/store/chatEventProjectionBridge';
import { getSessionPreviewSlice } from '@/store/pageTabStore';
import { useSessionControlsStore } from '@/store/sessionControlsStore';
import { useSkillsStore } from '@/store/skillsStore';
import {
  chatTimelineDetailLevels,
  DEFAULT_CHAT_TIMELINE_DETAIL_LEVEL,
  type ChatTimelineDetailLevel,
} from '@/types/chatTimeline';
import {
  Archive,
  ArrowLeft,
  createLucideIcon,
  EllipsisVertical,
  GalleryThumbnails,
  Logs,
  Pencil,
  Pin,
  Trash2,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  selectEventAutomationSource,
  selectLegacyAutomationSource,
  type SessionAutomationSource,
} from './sessionAutomationSource';
import { SummaryToggle, type SummaryToggleProps } from './SummaryToggle';

const SquareText = createLucideIcon('square-text', [
  [
    'rect',
    { width: '18', height: '18', x: '3', y: '3', rx: '2', key: 'frame' },
  ],
  ['path', { d: 'M7 8h10', key: 'line-top' }],
  ['path', { d: 'M7 12h10', key: 'line-middle' }],
  ['path', { d: 'M7 16h6', key: 'line-bottom' }],
]);

/**
 * Narrative reads as prose, trajectory reads as a log trace. The icons
 * carry the distinction on their own so the toggle needs no visible text.
 */
const TIMELINE_MODE_ICONS: Record<ChatTimelineDetailLevel, LucideIcon> = {
  narrative: SquareText,
  trajectory: Logs,
};

const TIMELINE_MODE_FALLBACK_LABELS: Record<ChatTimelineDetailLevel, string> = {
  narrative: 'Narrative',
  trajectory: 'Trajectory',
};

/** Match the composer control row when the resizable Session pane is narrow. */
const COMPACT_WIDTH_THRESHOLD = 460;

/** A mask fades the text itself, so the Button's rest, hover, and open surfaces remain intact. */
const TITLE_OVERFLOW_MASK =
  'linear-gradient(to right, white calc(100% - var(--ds-ref-space-24)), transparent 100%)';

export interface HeaderBoxProps {
  /** Total token count for the current project */
  totalTokens?: number;
  /** Display-only identity for the active Project. */
  projectName?: string | null;
  /** The Session menu is shown only for a saved Project. */
  projectId?: string | null;
  projectAchieved?: boolean;
  /** Optional extra class names for the outer container */
  className?: string;
  /** Show the chat timeline style control (hidden before a Session starts). */
  showTimelineStyle?: boolean;
  /** Show the back-to-workspace button (hidden on the New session page). */
  showBack?: boolean;
  /** Summary column toggle, shown beside Preview when provided. */
  summary?: SummaryToggleProps;
}

export function HeaderBox({
  totalTokens = 0,
  projectName,
  projectId,
  projectAchieved = false,
  className,
  showTimelineStyle = true,
  showBack = true,
  summary,
}: HeaderBoxProps) {
  const { t } = useTranslation();
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const titleRef = useRef<HTMLSpanElement>(null);
  const sessionMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const [titleOverflowing, setTitleOverflowing] = useState(false);
  const [automationDialogOpen, setAutomationDialogOpen] = useState(false);
  const [automationDialogContext, setAutomationDialogContext] = useState<{
    projectId: string;
    source: SessionAutomationSource;
    draft: AutomationDraftV1 | null;
  } | null>(null);
  const { projectStore, chatStore } = useChatStoreAdapter();
  const projectEventRuntime = useProjectEventRuntime();
  const [headerRef, compact] = useIsCompactWidth<HTMLDivElement>(
    COMPACT_WIDTH_THRESHOLD
  );
  useLayoutEffect(() => {
    const title = titleRef.current;
    if (!title) return;

    const measure = () =>
      setTitleOverflowing(title.scrollWidth > title.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(title);
    return () => observer.disconnect();
  }, [projectName]);
  const { appearance } = useAuthStore();
  const setActiveWorkspaceTab = useSessionPageTabStore(
    (s) => s.setActiveWorkspaceTab
  );
  const sessionPreviewOpen = useSessionPageTabStore(
    (s) => getSessionPreviewSlice(s).open
  );
  const toggleSessionPreview = useSessionPageTabStore(
    (s) => s.toggleSessionPreview
  );
  const chatTimelineDetailLevel = useSessionPageTabStore(
    (s) => s.chatTimelineDetailLevel ?? DEFAULT_CHAT_TIMELINE_DETAIL_LEVEL
  );
  const setChatTimelineDetailLevel = useSessionPageTabStore(
    (s) => s.setChatTimelineDetailLevel
  );
  const eventNativeTimelineEnabled = isChatEventTimelineEnabled();
  const pinnedProjectIds = useSessionControlsStore((s) => s.pinnedProjectIds);
  const togglePinned = useSessionControlsStore((s) => s.togglePinned);
  const requestSessionAction = useSessionControlsStore((s) => s.requestAction);
  const requestChatDraft = useSessionPageTabStore(
    (state) => state.requestWorkspaceChatDraft
  );
  const activePreviewProjectId = useSessionPageTabStore(
    (state) => state.sessionPreviewProjectId
  );
  const skillCreatorAvailable = useSkillsStore((state) =>
    state.skills.some(
      (skill) =>
        skill.enabled &&
        (skill.name === 'skill-creator' ||
          skill.skillDirName === 'skill-creator')
    )
  );
  const pinned = Boolean(projectId && pinnedProjectIds.includes(projectId));
  const automationSource = useMemo(() => {
    if (!sessionMenuOpen || !projectId) return null;
    const eventSource = selectEventAutomationSource(
      projectEventRuntime.projectId === projectId
        ? projectEventRuntime.snapshot
        : null,
      projectId
    );
    const legacySource = () => {
      const chatStates = projectStore
        .getAllChatStores(projectId)
        .map(({ chatStore: store }) => ({ tasks: store.getState().tasks }));
      if (
        chatStore?.tasks &&
        !chatStates.some((state) => state.tasks === chatStore.tasks)
      ) {
        chatStates.push({ tasks: chatStore.tasks });
      }
      return selectLegacyAutomationSource(chatStates);
    };
    return eventNativeTimelineEnabled
      ? (eventSource ?? legacySource())
      : (legacySource() ?? eventSource);
  }, [
    chatStore,
    eventNativeTimelineEnabled,
    projectEventRuntime.projectId,
    projectEventRuntime.snapshot,
    projectId,
    projectStore,
    sessionMenuOpen,
  ]);
  const tokenIcon = appearance === 'dark' ? tokenDarkIcon : tokenLightIcon;
  const backTooltip = t('layout.back-tooltip', {
    defaultValue: 'Back',
  });
  const windowPreviewTooltip = sessionPreviewOpen
    ? t('layout.close-preview-tooltip', { defaultValue: 'Close preview' })
    : t('layout.open-preview-tooltip', { defaultValue: 'Open preview' });
  const sessionMenuLabel = t('layout.project-settings', {
    defaultValue: 'Session settings',
  });
  const timelineStyleTooltip = t('chat.timeline-style-tooltip', {
    defaultValue: 'Chat timeline style',
  });
  const timelineStyleLabel = (level: ChatTimelineDetailLevel) =>
    t(`chat.timeline-style-${level}`, {
      defaultValue: TIMELINE_MODE_FALLBACK_LABELS[level],
    });
  const timelineModeOptions = chatTimelineDetailLevels.map((level) => ({
    value: level,
    label: timelineStyleLabel(level),
    icon: TIMELINE_MODE_ICONS[level],
  }));
  const handleTimelineStyleChange = (value: ChatTimelineDetailLevel) => {
    setChatTimelineDetailLevel(value);
  };
  const turnIntoSkill = () => {
    if (!projectId || !automationSource || activePreviewProjectId !== projectId)
      return;
    if (!skillCreatorAvailable) {
      toast.info(t('chat.automation-skill-unavailable'));
      return;
    }
    const prompt = [
      '#skill-creator',
      'Use the skill-creator skill to turn this completed Task into a reusable skill. Generalize the repeatable workflow rather than copying the one-off result. Show the proposed skill for review before saving it.',
      `Original request:\n${automationSource.taskPrompt.slice(0, 4000)}`,
      `Final result summary:\n${automationSource.resultContent.slice(0, 4000)}`,
    ].join('\n\n');
    requestChatDraft(prompt, undefined, projectId, { ifEmpty: true });
  };

  const openAutomationDialog = () => {
    if (!projectId || !automationSource) return;
    setAutomationDialogContext({
      projectId,
      source: automationSource,
      draft: parseAutomationDraft(automationSource.resultContent),
    });
    setAutomationDialogOpen(true);
  };

  return (
    <div
      ref={headerRef}
      className={cn(CONTENT_HEADER_CLASS, 'justify-between', className)}
    >
      {/* Left: return to workspace, Session identity, and its controls. */}
      <div className="flex min-w-0 items-center gap-ds-4">
        {showBack ? (
          <TooltipSimple content={backTooltip} variant="instant" side="bottom">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              buttonContent="icon-only"
              onClick={() => setActiveWorkspaceTab('workforce')}
              className="no-drag shrink-0 text-ds-ink-muted-default hover:bg-ds-neutral-strong-default"
              aria-label={backTooltip}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </Button>
          </TooltipSimple>
        ) : null}
        {projectName && projectId ? (
          <DropdownMenu
            open={sessionMenuOpen}
            onOpenChange={setSessionMenuOpen}
          >
            <DropdownMenuTrigger asChild>
              <Button
                ref={sessionMenuTriggerRef}
                type="button"
                variant="ghost"
                size="sm"
                buttonContent="text"
                className={cn(
                  'no-drag max-w-full min-w-0 shrink active:scale-100',
                  sessionMenuOpen &&
                    'bg-ds-neutral-strong-default text-ds-ink-default-default'
                )}
                aria-label={`${sessionMenuLabel}: ${projectName}`}
              >
                <span
                  ref={titleRef}
                  className="max-w-[200px] min-w-0 overflow-hidden font-semibold whitespace-nowrap"
                  style={
                    titleOverflowing
                      ? {
                          maskImage: TITLE_OVERFLOW_MASK,
                          WebkitMaskImage: TITLE_OVERFLOW_MASK,
                        }
                      : undefined
                  }
                  title={projectName}
                >
                  {projectName}
                </span>
                <DsIcon icon={EllipsisVertical} recipe="main" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-56"
              onCloseAutoFocus={(event) => {
                if (automationDialogOpen) event.preventDefault();
              }}
            >
              <DropdownMenuItem
                disabled={
                  !automationSource || activePreviewProjectId !== projectId
                }
                onSelect={turnIntoSkill}
              >
                <DsIcon icon={WandSparkles} recipe="main" />
                {t('chat.automation-draft-with-skill')}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!automationSource}
                onSelect={openAutomationDialog}
              >
                <DsIcon icon={AUTOMATION_ICON} recipe="main" />
                {t('chat.create-automation-from-task', {
                  defaultValue: 'Turn into automation',
                })}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => togglePinned(projectId)}>
                <DsIcon icon={Pin} recipe="main" />
                {t(pinned ? 'layout.unpin' : 'layout.pin')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => requestSessionAction('rename', projectId)}
              >
                <DsIcon icon={Pencil} recipe="main" />
                {t('layout.rename-project')}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={projectAchieved}
                onSelect={() => requestSessionAction('end', projectId)}
              >
                <DsIcon icon={Archive} recipe="main" />
                {t('layout.achieve-project')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-ds-text-error-default-default focus:text-ds-text-error-strong-default data-[highlighted]:text-ds-text-error-default-default [&>svg]:text-ds-icon-error-default-default"
                onSelect={() => requestSessionAction('delete', projectId)}
              >
                <DsIcon icon={Trash2} recipe="main" />
                {t('layout.delete-project')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : projectName ? (
          <span
            className="max-w-[200px] min-w-0 truncate text-ds-text-base font-semibold text-ds-ink-default-default"
            title={projectName}
          >
            {projectName}
          </span>
        ) : null}
      </div>

      {/* Right: optional token count + timeline pill + preview toggle. */}
      <div className="flex items-center gap-ds-4 text-ds-ink-muted-default">
        {!compact ? (
          <div className="flex items-center gap-1">
            <img src={tokenIcon} alt="" className="h-3.5 w-3.5" />
            <span className="text-xs font-medium">
              {t('chat.token-total-label')}{' '}
              <AnimatedTokenNumber value={totalTokens} />
            </span>
          </div>
        ) : null}
        {eventNativeTimelineEnabled && showTimelineStyle ? (
          <Tabs
            value={chatTimelineDetailLevel}
            onValueChange={(value) =>
              handleTimelineStyleChange(value as ChatTimelineDetailLevel)
            }
            className="no-drag inline-flex shrink-0"
          >
            <TabsList appearance="default" aria-label={timelineStyleTooltip}>
              {timelineModeOptions.map((option) => {
                const Icon = option.icon;
                return (
                  <TabsTrigger
                    key={option.value}
                    value={option.value}
                    aria-label={option.label}
                  >
                    <TooltipSimple
                      content={
                        <ShortcutTooltipContent
                          label={option.label}
                          shortcutId="toggle-timeline-view"
                        />
                      }
                      compact
                      variant="instant"
                      side="bottom"
                    >
                      <div className="inline-flex h-5 w-5 items-center justify-center">
                        <Icon size={16} />
                      </div>
                    </TooltipSimple>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
        ) : null}
        {summary ? <SummaryToggle {...summary} /> : null}
        <TooltipSimple
          content={
            <ShortcutTooltipContent
              label={windowPreviewTooltip}
              shortcutId="toggle-preview-panel"
            />
          }
          compact
          variant="instant"
          side="bottom"
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
            onClick={(event) =>
              toggleSessionPreview({ immediate: event.detail === 0 })
            }
            className={cn(
              'no-drag shrink-0 text-ds-ink-muted-default hover:bg-ds-neutral-strong-default',
              sessionPreviewOpen &&
                'bg-ds-neutral-strong-default text-ds-ink-default-default'
            )}
            aria-label={windowPreviewTooltip}
            aria-pressed={sessionPreviewOpen}
          >
            <GalleryThumbnails aria-hidden />
          </Button>
        </TooltipSimple>
      </div>
      {automationDialogContext ? (
        <TriggerDialog
          selectedTrigger={null}
          isOpen={automationDialogOpen}
          onOpenChange={setAutomationDialogOpen}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            sessionMenuTriggerRef.current?.focus();
          }}
          sourceProjectId={automationDialogContext.projectId}
          initialTaskPrompt={automationDialogContext.source.taskPrompt}
          initialDraft={automationDialogContext.draft}
        />
      ) : null}
    </div>
  );
}
