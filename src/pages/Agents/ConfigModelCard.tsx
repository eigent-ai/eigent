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
import type { ReactNode } from 'react';

export type ConfigCardRingStatus = 'idle' | 'configuring' | 'success' | 'error';

const RING_OFFSET_REST_PX = 1;
const RING_OFFSET_BOUNCE_PX = 3;

const BORDER_COLOR: Record<Exclude<ConfigCardRingStatus, 'idle'>, string> = {
  configuring: 'var(--ds-border-neutral-subtle-disabled)',
  success: 'var(--ds-border-success-default-default)',
  error: 'var(--ds-border-error-default-default)',
};

function ringInset(px: number): string {
  return `${-px}px`;
}

const CONFIGURING_TRANSITION = {
  inset: {
    duration: 1.2,
    repeat: Infinity,
    ease: 'easeInOut' as const,
  },
  borderColor: { duration: 0.3, ease: 'easeOut' as const },
  opacity: { duration: 0.2 },
};

const SUCCESS_TRANSITION = {
  inset: { duration: 0.5, ease: [0.4, 0, 0.2, 1] as const },
  borderColor: { duration: 0.5, ease: [0.4, 0, 0.2, 1] as const },
  opacity: { duration: 0.2 },
};

const ERROR_TRANSITION = {
  inset: { duration: 0.4, ease: [0.4, 0, 0.2, 1] as const },
  borderColor: { duration: 0.4, ease: [0.4, 0, 0.2, 1] as const },
  opacity: { duration: 1, ease: 'easeInOut' as const },
};

function getRingMotionProps(status: Exclude<ConfigCardRingStatus, 'idle'>) {
  switch (status) {
    case 'configuring':
      return {
        animate: {
          inset: [
            ringInset(RING_OFFSET_REST_PX),
            ringInset(RING_OFFSET_BOUNCE_PX),
            ringInset(RING_OFFSET_REST_PX),
          ],
          borderColor: BORDER_COLOR.configuring,
          opacity: 1,
        },
        transition: CONFIGURING_TRANSITION,
      };
    case 'success':
      return {
        animate: {
          inset: ringInset(RING_OFFSET_REST_PX),
          borderColor: BORDER_COLOR.success,
          opacity: 1,
        },
        transition: SUCCESS_TRANSITION,
      };
    case 'error':
      return {
        animate: {
          inset: ringInset(RING_OFFSET_REST_PX),
          borderColor: BORDER_COLOR.error,
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
  const showRing = status !== 'idle';

  const ringMotion = showRing ? getRingMotionProps(status) : null;

  return (
    <div className={cn('relative w-full', className)}>
      <AnimatePresence>
        {ringMotion && (
          <motion.div
            key="config-card-ring"
            className="pointer-events-none absolute z-0 rounded-2xl border-2 border-solid"
            initial={{
              inset: ringInset(RING_OFFSET_REST_PX),
              borderColor: BORDER_COLOR.configuring,
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
