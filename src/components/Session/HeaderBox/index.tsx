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
import { Button } from '@/components/ui/button';
import { DsIcon } from '@/components/ui/ds-icon';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { ShortcutTooltipContent } from '@/components/ui/shortcut-tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TooltipSimple } from '@/components/ui/tooltip';
import { useIsCompactWidth } from '@/hooks/useIsCompactWidth';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { isChatEventTimelineEnabled } from '@/store/chatEventProjectionBridge';
import { getSessionPreviewSlice, usePageTabStore } from '@/store/pageTabStore';
import { useSessionControlsStore } from '@/store/sessionControlsStore';
import {
  DEFAULT_CHAT_TIMELINE_DETAIL_LEVEL,
  DEFAULT_NARRATIVE_INFORMATION_DENSITY,
  narrativeInformationDensities,
  type ChatTimelineDetailLevel,
  type NarrativeInformationDensity,
} from '@/types/chatTimeline';
import {
  Archive,
  ArrowLeft,
  ChevronDown,
  GalleryThumbnails,
  Pencil,
  Pin,
  Trash2,
} from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
  const densityId = useId();
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const [headerRef, compact] = useIsCompactWidth<HTMLDivElement>(
    COMPACT_WIDTH_THRESHOLD
  );
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
  const pinned = Boolean(projectId && pinnedProjectIds.includes(projectId));
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
          <span
            className="max-w-[200px] min-w-0 truncate text-ds-text-base font-semibold text-ds-ink-default-default"
            title={projectName}
          >
            {projectName}
          </span>
        ) : null}
        {projectName ? (
          <Popover open={sessionMenuOpen} onOpenChange={setSessionMenuOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="md"
                buttonContent="icon-only"
                className="no-drag shrink-0"
                aria-label={`${sessionMenuLabel}: ${projectName}`}
              >
                <DsIcon icon={ChevronDown} recipe="main" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-xs">
              {eventNativeTimelineEnabled ? (
                <>
                  <div className="px-2 py-1.5 text-ds-text-meta font-medium text-ds-ink-muted-default">
                    {t('chat.timeline-view-settings', {
                      defaultValue: 'View settings',
                    })}
                  </div>
                  <div className="px-2 pb-2">
                    <Tabs
                      value={chatTimelineDetailLevel}
                      onValueChange={(value) =>
                        setChatTimelineDetailLevel(
                          value as ChatTimelineDetailLevel
                        )
                      }
                    >
                      <TabsList
                        appearance="default"
                        className="w-full"
                        aria-label={t('chat.timeline-view-label')}
                      >
                        <TabsTrigger
                          className="min-w-0 flex-1"
                          value="narrative"
                          tabIndex={
                            chatTimelineDetailLevel === 'narrative' ? 0 : -1
                          }
                        >
                          {timelineStyleLabel('narrative')}
                        </TabsTrigger>
                        <TabsTrigger
                          className="min-w-0 flex-1"
                          value="trajectory"
                          tabIndex={
                            chatTimelineDetailLevel === 'trajectory' ? 0 : -1
                          }
                        >
                          {timelineStyleLabel('trajectory')}
                        </TabsTrigger>
                      </TabsList>
                      <TabsContent
                        value="narrative"
                        className="mt-2"
                        tabIndex={-1}
                      >
                        <div className="flex flex-col gap-2 pb-2">
                          <label
                            htmlFor={densityId}
                            className="text-ds-text-meta font-medium text-ds-ink-muted-default"
                          >
                            {t('chat.timeline-narrative-detail-label', {
                              defaultValue: 'Narrative detail',
                            })}
                          </label>
                          <input
                            id={densityId}
                            type="range"
                            min={0}
                            max={2}
                            step={1}
                            value={narrativeInformationDensities.indexOf(
                              narrativeInformationDensity
                            )}
                            onChange={(event) =>
                              setNarrativeInformationDensity(
                                narrativeInformationDensities[
                                  Number(event.target.value)
                                ]
                              )
                            }
                            onKeyDown={(event) => {
                              const current =
                                narrativeInformationDensities.indexOf(
                                  narrativeInformationDensity
                                );
                              const next =
                                event.key === 'Home'
                                  ? 0
                                  : event.key === 'End'
                                    ? 2
                                    : event.key === 'ArrowRight' ||
                                        event.key === 'ArrowUp'
                                      ? Math.min(2, current + 1)
                                      : event.key === 'ArrowLeft' ||
                                          event.key === 'ArrowDown'
                                        ? Math.max(0, current - 1)
                                        : null;
                              if (next === null) return;
                              event.preventDefault();
                              setNarrativeInformationDensity(
                                narrativeInformationDensities[next]
                              );
                            }}
                            aria-valuetext={densityLabel(
                              narrativeInformationDensity
                            )}
                            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-ds-neutral-subtle-disabled accent-ds-accent-default-default focus-visible:ring-2 focus-visible:ring-ds-ring-focus focus-visible:ring-offset-2 focus-visible:outline-none"
                          />
                          <div
                            className="flex justify-between gap-1 text-ds-text-meta text-ds-ink-muted-default"
                            aria-hidden
                          >
                            {narrativeInformationDensities.map((density) => (
                              <span key={density}>{densityLabel(density)}</span>
                            ))}
                          </div>
                        </div>
                      </TabsContent>
                      <TabsContent
                        value="trajectory"
                        className="mt-0"
                        tabIndex={-1}
                      />
                    </Tabs>
                  </div>
                  <Separator className="my-1" />
                </>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="md"
                className="w-full justify-start"
                disabled={!projectId}
                onClick={() => {
                  if (projectId) togglePinned(projectId);
                  setSessionMenuOpen(false);
                }}
              >
                <DsIcon icon={Pin} recipe="main" />
                {t(pinned ? 'layout.unpin' : 'layout.pin')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="md"
                className="w-full justify-start"
                disabled={!projectId}
                onClick={() => {
                  if (projectId) requestSessionAction('rename', projectId);
                  setSessionMenuOpen(false);
                }}
              >
                <DsIcon icon={Pencil} recipe="main" />
                {t('layout.rename-project')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="md"
                className="w-full justify-start"
                disabled={!projectId || projectAchieved}
                onClick={() => {
                  if (projectId) requestSessionAction('end', projectId);
                  setSessionMenuOpen(false);
                }}
              >
                <DsIcon icon={Archive} recipe="main" />
                {t('layout.achieve-project')}
              </Button>
              <Separator className="my-1" />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                tone="error"
                className="w-full justify-start"
                disabled={!projectId}
                onClick={() => {
                  if (projectId) requestSessionAction('delete', projectId);
                  setSessionMenuOpen(false);
                }}
              >
                <DsIcon icon={Trash2} recipe="main" />
                {t('layout.delete-project')}
              </Button>
            </PopoverContent>
          </Popover>
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
    </div>
  );
}
