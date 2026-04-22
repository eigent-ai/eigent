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
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion';
import {
  ChevronDown,
  ChevronUp,
  GamepadDirectional,
  Joystick,
} from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

const ROLL = {
  initial: { y: 14, opacity: 0 },
  animate: {
    y: 0,
    opacity: 1,
    transition: {
      type: 'spring' as const,
      stiffness: 420,
      damping: 32,
      mass: 0.35,
    },
  },
  exit: {
    y: -14,
    opacity: 0,
    transition: { duration: 0.16, ease: [0.4, 0, 1, 1] as const },
  },
};

const CHEVRON_TAP = {
  type: 'spring' as const,
  stiffness: 520,
  damping: 22,
  mass: 0.35,
};

const CHEVRON_RELEASE = {
  type: 'spring' as const,
  stiffness: 400,
  damping: 28,
  mass: 0.35,
};

export interface WorkspaceSessionModeToggleProps {
  value: SessionModeType;
  onValueChange: (mode: SessionModeType) => void;
  className?: string;
  /** When true, only the current mode is shown (no switching). Used in session chat input. */
  readOnly?: boolean;
}

export function WorkspaceSessionModeToggle({
  value,
  onValueChange,
  className,
  readOnly = false,
}: WorkspaceSessionModeToggleProps) {
  const { t } = useTranslation();
  const chevronScale = useAnimationControls();

  const labelSingle = t('layout.workspace-session-single-agent', {
    defaultValue: 'Single Agent',
  });
  const labelWorkforce = t('layout.workspace-session-workforce', {
    defaultValue: 'Workforce',
  });

  const modeAriaLabel = t('layout.workspace-session-mode-label', {
    defaultValue: 'Session mode',
  });

  const isSingle = value === SessionMode.SINGLE_AGENT;
  const nextMode = isSingle ? SessionMode.WORKFORCE : SessionMode.SINGLE_AGENT;
  const label = isSingle ? labelSingle : labelWorkforce;

  const toggle = () => onValueChange(nextMode);

  const pulseChevrons = useCallback(() => {
    void (async () => {
      await chevronScale.start({ scale: 1.22, transition: CHEVRON_TAP });
      await chevronScale.start({ scale: 1, transition: CHEVRON_RELEASE });
    })();
  }, [chevronScale]);

  const LeadingIcon = isSingle ? Joystick : GamepadDirectional;

  const shellClass = cn(
    'rounded-xl px-2 py-1 inline-flex items-center gap-1.5',
    'bg-ds-bg-neutral-default-default text-ds-text-neutral-default-default [&_svg.lucide]:stroke-2',
    className
  );

  const chevronClass = 'size-3 shrink-0 opacity-80';

  const endChevrons = (
    <span
      className="gap-0 inline-flex shrink-0 flex-col items-center justify-center leading-none"
      aria-hidden
    >
      <ChevronUp className={cn(chevronClass, '-mb-1')} strokeWidth={2} />
      <ChevronDown className={chevronClass} strokeWidth={2} />
    </span>
  );

  if (readOnly) {
    return (
      <div
        role="status"
        aria-label={modeAriaLabel}
        className={cn(shellClass, 'pointer-events-none')}
      >
        <span className="gap-1.5 inline-flex min-h-[1.25rem] items-center overflow-hidden">
          <LeadingIcon
            className="size-3.5 shrink-0"
            strokeWidth={2}
            aria-hidden
          />
          <span className="!text-label-xs font-semibold">{label}</span>
        </span>
      </div>
    );
  }

  const cycleHint = t('layout.workspace-session-mode-cycle-hint', {
    defaultValue: 'Click to switch session mode',
  });

  return (
    <motion.button
      type="button"
      aria-label={`${modeAriaLabel}: ${label}. ${cycleHint}`}
      className={cn(
        shellClass,
        'cursor-pointer border-0 text-left',
        'focus-visible:ring-ds-border-neutral-strong-default focus-visible:ring-offset-ds-bg-neutral-default-default focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none'
      )}
      onPointerDown={pulseChevrons}
      onClick={toggle}
    >
      <span className="min-w-0 relative inline-flex min-h-[1.25rem] flex-1 items-center overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={value}
            className="gap-1.5 inline-flex items-center will-change-transform"
            variants={ROLL}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <LeadingIcon
              className="size-3.5 shrink-0"
              strokeWidth={2}
              aria-hidden
            />
            <span className="!text-label-xs font-semibold whitespace-nowrap">
              {label}
            </span>
          </motion.span>
        </AnimatePresence>
      </span>

      <motion.span
        className="inline-flex origin-center will-change-transform"
        initial={{ scale: 1 }}
        animate={chevronScale}
      >
        {endChevrons}
      </motion.span>
    </motion.button>
  );
}
