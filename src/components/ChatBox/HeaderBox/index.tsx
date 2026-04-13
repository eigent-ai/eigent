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

import tokenDarkIcon from '@/assets/token-dark.svg';
import tokenLightIcon from '@/assets/token-light.svg';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent } from '@/components/ui/popover';
import { TooltipSimple } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Menu, PanelRight, PanelRightClose, PlayCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatedTokenNumber } from '../TokenUtils';

interface HeaderBoxProps {
  /** Total token count for the current project */
  totalTokens?: number;
  /** Task status – controls visibility of replay button */
  status?: 'running' | 'finished' | 'pending' | 'pause';
  /** Whether the replay action is in a loading state */
  replayLoading?: boolean;
  /** Callback fired when the replay button is clicked */
  onReplay?: () => void;
  /** When true, the chat timeline rail is folded closed */
  chatTimelineCollapsed?: boolean;
  /** Toggles the chat timeline rail open / folded (wide layout only) */
  onToggleChatTimeline?: () => void;
  /** When true, timeline is shown in a popover instead of the left rail */
  narrowTimelineLayout?: boolean;
  /** Controlled open state for the timeline popover (narrow layout) */
  timelineDropdownOpen?: boolean;
  onTimelineDropdownOpenChange?: (open: boolean) => void;
  /** Timeline content rendered inside the popover when `narrowTimelineLayout` */
  timelineDropdownContent?: ReactNode;
  /** When true, the workforce rail on the right is folded closed (workforce tab only) */
  workforceRailCollapsed?: boolean;
  /** Toggles the workforce rail open / folded (workforce tab only) */
  onToggleWorkforceRail?: () => void;
  /** Optional extra class names for the outer container */
  className?: string;
}

export function HeaderBox({
  totalTokens = 0,
  status,
  replayLoading = false,
  onReplay,
  chatTimelineCollapsed = false,
  onToggleChatTimeline,
  narrowTimelineLayout = false,
  timelineDropdownOpen,
  onTimelineDropdownOpenChange,
  timelineDropdownContent,
  workforceRailCollapsed = false,
  onToggleWorkforceRail,
  className,
}: HeaderBoxProps) {
  const { t } = useTranslation();
  const { appearance } = useAuthStore();
  const tokenIcon = appearance === 'dark' ? tokenDarkIcon : tokenLightIcon;
  const chatHistoryTooltip = t('layout.chat-history-tooltip', {
    defaultValue: 'Chat history',
  });
  const workforceRailExpandTooltip = t('layout.show-workforce-panel', {
    defaultValue: 'Show workforce panel',
  });
  const workforceRailCollapseTooltip = t('layout.minimize-workforce');

  const showReplayButton = status === 'finished';
  const isReplayDisabled =
    status === 'running' || status === 'pending' || status === 'pause';

  return (
    <div
      className={`px-3 flex h-[44px] w-full flex-row items-center justify-between ${className || ''}`}
    >
      {/* Left: timeline menu + replay */}
      <div className="gap-2 flex items-center">
        {narrowTimelineLayout && timelineDropdownContent ? (
          <Popover
            open={timelineDropdownOpen}
            onOpenChange={onTimelineDropdownOpenChange}
          >
            <TooltipSimple content={chatHistoryTooltip}>
              <PopoverPrimitive.Trigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  buttonContent="icon-only"
                  aria-expanded={Boolean(timelineDropdownOpen)}
                  aria-haspopup="dialog"
                  aria-controls="chat-timeline-popover-panel"
                  className="no-drag text-text-label hover:bg-surface-tertiary shrink-0"
                  aria-label={chatHistoryTooltip}
                >
                  <Menu className="h-4 w-4" />
                </Button>
              </PopoverPrimitive.Trigger>
            </TooltipSimple>
            <PopoverContent
              id="chat-timeline-popover-panel"
              align="start"
              sideOffset={4}
              className={cn(
                'min-w-0 p-0 max-h-[min(320px,50vh)] max-w-[calc(100vw-2rem)] overflow-x-hidden overflow-y-auto',
                'w-max'
              )}
            >
              {timelineDropdownContent}
            </PopoverContent>
          </Popover>
        ) : (
          onToggleChatTimeline && (
            <TooltipSimple content={chatHistoryTooltip}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                buttonContent="icon-only"
                onClick={onToggleChatTimeline}
                aria-expanded={!chatTimelineCollapsed}
                aria-controls="chat-timeline-panel"
                className="no-drag text-text-label hover:bg-surface-tertiary shrink-0"
                aria-label={chatHistoryTooltip}
              >
                <Menu className="h-4 w-4" />
              </Button>
            </TooltipSimple>
          )
        )}
        {showReplayButton && (
          <Button
            onClick={onReplay}
            disabled={isReplayDisabled || replayLoading}
            variant="ghost"
            size="sm"
            className="no-drag bg-surface-information font-semibold !text-text-information rounded-full"
          >
            <PlayCircle className="mr-1 h-3.5 w-3.5" />
            {replayLoading ? t('common.loading') : t('chat.replay')}
          </Button>
        )}
      </div>

      {/* Right: project total token count + workforce rail toggle (workforce tab) */}
      <div className="gap-2 text-text-label flex items-center">
        <div className="gap-1 flex items-center">
          <img src={tokenIcon} alt="" className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">
            {t('chat.token-total-label')}{' '}
            <AnimatedTokenNumber value={totalTokens} />
          </span>
        </div>
        {onToggleWorkforceRail && (
          <TooltipSimple
            content={
              workforceRailCollapsed
                ? workforceRailExpandTooltip
                : workforceRailCollapseTooltip
            }
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              buttonContent="icon-only"
              onClick={onToggleWorkforceRail}
              aria-expanded={!workforceRailCollapsed}
              aria-controls="workforce-folded-rail"
              className="no-drag text-text-label hover:bg-surface-tertiary shrink-0"
              aria-label={
                workforceRailCollapsed
                  ? workforceRailExpandTooltip
                  : workforceRailCollapseTooltip
              }
            >
              {workforceRailCollapsed ? (
                <PanelRight className="h-4 w-4" />
              ) : (
                <PanelRightClose className="h-4 w-4" />
              )}
            </Button>
          </TooltipSimple>
        )}
      </div>
    </div>
  );
}
