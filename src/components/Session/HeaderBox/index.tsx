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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DsIcon } from '@/components/ui/ds-icon';
import { ShortcutTooltipContent } from '@/components/ui/shortcut-tooltip';
import { TooltipSimple } from '@/components/ui/tooltip';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useIsCompactWidth } from '@/hooks/useIsCompactWidth';
import { useProjectEventRuntime } from '@/hooks/useProjectEventRuntime';
import {
  parseAutomationDraft,
  type AutomationDraftV1,
} from '@/lib/automationDraft';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { isChatEventTimelineEnabled } from '@/store/chatEventProjectionBridge';
import { getSessionPreviewSlice, usePageTabStore } from '@/store/pageTabStore';
import { useSessionControlsStore } from '@/store/sessionControlsStore';
import { useSkillsStore } from '@/store/skillsStore';
import {
  DEFAULT_CHAT_TIMELINE_DETAIL_LEVEL,
  DEFAULT_NARRATIVE_INFORMATION_DENSITY,
  narrativeInformationDensities,
  type ChatTimelineDetailLevel,
  type NarrativeInformationDensity,
} from '@/types/chatTimeline';
import {
  AlarmClock,
  Archive,
  ArrowLeft,
  EllipsisVertical,
  GalleryThumbnails,
  Pencil,
  Pin,
  Trash2,
  WandSparkles,
} from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  selectEventAutomationSource,
  selectLegacyAutomationSource,
  type SessionAutomationSource,
} from './sessionAutomationSource';

const TIMELINE_MODE_FALLBACK_LABELS: Record<ChatTimelineDetailLevel, string> = {
  narrative: 'Narrative',
  trajectory: 'Trajectory',
};

const NARRATIVE_DENSITY_FALLBACK_LABELS: Record<
  NarrativeInformationDensity,
  string
> = {
  compact: 'Compact',
  balanced: 'Balanced',
  expanded: 'Expanded',
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
  projectId?: string | null;
  projectAchieved?: boolean;
  /** Optional extra class names for the outer container */
  className?: string;
  /** Reserve header height without controls or token count. */
  empty?: boolean;
}

