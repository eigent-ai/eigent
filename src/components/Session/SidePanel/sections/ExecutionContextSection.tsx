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

import { SidePanelAccordionBox } from '@/components/Session/SidePanel/components/AccordionBox';
import {
  CategoryLabel,
  SidePanelListRow,
} from '@/components/Session/SidePanel/sections/primitives';
import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { useMemo } from 'react';

export type ContextCategory = 'skill' | 'connector' | 'file';

export interface ContextItem {
  id: string;
  label: string;
  icon?: ReactNode;
  iconUrl?: string;
  category: ContextCategory;
  onClick?: () => void;
}

const CATEGORY_ORDER: ContextCategory[] = ['skill', 'connector', 'file'];
const CATEGORY_LABEL: Record<ContextCategory, string> = {
  skill: 'Skills',
  connector: 'MCP Tools',
  file: 'Referenced Files',
};

interface ExecutionContextSectionProps {
  title: string;
  items: ContextItem[];
}

export function ExecutionContextSection({
  title,
  items,
}: ExecutionContextSectionProps) {
  const grouped = useMemo(() => {
    const map = new Map<ContextCategory, ContextItem[]>();
    for (const item of items) {
      if (!map.has(item.category)) map.set(item.category, []);
      map.get(item.category)!.push(item);
    }
    return CATEGORY_ORDER.filter((c) => map.has(c)).map((c) => ({
      category: c,
      items: map.get(c)!,
    }));
  }, [items]);

  return (
    <SidePanelAccordionBox title={title}>
      {items.length === 0 ? (
        <div className="px-1 py-1 text-body-sm text-ds-text-neutral-subtle-default opacity-60">
          Track skills, MCPs and referenced files used in this task.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {grouped.map(({ category, items: groupItems }) => (
            <div key={category} className="flex flex-col">
              <CategoryLabel>{CATEGORY_LABEL[category]}</CategoryLabel>
              <motion.ul layout className="m-0 list-none space-y-0.5 p-0">
                <AnimatePresence initial={false}>
                  {groupItems.map((item) => (
                    <motion.li
                      key={item.id}
                      layout
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.2, ease: 'easeOut' }}
                    >
                      <SidePanelListRow
                        leading={item.icon}
                        onClick={item.onClick}
                        interactiveHover
                      >
                        {item.label}
                      </SidePanelListRow>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </motion.ul>
            </div>
          ))}
        </div>
      )}
    </SidePanelAccordionBox>
  );
}
