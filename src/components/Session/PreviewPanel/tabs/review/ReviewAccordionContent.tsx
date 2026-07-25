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

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

const FOLD_EASE: [number, number, number, number] = [0.32, 0.72, 0, 1];
const FOLD_TRANSITION = {
  height: { duration: 0.24, ease: FOLD_EASE },
  opacity: { duration: 0.15, ease: FOLD_EASE },
  y: { duration: 0.2, ease: FOLD_EASE },
} as const;
const REDUCED_FOLD_TRANSITION = { duration: 0 } as const;

/**
 * Clips review content against the file header while it unfolds. Keeping this
 * wrapper outside Monaco makes the motion local to the accordion and lets an
 * interrupted fold resume from its current rendered height.
 */
export function ReviewAccordionContent({
  open,
  id,
  children,
}: {
  open: boolean;
  id: string;
  children: ReactNode;
}) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          id={id}
          key="diff-content"
          initial={
            shouldReduceMotion
              ? { height: 0 }
              : { height: 0, opacity: 0, y: -6 }
          }
          animate={{ height: 'auto', opacity: 1, y: 0 }}
          exit={
            shouldReduceMotion
              ? { height: 0 }
              : { height: 0, opacity: 0, y: -4 }
          }
          transition={
            shouldReduceMotion ? REDUCED_FOLD_TRANSITION : FOLD_TRANSITION
          }
          className="w-full overflow-hidden"
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
