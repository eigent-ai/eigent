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
import { DsIcon } from '@/components/ui/ds-icon';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const RUNNING_DOT_DELAYS = [0, 0.15, 0.3] as const;

export interface FloatingActionProps {
  /** Show Stop task on the left; it exists only while a task is running. */
  showStop: boolean;
  onStop?: () => void;
  /** Disables Stop task while a stop request is in flight. */
  stopLoading?: boolean;
  /** A task is running: the right side shows animated dots until hovered. */
  running: boolean;
  /** The timeline is scrolled up from its latest content. */
  scrolledUp: boolean;
  onScrollToBottom: () => void;
  className?: string;
}

/**
 * Three dots in the user's accent color rising and falling in turn; still
 * under reduced motion.
 */
function RunningDots() {
  const reducedMotion = useReducedMotion();
  return (
    <span aria-hidden className="flex items-center gap-ds-2">
      {RUNNING_DOT_DELAYS.map((delay) => (
        <motion.span
          key={delay}
          className="size-1 rounded-full bg-ds-accent-default-default"
          animate={reducedMotion ? undefined : { y: [0, -3, 0] }}
          transition={
            reducedMotion
              ? undefined
              : {
                  duration: 0.9,
                  ease: 'easeInOut',
                  repeat: Infinity,
                  delay,
                }
          }
        />
      ))}
    </span>
  );
}

/**
 * Floating control above the composer. Stop task (left) and scroll to the
 * latest content (right) share one pill, split by a hairline divider. While
 * a task runs the right side shows running dots, swapped for an arrow only on
 * hover or focus. Without a running task it shows the arrow while the
 * timeline is scrolled up.
 */
export const FloatingAction = ({
  showStop,
  onStop,
  stopLoading = false,
  running,
  scrolledUp,
  onScrollToBottom,
  className,
}: FloatingActionProps) => {
  const { t } = useTranslation();
  if (!showStop && !running && !scrolledUp) return null;
  const showArrowOnly = !running;

  return (
    <div
      className={cn(
        'pointer-events-none flex w-full items-center justify-center',
        className
      )}
    >
      <div className="pointer-events-auto flex items-center gap-ds-4 rounded-full border border-x border-y border-ds-hairline-default-default bg-ds-neutral-subtle-default p-1 shadow-button-shadow backdrop-blur-md">
        {showStop ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={onStop}
              disabled={stopLoading}
              className="rounded-full"
            >
              <span className="!text-ds-text-base font-semibold">
                {t('chat.stop-task', { defaultValue: 'Stop Task' })}
              </span>
            </Button>
            <Separator orientation="vertical" className="!h-ds-16" />
          </>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          buttonContent="icon-only"
          onClick={onScrollToBottom}
          aria-label={t('chat.scroll-to-bottom', {
            defaultValue: 'Scroll to bottom',
          })}
          title={t('chat.scroll-to-bottom', {
            defaultValue: 'Scroll to bottom',
          })}
          className="group/scroll-bottom rounded-full"
          data-floating-scroll-state={showArrowOnly ? 'arrow' : 'running'}
        >
          {showArrowOnly ? (
            <DsIcon icon={ArrowDown} aria-hidden />
          ) : (
            <>
              <span className="flex group-hover/scroll-bottom:hidden group-focus-visible/scroll-bottom:hidden">
                <RunningDots />
              </span>
              <span className="hidden group-hover/scroll-bottom:flex group-focus-visible/scroll-bottom:flex">
                <DsIcon icon={ArrowDown} aria-hidden />
              </span>
            </>
          )}
        </Button>
      </div>
    </div>
  );
};
