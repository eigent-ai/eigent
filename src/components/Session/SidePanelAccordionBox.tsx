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
  /** Compact content rendered below the header when the accordion is collapsed. */
  collapsedPreview?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl bg-ds-bg-neutral-default-default border-ds-border-neutral-subtle-disabled ease-in-out min-w-0 z-10 flex shrink-0 flex-col overflow-hidden border border-solid transition-all duration-200">
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
            'text-ds-text-neutral-muted-default h-4 w-4 shrink-0 transition-transform duration-200',
            open ? 'rotate-0' : '-rotate-90'
          )}
          aria-hidden
        />
      </button>

      {!open && collapsedPreview ? (
        <div className="px-3 pb-3 w-full">{collapsedPreview}</div>
      ) : null}

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 w-full">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
