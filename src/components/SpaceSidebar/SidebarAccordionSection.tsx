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
import { motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { type ReactNode, useState } from 'react';

export interface SidebarAccordionSectionProps {
  label: string;
  children: ReactNode;
  defaultExpanded?: boolean;
  className?: string;
}

/**
 * Collapsible sidebar section with a label header.
 * Chevron is always visible when collapsed; only visible on hover when expanded.
 */
export function SidebarAccordionSection({
  label,
  children,
  defaultExpanded = true,
  className,
}: SidebarAccordionSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className={cn('mt-3 flex flex-col', className)}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="group/section-header flex w-full items-center gap-1 rounded-lg px-3 py-0.5 text-left"
        aria-expanded={expanded}
      >
        <span className="text-ds-text-base font-normal text-ds-ink-subtle-default">
          {label}
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 !text-ds-ink-muted-default transition-[opacity,transform] duration-200',
            !expanded && '-rotate-90',
            expanded && 'opacity-0 group-hover/section-header:opacity-100'
          )}
          aria-hidden
        />
      </button>

      <motion.div
        initial={false}
        animate={{ height: expanded ? 'auto' : 0 }}
        transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
        style={{ overflow: 'hidden' }}
      >
        <div className="flex flex-col gap-0.5 pt-0.5">{children}</div>
      </motion.div>
    </div>
  );
}
