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

import { SidePanelAccordionBox } from '@/components/Session/SidePanelAccordionBox';
import {
  CountPill,
  ProgressCircle,
  ProgressConnector,
  SidePanelListRow,
} from '@/components/Session/SidePanelSections/primitives';
import { TaskStatus } from '@/types/constants';
import { AnimatePresence, motion } from 'framer-motion';

function isDone(task: TaskInfo) {
  return task.status === TaskStatus.COMPLETED;
}

interface ProgressSectionProps {
  title: string;
  subtasks: TaskInfo[];
}

export function ProgressSection({ title, subtasks }: ProgressSectionProps) {
  const count = subtasks.length;

  const collapsedStrip =
    count > 0 ? (
      <div className="gap-1 min-w-0 mx-1 flex items-center overflow-hidden">
        <AnimatePresence initial={false}>
          {subtasks.map((task, idx) => (
            <motion.span
              key={task.id}
              layout
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="gap-1 min-w-0 flex items-center"
            >
              <ProgressCircle done={isDone(task)} />
              {idx < subtasks.length - 1 ? <ProgressConnector /> : null}
            </motion.span>
          ))}
        </AnimatePresence>
      </div>
    ) : null;

  return (
    <SidePanelAccordionBox
      title={title}
      titleSuffix={count > 0 ? <CountPill count={count} /> : null}
    >
      {({ open }) => {
        if (!open) {
          return collapsedStrip;
        }
        if (count === 0) {
          return (
            <div className="text-ds-text-neutral-subtle-default text-body-sm px-1 py-1">
              No subtasks yet
            </div>
          );
        }
        return (
          <motion.ul layout className="p-0 m-0 space-y-0.5 list-none">
            <AnimatePresence initial={false}>
              {subtasks.map((task) => (
                <motion.li
                  key={task.id}
                  layout
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                >
                  <SidePanelListRow
                    className="hover:bg-ds-bg-neutral-subtle-default cursor-pointer"
                    leading={<ProgressCircle done={isDone(task)} />}
                  >
                    {task.content}
                  </SidePanelListRow>
                </motion.li>
              ))}
            </AnimatePresence>
          </motion.ul>
        );
      }}
    </SidePanelAccordionBox>
  );
}
