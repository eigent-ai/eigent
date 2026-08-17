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
import { Children, Fragment, type ReactNode } from 'react';

export function SettingsRowGroup({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children);

  return (
    <div
      data-settings-row-group
      className="overflow-hidden rounded-2xl bg-ds-bg-neutral-default-default"
    >
      {rows.map((row, index) => (
        <Fragment key={index}>
          {index > 0 ? (
            <div
              data-settings-row-divider
              aria-hidden
              className="mx-4 border-x-0 border-b-0 border-t border-solid border-ds-border-neutral-subtle-default"
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
  description: ReactNode;
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
          <div className="text-body-sm font-semibold text-ds-text-neutral-default-default">
            {title}
          </div>
          <div className="mt-1 text-body-sm text-ds-text-neutral-muted-default">
            {description}
          </div>
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
