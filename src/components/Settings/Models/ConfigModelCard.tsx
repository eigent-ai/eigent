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
import type { ReactNode } from 'react';

export type ConfigCardRingStatus = 'idle' | 'configuring' | 'success' | 'error';

const RING_INSET = '-1px';

const BORDER_COLOR: Record<Exclude<ConfigCardRingStatus, 'idle'>, string> = {
  configuring: 'var(--ds-border-neutral-subtle-disabled)',
  success: 'var(--ds-border-success-default-default)',
  error: 'var(--ds-border-error-default-default)',
};

const CONFIGURING_TRANSITION = {
  transform: {
    duration: 1.2,
    repeat: Infinity,
    ease: 'linear' as const,
  },
  opacity: {
    duration: 1.2,
    repeat: Infinity,
    ease: 'linear' as const,
  },
};

const SUCCESS_TRANSITION = {
  duration: 0.24,
  ease: [0.23, 1, 0.32, 1] as const,
};

const ERROR_TRANSITION = {
  duration: 0.28,
  ease: [0.23, 1, 0.32, 1] as const,
};

function getRingMotionProps(status: Exclude<ConfigCardRingStatus, 'idle'>) {
  switch (status) {
    case 'configuring':
      return {
        animate: {
          transform: ['scale(1)', 'scale(1.01)', 'scale(1)'],
          opacity: [0.7, 1, 0.7],
        },
        transition: CONFIGURING_TRANSITION,
      };
    case 'success':
      return {
        animate: {
          transform: 'scale(1)',
          opacity: 1,
        },
        transition: SUCCESS_TRANSITION,
      };
    case 'error':
      return {
        animate: {
          transform: ['scale(1)', 'scale(1.01)', 'scale(1)'],
          opacity: [1, 0.2, 1],
        },
        transition: ERROR_TRANSITION,
      };
  }
}

export function ConfigModelCard({
  status,
  children,
  className,
}: {
  status: ConfigCardRingStatus;
  children: ReactNode;
  className?: string;
}) {
  const shouldReduceMotion = useReducedMotion();
  const showRing = status !== 'idle';

  const ringMotion = showRing
    ? shouldReduceMotion
      ? {
          animate: { transform: 'scale(1)', opacity: 1 },
          transition: { duration: 0.2, ease: [0.23, 1, 0.32, 1] as const },
        }
      : getRingMotionProps(status)
    : null;
  const ringColor = status === 'idle' ? undefined : BORDER_COLOR[status];

  return (
    <div className={cn('relative w-full', className)}>
      <AnimatePresence>
        {ringMotion && (
          <motion.div
            key="config-card-ring"
            className="pointer-events-none absolute z-0 rounded-2xl border-2 border-solid"
            style={{ inset: RING_INSET, borderColor: ringColor }}
            initial={{
              transform: 'scale(1)',
              opacity: 0,
            }}
            animate={ringMotion.animate}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            transition={ringMotion.transition}
          />
        )}
      </AnimatePresence>
      <div className="relative z-[1] flex w-full flex-col rounded-2xl bg-ds-bg-neutral-subtle-default">
        {children}
      </div>
    </div>
  );
}
