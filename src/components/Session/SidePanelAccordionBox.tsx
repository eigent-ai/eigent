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

import { cn } from '@/lib/utils';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { type ReactNode, useState } from 'react';

const CONTENT_EASE: [number, number, number, number] = [0.32, 0.72, 0, 1];
const REVEAL_EASE: [number, number, number, number] = [0.23, 1, 0.32, 1];
const LAYOUT_TRANSITION = {
  layout: { duration: 0.28, ease: CONTENT_EASE },
} as const;

export type SidePanelAccordionRenderArgs = { open: boolean };

export type SidePanelAccordionChildren =
  | ReactNode
  | ((state: SidePanelAccordionRenderArgs) => ReactNode);

export function SidePanelAccordionBox({
  title,
  titleSuffix,
  collapsedPreview,
  children,
  defaultOpen = true,
}: {
  title: string;
  /** Small adornment rendered right after the title (e.g. count pill). */
  titleSuffix?: ReactNode;
  /**
   * Compact content below the header when collapsed (static `children` only;
   * render-prop children control their own open/closed layout).
   */
  collapsedPreview?: ReactNode;
  /**
   * Static: classic accordion — body hidden when closed.
   * Render prop: body stays in one region; switch layout by `open` (e.g. summary vs full list).
   */
  children: SidePanelAccordionChildren;
  defaultOpen?: boolean;
}) {
  const shouldReduceMotion = useReducedMotion();
  const [open, setOpen] = useState(defaultOpen);
  const isRenderProp = typeof children === 'function';
  const dynamicBody = isRenderProp
    ? (children as (s: SidePanelAccordionRenderArgs) => ReactNode)({ open })
    : null;

  return (
    <div className="z-10 flex min-w-0 shrink-0 flex-col overflow-hidden rounded-xl border border-solid border-ds-border-neutral-subtle-disabled bg-ds-bg-neutral-default-default">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full shrink-0 items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-ds-bg-neutral-default-hover"
        aria-expanded={open}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-body-sm font-semibold text-ds-text-neutral-default-default">
            {title}
          </span>
          {titleSuffix ? (
            <span className="flex shrink-0 items-center">{titleSuffix}</span>
          ) : null}
        </div>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-ds-text-neutral-muted-default transition-transform duration-200 ease-out motion-reduce:transition-none',
            open ? 'rotate-0' : '-rotate-90'
          )}
          aria-hidden
        />
      </button>

      {!open && collapsedPreview && !isRenderProp ? (
        <div className="w-full px-2 pb-3">{collapsedPreview}</div>
      ) : null}

      {isRenderProp ? (
        <motion.div
          layout={!shouldReduceMotion}
          transition={
            shouldReduceMotion ? { layout: { duration: 0 } } : LAYOUT_TRANSITION
          }
          className="min-h-0 w-full overflow-hidden"
        >
          {dynamicBody != null ? (
            <div className="w-full px-2 pb-3">{dynamicBody}</div>
          ) : null}
        </motion.div>
      ) : (
        <AnimatePresence initial={false}>
          {open ? (
            <motion.div
              key="static-content"
              initial={{
                opacity: 0,
                transform: shouldReduceMotion
                  ? 'translateY(0px)'
                  : 'translateY(-8px)',
              }}
              animate={{ opacity: 1, transform: 'translateY(0px)' }}
              exit={{
                opacity: 0,
                transform: shouldReduceMotion
                  ? 'translateY(0px)'
                  : 'translateY(-4px)',
                transition: {
                  duration: shouldReduceMotion ? 0.14 : 0.125,
                  ease: REVEAL_EASE,
                },
              }}
              transition={{ duration: 0.16, ease: REVEAL_EASE }}
              className="overflow-hidden"
            >
              <div className="w-full px-2 pb-3">{children as ReactNode}</div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      )}
    </div>
  );
}
