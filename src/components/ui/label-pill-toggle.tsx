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

export interface LabelPillToggleOption<T extends string = string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

export interface LabelPillToggleProps<T extends string = string> {
  value: T;
  options: readonly LabelPillToggleOption<T>[];
  onValueChange: (value: T) => void;
  /** Unique id for the sliding thumb when multiple pills mount. */
  layoutId?: string;
  className?: string;
  /** Width/padding for each option. Defaults to a fixed cell just wider than “Workspace Profile”. */
  itemClassName?: string;
  /** Accessible name for the radiogroup. */
  'aria-label'?: string;
}

/**
 * Labeled segmented control with a sliding pill thumb — the text counterpart
 * to {@link IconPillToggle}.
 */
export function LabelPillToggle<T extends string>({
  value,
  options,
  onValueChange,
  layoutId = 'label-pill-toggle',
  className,
  itemClassName,
  'aria-label': ariaLabel,
}: LabelPillToggleProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full border-0 bg-ds-bg-neutral-strong-default p-0.5 shadow-none ring-0',
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
              'relative z-0 flex h-7 w-[10.5rem] items-center justify-center gap-1.5 rounded-full px-2 outline-none transition-colors',
              'focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ds-ring-neutral-subtle-default',
              selected
                ? 'text-ds-text-neutral-default-default'
                : 'text-ds-text-neutral-muted-default hover:text-ds-text-neutral-default-default',
              itemClassName
            )}
          >
            {selected ? (
              <motion.span
                layoutId={`${layoutId}-thumb`}
                className="absolute inset-0 rounded-full bg-ds-bg-neutral-subtle-default shadow-sm"
                transition={{
                  type: 'spring',
                  stiffness: 420,
                  damping: 32,
                  mass: 0.4,
                }}
                aria-hidden
              />
            ) : null}
            {Icon ? (
              <Icon
                className="relative z-10 h-3.5 w-3.5 shrink-0"
                aria-hidden
              />
            ) : null}
            <span className="relative z-10 truncate !text-body-sm font-semibold">
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
