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
  /** When true, only the current mode is shown (no switching). Used in session chat input. */
  readOnly?: boolean;
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
  readOnly = false,
}: WorkspaceSessionModeToggleProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const singleRef = useRef<HTMLButtonElement>(null);
  const workforceRef = useRef<HTMLButtonElement>(null);

  const [hoverSegment, setHoverSegment] = useState<Segment | null>(null);
  const [highlight, setHighlight] = useState({ left: 0, width: 0 });

  const targetSegment = hoverSegment ?? segmentFromMode(value);

  const labelSingle = t('layout.workspace-session-single-agent', {
    defaultValue: 'Single Agent',
  });
  const labelWorkforce = t('layout.workspace-session-workforce', {
    defaultValue: 'Workforce',
  });

  const modeAriaLabel = t('layout.workspace-session-mode-label', {
    defaultValue: 'Session mode',
  });

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

  if (readOnly) {
    const isSingle = value === SessionMode.SINGLE_AGENT;
    return (
      <div
        role="status"
        aria-label={modeAriaLabel}
        className={cn(
          'rounded-xl px-2 py-1 pointer-events-none inline-flex items-center',
          isSingle
            ? 'bg-ds-bg-single-agent-subtle-selected text-ds-text-single-agent-default-default'
            : 'bg-ds-bg-workforce-subtle-selected text-ds-text-workforce-default-default',
          className
        )}
      >
        <span className="!text-label-xs font-semibold inline-flex items-center">
          {isSingle ? labelSingle : labelWorkforce}
        </span>
      </div>
    );
  }

  const cardOver = (segment: Segment) => targetSegment === segment;

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-label={modeAriaLabel}
      className={cn(
        'bg-ds-bg-neutral-subtle-default rounded-xl ring-ds-ring-neutral-default-default relative inline-flex items-stretch ring-1 ring-offset-2',
        className
      )}
      onMouseLeave={() => setHoverSegment(null)}
    >
      <motion.div
        aria-hidden
        className={cn(
          'inset-y-0 rounded-xl pointer-events-none absolute z-0 transition-colors duration-150',
          targetSegment === 'single'
            ? 'bg-ds-bg-single-agent-subtle-selected'
            : 'bg-ds-bg-workforce-subtle-selected'
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
          'rounded-xl px-2 py-1 relative z-10 border-0 bg-transparent',
          '!text-label-xs font-semibold transition-colors duration-150',
          cardOver('single')
            ? 'text-ds-text-single-agent-default-default'
            : 'text-ds-text-neutral-muted-default'
        )}
        onMouseEnter={() => setHoverSegment('single')}
        onClick={() => onValueChange(SessionMode.SINGLE_AGENT)}
      >
        <motion.span
          className="inline-flex origin-center items-center will-change-transform"
          whileTap={{ scale: 1.05 }}
          transition={LABEL_TAP_TRANSITION}
        >
          {labelSingle}
        </motion.span>
      </button>
      <button
        ref={workforceRef}
        type="button"
        role="radio"
        aria-checked={value === SessionMode.WORKFORCE}
        className={cn(
          'rounded-xl px-2 py-1 relative z-10 border-0 bg-transparent',
          '!text-label-xs font-semibold transition-colors duration-150',
          cardOver('workforce')
            ? 'text-ds-text-workforce-default-default'
            : 'text-ds-text-neutral-muted-default'
        )}
        onMouseEnter={() => setHoverSegment('workforce')}
        onClick={() => onValueChange(SessionMode.WORKFORCE)}
      >
        <motion.span
          className="inline-flex origin-center items-center will-change-transform"
          whileTap={{ scale: 1.05 }}
          transition={LABEL_TAP_TRANSITION}
        >
          {labelWorkforce}
        </motion.span>
      </button>
    </div>
  );
}
