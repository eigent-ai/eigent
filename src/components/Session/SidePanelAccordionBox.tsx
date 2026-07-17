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
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { type ReactNode, useState } from 'react';

const CONTENT_EASE: [number, number, number, number] = [0.32, 0.72, 0, 1];
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
  const [open, setOpen] = useState(defaultOpen);
  const isRenderProp = typeof children === 'function';
  const dynamicBody = isRenderProp
    ? (children as (s: SidePanelAccordionRenderArgs) => ReactNode)({ open })
    : null;

  return (
    <div className="rounded-xl bg-ds-bg-neutral-default-default border-ds-border-neutral-subtle-disabled min-w-0 z-10 flex shrink-0 flex-col overflow-hidden border border-solid">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="hover:bg-ds-bg-neutral-default-hover gap-2 px-3 py-2.5 flex w-full shrink-0 items-center justify-between text-left transition-colors"
        aria-expanded={open}
      >
        <div className="gap-2 min-w-0 flex items-center">
          <span className="text-ds-text-neutral-default-default text-body-sm font-semibold">
            {title}
          </span>
          {titleSuffix ? (
            <span className="flex shrink-0 items-center">{titleSuffix}</span>
          ) : null}
        </div>
        <ChevronDown
          className={cn(
            'text-ds-text-neutral-muted-default h-4 w-4 ease-out shrink-0 transition-transform duration-200',
            open ? 'rotate-0' : '-rotate-90'
          )}
          aria-hidden
        />
      </button>

      {!open && collapsedPreview && !isRenderProp ? (
        <div className="px-2 pb-3 w-full">{collapsedPreview}</div>
      ) : null}

      {isRenderProp ? (
        <motion.div
          layout
          transition={LAYOUT_TRANSITION}
          className="min-h-0 w-full overflow-hidden"
        >
          {dynamicBody != null ? (
            <div className="px-2 pb-3 w-full">{dynamicBody}</div>
          ) : null}
        </motion.div>
      ) : (
        <AnimatePresence initial={false}>
          {open ? (
            <motion.div
              key="static-content"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{
                height: { duration: 0.22, ease: CONTENT_EASE },
                opacity: { duration: 0.16, ease: CONTENT_EASE },
              }}
              className="overflow-hidden"
            >
              <div className="px-2 pb-3 w-full">{children as ReactNode}</div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      )}
    </div>
  );
}
