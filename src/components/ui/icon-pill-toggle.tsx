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
import type { LucideIcon } from 'lucide-react';

export interface IconPillToggleOption<T extends string = string> {
  value: T;
  label: string;
  icon: LucideIcon;
}

export interface IconPillToggleProps<T extends string = string> {
  value: T;
  options: readonly IconPillToggleOption<T>[];
  onValueChange: (value: T) => void;
  /** Unique id for the sliding thumb when multiple pills mount. */
  layoutId?: string;
  className?: string;
  /** Accessible name for the radiogroup. */
  'aria-label'?: string;
}

/**
 * Compact icon segmented control with a sliding pill thumb.
 * Pass `className="w-full"` for a full-width track; options share space evenly.
 */
export function IconPillToggle<T extends string>({
  value,
  options,
  onValueChange,
  layoutId = 'icon-pill-toggle',
  className,
  'aria-label': ariaLabel,
}: IconPillToggleProps<T>) {
  const fullWidth =
    typeof className === 'string' && /\bw-full\b/.test(className);

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-lg border-0 border-x-0 border-y-0 bg-ds-neutral-strong-default p-0.5 shadow-none ring-0',
        fullWidth && 'flex w-full',
        className
      )}
    >
      {options.map((option) => {
        const selected = value === option.value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.label}
            title={option.label}
            onClick={() => onValueChange(option.value)}
            className={cn(
              'relative z-0 flex h-7 items-center justify-center rounded-lg transition-colors outline-none',
              fullWidth ? 'min-w-0 flex-1' : 'w-7',
              'focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ds-hairline-subtle-default',
              selected
                ? 'text-ds-ink-default-default'
                : 'text-ds-ink-muted-default hover:text-ds-ink-default-default'
            )}
          >
            {selected ? (
              <motion.span
                layoutId={`${layoutId}-thumb`}
                className="absolute inset-0 rounded-lg bg-ds-neutral-subtle-default shadow-sm"
                transition={{
                  type: 'spring',
                  stiffness: 420,
                  damping: 32,
                  mass: 0.4,
                }}
                aria-hidden
              />
            ) : null}
            <Icon className="relative z-10 h-3.5 w-3.5" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