export function HeaderBox({
  totalTokens = 0,
  projectName,
  projectId,
  projectAchieved = false,
  className,
  empty = false,
}: HeaderBoxProps) {
  const { t } = useTranslation();
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const titleRef = useRef<HTMLSpanElement>(null);
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
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);
  const sessionPreviewOpen = usePageTabStore(
    (s) => getSessionPreviewSlice(s).open
  );
  const toggleSessionPreview = usePageTabStore((s) => s.toggleSessionPreview);
  const chatTimelineDetailLevel = usePageTabStore(
    (s) => s.chatTimelineDetailLevel ?? DEFAULT_CHAT_TIMELINE_DETAIL_LEVEL
  );
  const setChatTimelineDetailLevel = usePageTabStore(
    (s) => s.setChatTimelineDetailLevel
  );
  const narrativeInformationDensity = usePageTabStore(
    (s) =>
      s.narrativeInformationDensity ?? DEFAULT_NARRATIVE_INFORMATION_DENSITY
  );
  const setNarrativeInformationDensity = usePageTabStore(
    (s) => s.setNarrativeInformationDensity
  );
  const eventNativeTimelineEnabled = isChatEventTimelineEnabled();
  const pinnedProjectIds = useSessionControlsStore((s) => s.pinnedProjectIds);
  const togglePinned = useSessionControlsStore((s) => s.togglePinned);
  const requestSessionAction = useSessionControlsStore((s) => s.requestAction);
  const requestChatDraft = usePageTabStore(
    (state) => state.requestWorkspaceChatDraft
  );
  const activePreviewProjectId = usePageTabStore(
    (state) => state.sessionPreviewProjectId
  );
  const skillAvailable = useSkillsStore((state) =>
    state.skills.some(
      (skill) =>
        skill.enabled &&
        (skill.name === 'automation-draft' ||
          skill.skillDirName === 'automation-draft')
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
  const timelineStyleLabel = (level: ChatTimelineDetailLevel) =>
    t(`chat.timeline-style-${level}`, {
      defaultValue: TIMELINE_MODE_FALLBACK_LABELS[level],
    });
  const densityLabel = (density: NarrativeInformationDensity) =>
    t(`chat.timeline-density-${density}`, {
      defaultValue: NARRATIVE_DENSITY_FALLBACK_LABELS[density],
    });
  const draftWithSkill = () => {
    if (!projectId || !automationSource || activePreviewProjectId !== projectId)
      return;
    if (!skillAvailable) {
      toast.info(t('chat.automation-skill-unavailable'));
      return;
    }
    const prompt = [
      '#automation-draft',
      'Use the automation-draft skill to propose an editable automation for this completed Task. Do not create it. Return the versioned automation-draft block.',
      `Original request:\n${automationSource.taskPrompt.slice(0, 4000)}`,
      `Final result summary:\n${automationSource.resultContent.slice(0, 4000)}`,
    ].join('\n\n');
    requestChatDraft(prompt, undefined, { projectId, ifEmpty: true });
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

  if (empty) {
    return (
      <div
        ref={headerRef}
        className={cn(CONTENT_HEADER_CLASS, 'justify-between', className)}
        aria-hidden
      />
    );
  }

  return (
    <div
      ref={headerRef}
      className={cn(CONTENT_HEADER_CLASS, 'justify-between', className)}
    >
      {/* Left: return to workspace, Session identity, and its controls. */}
      <div className="flex min-w-0 items-center gap-2">
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
            <DsIcon icon={ArrowLeft} recipe="main" />
          </Button>
        </TooltipSimple>
        {projectName ? (
          <DropdownMenu
            open={sessionMenuOpen}
            onOpenChange={setSessionMenuOpen}
          >
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                buttonContent="text"
                className={cn(
                  'no-drag max-w-full min-w-0 shrink',
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
              className="w-64"
              onCloseAutoFocus={(event) => {
                if (automationDialogOpen) event.preventDefault();
              }}
            >
              <DropdownMenuItem
                disabled={
                  !automationSource || activePreviewProjectId !== projectId
                }
                onSelect={draftWithSkill}
              >
                <DsIcon icon={WandSparkles} recipe="main" />
                {t('chat.automation-draft-with-skill')}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!automationSource}
                onSelect={openAutomationDialog}
              >
                <DsIcon icon={AlarmClock} recipe="main" />
                {t('chat.create-automation-from-task', {
                  defaultValue: 'Create automation',
                })}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {eventNativeTimelineEnabled ? (
                <>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="min-h-ds-control-lg">
                      {t('chat.timeline-view-settings', {
                        defaultValue: 'View settings',
                      })}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-44">
                      <DropdownMenuRadioGroup
                        value={chatTimelineDetailLevel}
                        onValueChange={(value) =>
                          setChatTimelineDetailLevel(
                            value as ChatTimelineDetailLevel
                          )
                        }
                        aria-label={t('chat.timeline-view-label')}
                      >
                        {(['narrative', 'trajectory'] as const).map((level) => (
                          <DropdownMenuRadioItem key={level} value={level}>
                            {timelineStyleLabel(level)}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger
                      className="min-h-ds-control-lg"
                      disabled={chatTimelineDetailLevel !== 'narrative'}
                    >
                      {t('chat.timeline-narrative-detail-label', {
                        defaultValue: 'Narrative detail',
                      })}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-44">
                      <DropdownMenuRadioGroup
                        value={narrativeInformationDensity}
                        onValueChange={(value) =>
                          setNarrativeInformationDensity(
                            value as NarrativeInformationDensity
                          )
                        }
                        aria-label={t('chat.timeline-narrative-detail-label', {
                          defaultValue: 'Narrative detail',
                        })}
                      >
                        {narrativeInformationDensities.map((density) => (
                          <DropdownMenuRadioItem key={density} value={density}>
                            {densityLabel(density)}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                </>
              ) : null}
              <DropdownMenuItem
                disabled={!projectId}
                onSelect={() => {
                  if (projectId) togglePinned(projectId);
                }}
              >
                <DsIcon icon={Pin} recipe="main" />
                {t(pinned ? 'layout.unpin' : 'layout.pin')}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!projectId}
                onSelect={() => {
                  if (projectId) requestSessionAction('rename', projectId);
                }}
              >
                <DsIcon icon={Pencil} recipe="main" />
                {t('layout.rename-project')}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!projectId || projectAchieved}
                onSelect={() => {
                  if (projectId) requestSessionAction('end', projectId);
                }}
              >
                <DsIcon icon={Archive} recipe="main" />
                {t('layout.achieve-project')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-ds-text-error-default-default focus:text-ds-text-error-strong-default data-[highlighted]:text-ds-text-error-default-default [&>svg]:text-ds-icon-error-default-default"
                disabled={!projectId}
                onSelect={() => {
                  if (projectId) requestSessionAction('delete', projectId);
                }}
              >
                <DsIcon icon={Trash2} recipe="main" />
                {t('layout.delete-project')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {/* Right: optional token count + preview toggle. */}
      <div className="flex items-center gap-2 text-ds-ink-muted-default">
        {!compact ? (
          <div className="flex items-center gap-1">
            <img src={tokenIcon} alt="" className="h-3.5 w-3.5" />
            <span className="text-xs font-medium">
              {t('chat.token-total-label')}{' '}
              <AnimatedTokenNumber value={totalTokens} />
            </span>
          </div>
        ) : null}
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
            onClick={(event) => {
              const wasOpen = sessionPreviewOpen;
              toggleSessionPreview();
              // Closing leaves :focus on the ghost button, which keeps the
              // hover/selected fill until the next click elsewhere.
              if (wasOpen) {
                event.currentTarget.blur();
              }
            }}
            className={cn(
              'no-drag shrink-0 text-ds-ink-muted-default hover:bg-ds-neutral-strong-default',
              sessionPreviewOpen &&
                'bg-ds-neutral-strong-default text-ds-ink-default-default'
            )}
            aria-label={windowPreviewTooltip}
            aria-pressed={sessionPreviewOpen}
          >
            <DsIcon icon={GalleryThumbnails} recipe="main" />
          </Button>
        </TooltipSimple>
      </div>
      {automationDialogContext ? (
        <TriggerDialog
          selectedTrigger={null}
          isOpen={automationDialogOpen}
          onOpenChange={setAutomationDialogOpen}
          sourceProjectId={automationDialogContext.projectId}
          initialTaskPrompt={automationDialogContext.source.taskPrompt}
          initialDraft={automationDialogContext.draft}
        />
      ) : null}
    </div>
  );
}
