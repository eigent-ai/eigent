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

import { itemFadeMotion } from '@/components/ui/motion';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

export type ConfigCardRingStatus = 'idle' | 'configuring' | 'success' | 'error';

const RING_INSET = '-1px';

const BORDER_COLOR: Record<Exclude<ConfigCardRingStatus, 'idle'>, string> = {
  configuring: 'var(--ds-hairline-subtle-disabled)',
  success: 'var(--ds-border-success-default-default)',
  error: 'var(--ds-border-error-default-default)',
};

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

  const ringMotion = itemFadeMotion(!!shouldReduceMotion);
  const ringColor = status === 'idle' ? undefined : BORDER_COLOR[status];

  return (
    <div className={cn('relative w-full', className)}>
      <AnimatePresence>
        {showRing && (
          <motion.div
            key="config-card-ring"
            className="pointer-events-none absolute z-0 rounded-2xl border-2 border-x-2 border-y-2 border-solid"
            style={{ inset: RING_INSET, borderColor: ringColor }}
            aria-hidden="true"
            {...ringMotion}
          />
        )}
      </AnimatePresence>
      <div className="relative z-[1] flex w-full flex-col rounded-2xl bg-ds-neutral-subtle-default">
        {children}
      </div>
    </div>
  );
}
