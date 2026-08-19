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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TooltipSimple } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { isChatEventTimelineEnabled } from '@/store/chatEventProjectionBridge';
import { getSessionPreviewSlice, usePageTabStore } from '@/store/pageTabStore';
import {
  chatTimelineDetailLevels,
  DEFAULT_CHAT_TIMELINE_DETAIL_LEVEL,
  type ChatTimelineDetailLevel,
} from '@/types/chatTimeline';
import { ArrowLeft, Captions, GalleryThumbnails } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const TIMELINE_STYLE_LABEL_KEYS: Record<
  ChatTimelineDetailLevel,
  'normal' | 'detailed' | 'summarized'
> = {
  normal: 'normal',
  detailed: 'detailed',
  summarized: 'summarized',
};

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
  const [timelineStyleMenuOpen, setTimelineStyleMenuOpen] = useState(false);
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
    t(`chat.timeline-style-${TIMELINE_STYLE_LABEL_KEYS[level]}`, {
      defaultValue:
        level === 'normal'
          ? 'Normal'
          : level === 'detailed'
            ? 'Detailed'
            : 'Summarised',
    });
  const handleTimelineStyleChange = (value: string) => {
    if (chatTimelineDetailLevels.includes(value as ChatTimelineDetailLevel)) {
      setChatTimelineDetailLevel(value as ChatTimelineDetailLevel);
    }
  };

  if (empty) {
    return (
      <div
        className={cn(CONTENT_HEADER_CLASS, 'justify-between', className)}
        aria-hidden
      />
    );
  }

  return (
    <div className={cn(CONTENT_HEADER_CLASS, 'justify-between', className)}>
      {/* Left: return to workspace + display-only Project identity. */}
      <div className="flex min-w-0 items-center gap-2">
        <TooltipSimple content={backTooltip} variant="instant" side="bottom">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
            onClick={() => setActiveWorkspaceTab('workforce')}
            className="no-drag shrink-0 text-ds-text-neutral-muted-default hover:bg-ds-bg-neutral-strong-default"
            aria-label={backTooltip}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Button>
        </TooltipSimple>
        {projectName ? (
          <span
            className="min-w-0 max-w-[200px] truncate text-body-sm font-semibold text-ds-text-neutral-default-default"
            title={projectName}
          >
            {projectName}
          </span>
        ) : null}
      </div>

      {/* Right: project total token count + unified preview toggle */}
      <div className="flex items-center gap-2 text-ds-text-neutral-muted-default">
        <div className="flex items-center gap-1">
          <img src={tokenIcon} alt="" className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">
            {t('chat.token-total-label')}{' '}
            <AnimatedTokenNumber value={totalTokens} />
          </span>
        </div>
        {eventNativeTimelineEnabled ? (
          <DropdownMenu
            open={timelineStyleMenuOpen}
            onOpenChange={setTimelineStyleMenuOpen}
          >
            <TooltipSimple
              content={timelineStyleTooltip}
              enabled={!timelineStyleMenuOpen}
              variant="instant"
            >
              <span className="inline-flex shrink-0">
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    buttonContent="icon-only"
                    className="no-drag shrink-0 text-ds-text-neutral-muted-default hover:bg-ds-bg-neutral-strong-default data-[state=open]:bg-ds-bg-neutral-strong-default data-[state=open]:text-ds-text-neutral-default-default"
                    aria-label={`${timelineStyleTooltip}: ${timelineStyleLabel(chatTimelineDetailLevel)}`}
                  >
                    <Captions className="h-4 w-4" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
              </span>
            </TooltipSimple>
            <DropdownMenuContent
              align="end"
              sideOffset={4}
              collisionPadding={12}
              className="w-[160px]"
            >
              <DropdownMenuRadioGroup
                value={chatTimelineDetailLevel}
                onValueChange={handleTimelineStyleChange}
              >
                {chatTimelineDetailLevels.map((level) => (
                  <DropdownMenuRadioItem
                    key={level}
                    value={level}
                    className="!text-body-sm"
                  >
                    {timelineStyleLabel(level)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <TooltipSimple
          content={windowPreviewTooltip}
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
              'no-drag shrink-0 text-ds-text-neutral-muted-default hover:bg-ds-bg-neutral-strong-default',
              sessionPreviewOpen &&
                'bg-ds-bg-neutral-strong-default text-ds-text-neutral-default-default'
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
