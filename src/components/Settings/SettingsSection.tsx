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
  title?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  variant?: 'vertical' | 'horizontal';
  titleVariant?: 'default' | 'hidden';
  className?: string;
  boxClassName?: string;
}

export default function SettingsSection({
  title,
  children,
  action,
  variant = 'vertical',
  titleVariant = 'default',
  className,
  boxClassName,
}: SettingsSectionProps) {
  const showTitle = titleVariant === 'default' && title != null;

  return (
    <section className={cn('flex w-full flex-col', className)}>
      {showTitle ? (
        <div className="mb-2 flex min-h-6 items-center justify-between gap-4">
          <span className="m-0 ml-4 text-body-sm font-bold text-ds-text-neutral-default-default">
            {title}
          </span>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      <div
        className={cn(
          'flex rounded-2xl border border-solid border-ds-border-neutral-muted-default p-4',
          variant === 'horizontal' ? 'flex-row' : 'flex-col',
          boxClassName
        )}
      >
        {children}
      </div>
    </section>
  );
}
