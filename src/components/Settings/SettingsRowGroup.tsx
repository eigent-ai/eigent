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
import { Children, Fragment, type HTMLAttributes, type ReactNode } from 'react';

interface SettingsRowGroupProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function SettingsRowGroup({
  children,
  className,
  ...props
}: SettingsRowGroupProps) {
  const rows = Children.toArray(children);

  return (
    <div
      {...props}
      data-settings-row-group
      className={cn(
        'overflow-hidden rounded-2xl bg-ds-neutral-default-default',
        className
      )}
    >
      {rows.map((row, index) => (
        <Fragment key={index}>
          {index > 0 ? (
            <div
              data-settings-row-divider
              aria-hidden
              className="mx-4 border-x-0 border-t border-b-0 border-solid border-ds-hairline-subtle-default"
            />
          ) : null}
          {row}
        </Fragment>
      ))}
    </div>
  );
}

interface SettingsRowProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  actionClassName?: string;
}

export function SettingsRow({
  title,
  description,
  action,
  children,
  actionClassName,
}: SettingsRowProps) {
  return (
    <div data-settings-row className="flex flex-col gap-4 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-ds-text-base font-semibold text-ds-ink-default-default">
            {title}
          </div>
          {description ? (
            <div className="mt-1 text-ds-text-base text-ds-ink-muted-default">
              {description}
            </div>
          ) : null}
        </div>
        {action ? (
          <div
            data-settings-row-action
            className={cn(
              'flex max-w-full shrink-0 items-center justify-end',
              actionClassName
            )}
          >
            {action}
          </div>
        ) : null}
      </div>
      {children ? <div className="w-full">{children}</div> : null}
    </div>
  );
}
