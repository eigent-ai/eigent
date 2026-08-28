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
import type { ReactNode } from 'react';

interface SettingsSectionProps {
  id?: string;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  variant?: 'vertical' | 'horizontal';
  titleVariant?: 'default' | 'hidden';
  className?: string;
  boxClassName?: string;
}

export default function SettingsSection({
  id,
  title,
  description,
  children,
  action,
  variant = 'vertical',
  titleVariant = 'default',
  className,
  boxClassName,
}: SettingsSectionProps) {
  const showTitle = titleVariant === 'default' && title != null;

  return (
    <section id={id} className={cn('flex w-full flex-col', className)}>
      {showTitle ? (
        <div className="mb-2 grid min-h-6 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 px-4">
          <span className="m-0 block min-w-0 text-ds-text-base font-bold text-ds-ink-default-default">
            {title}
          </span>
          {action ? (
            <div className="col-start-2 row-span-2 row-start-1 shrink-0">
              {action}
            </div>
          ) : null}
          {description ? (
            <span className="col-start-1 mt-0.5 block text-ds-text-meta text-ds-ink-muted-default">
              {description}
            </span>
          ) : null}
        </div>
      ) : null}
      <div
        className={cn(
          // Borderless: the section reads as a filled panel against the
          // subtle content-pane background instead of an outlined card.
          'flex rounded-2xl border-0 border-x-0 border-y-0 bg-ds-neutral-default-default p-4',
          variant === 'horizontal' ? 'flex-row' : 'flex-col',
          boxClassName
        )}
      >
        {children}
      </div>
    </section>
  );
}
