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
import type { SessionModeType } from '@/types/constants';
import { SessionMode } from '@/types/constants';
import { motion } from 'framer-motion';
import { User, Users } from 'lucide-react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Segment = 'single' | 'workforce';

function segmentFromMode(mode: SessionModeType): Segment {
  return mode === SessionMode.SINGLE_AGENT ? 'single' : 'workforce';
}

export interface WorkspaceSessionModeToggleProps {
  value: SessionModeType;
  onValueChange: (mode: SessionModeType) => void;
  className?: string;
}

const SLIDE_TRANSITION = {
  type: 'spring' as const,
  stiffness: 520,
  damping: 38,
  mass: 0.35,
};

const LABEL_TAP_TRANSITION = {
  type: 'spring' as const,
  stiffness: 600,
  damping: 32,
  mass: 0.4,
};

/** Sliding “card” highlight follows hover; rests on the selected mode when pointer leaves. */
export function WorkspaceSessionModeToggle({
  value,
  onValueChange,
  className,
}: WorkspaceSessionModeToggleProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const singleRef = useRef<HTMLButtonElement>(null);
  const workforceRef = useRef<HTMLButtonElement>(null);

  const [hoverSegment, setHoverSegment] = useState<Segment | null>(null);
  const [highlight, setHighlight] = useState({ left: 0, width: 0 });

  const targetSegment = hoverSegment ?? segmentFromMode(value);

  const measure = useCallback((segment: Segment) => {
    const container = containerRef.current;
    const el = segment === 'single' ? singleRef.current : workforceRef.current;
    if (!container || !el) return;
    const c = container.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    setHighlight({ left: e.left - c.left, width: e.width });
  }, []);

  useLayoutEffect(() => {
    measure(targetSegment);
  }, [measure, targetSegment, t]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const remeasure = () => measure(hoverSegment ?? segmentFromMode(value));
    const ro = new ResizeObserver(remeasure);
    ro.observe(container);
    window.addEventListener('resize', remeasure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', remeasure);
    };
  }, [hoverSegment, measure, value]);

  const labelSingle = t('layout.workspace-session-single-agent', {
    defaultValue: 'Single Agent',
  });
  const labelWorkforce = t('layout.workspace-session-workforce', {
    defaultValue: 'Workforce',
  });

  const cardOver = (segment: Segment) => targetSegment === segment;

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-label={t('layout.workspace-session-mode-label', {
        defaultValue: 'Session mode',
      })}
      className={cn('min-h-8 relative inline-flex items-stretch', className)}
      onMouseLeave={() => setHoverSegment(null)}
    >
      <motion.div
        aria-hidden
        className={cn(
          'inset-y-0 pointer-events-none absolute z-0',
          'rounded-t-xl border-border-secondary/60 bg-surface-tertiary shadow-sm border'
        )}
        initial={false}
        animate={{
          left: highlight.left,
          width: highlight.width,
        }}
        transition={SLIDE_TRANSITION}
      />

      <button
        ref={singleRef}
        type="button"
        role="radio"
        aria-checked={value === SessionMode.SINGLE_AGENT}
        className={cn(
          'min-h-8 rounded-t-xl px-3 py-1.5 relative z-10 border-0 bg-transparent',
          '!text-label-sm font-medium transition-colors duration-150',
          cardOver('single')
            ? 'text-session-single-agent'
            : 'text-text-secondary'
        )}
        onMouseEnter={() => setHoverSegment('single')}
        onClick={() => onValueChange(SessionMode.SINGLE_AGENT)}
      >
        <motion.span
          className="gap-1.5 inline-flex origin-center items-center will-change-transform"
          whileTap={{ scale: 1.05 }}
          transition={LABEL_TAP_TRANSITION}
        >
          <User
            className="h-3.5 w-3.5 shrink-0 opacity-90"
            strokeWidth={2}
            aria-hidden
          />
          {labelSingle}
        </motion.span>
      </button>
      <button
        ref={workforceRef}
        type="button"
        role="radio"
        aria-checked={value === SessionMode.WORKFORCE}
        className={cn(
          'min-h-8 rounded-t-xl px-3 py-1.5 relative z-10 border-0 bg-transparent',
          '!text-label-sm font-medium transition-colors duration-150',
          cardOver('workforce')
            ? 'text-session-workforce'
            : 'text-text-secondary'
        )}
        onMouseEnter={() => setHoverSegment('workforce')}
        onClick={() => onValueChange(SessionMode.WORKFORCE)}
      >
        <motion.span
          className="gap-1.5 inline-flex origin-center items-center will-change-transform"
          whileTap={{ scale: 1.05 }}
          transition={LABEL_TAP_TRANSITION}
        >
          <Users
            className="h-3.5 w-3.5 shrink-0 opacity-90"
            strokeWidth={2}
            aria-hidden
          />
          {labelWorkforce}
        </motion.span>
      </button>
    </div>
  );
}
