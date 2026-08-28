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
import { ShortcutTooltipContent } from '@/components/ui/shortcut-tooltip';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TooltipSimple } from '@/components/ui/tooltip';
import { useIsCompactWidth } from '@/hooks/useIsCompactWidth';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { isChatEventTimelineEnabled } from '@/store/chatEventProjectionBridge';
import { getSessionPreviewSlice, usePageTabStore } from '@/store/pageTabStore';
import {
  chatTimelineDetailLevels,
  DEFAULT_CHAT_TIMELINE_DETAIL_LEVEL,
  type ChatTimelineDetailLevel,
} from '@/types/chatTimeline';
import {
  ArrowLeft,
  createLucideIcon,
  GalleryThumbnails,
  Logs,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

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

export interface HeaderBoxProps {
  /** Total token count for the current project */
  totalTokens?: number;
  /** Display-only identity for the active Project. */
  projectName?: string | null;
  /** Optional extra class names for the outer container */
  className?: string;
  /** Reserve header height without controls or token count. */
  empty?: boolean;
}

export function HeaderBox({
  totalTokens = 0,
  projectName,
  className,
  empty = false,
}: HeaderBoxProps) {
  const { t } = useTranslation();
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
  const eventNativeTimelineEnabled = isChatEventTimelineEnabled();
  const tokenIcon = appearance === 'dark' ? tokenDarkIcon : tokenLightIcon;
  const backTooltip = t('layout.back-tooltip', {
    defaultValue: 'Back',
  });
  const windowPreviewTooltip = sessionPreviewOpen
    ? t('layout.close-preview-tooltip', { defaultValue: 'Close preview' })
    : t('layout.open-preview-tooltip', { defaultValue: 'Open preview' });
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
      {/* Left: return to workspace + display-only Project identity. */}
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
            <ArrowLeft className="h-4 w-4" aria-hidden />
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
      </div>

      {/* Right: optional token count + timeline pill + preview toggle. */}
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
        {eventNativeTimelineEnabled ? (
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
            <GalleryThumbnails className="h-4 w-4" aria-hidden />
          </Button>
        </TooltipSimple>
      </div>
    </div>
  );
}
