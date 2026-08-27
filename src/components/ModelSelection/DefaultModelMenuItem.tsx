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

import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

interface DefaultModelMenuItemProps extends Omit<
  ComponentProps<typeof DropdownMenuItem>,
  'children'
> {
  configured: boolean;
  selected: boolean;
  statusLabel: string;
  children: ReactNode;
}

export function DefaultModelMenuItem({
  configured,
  selected,
  statusLabel,
  children,
  className,
  ...props
}: DefaultModelMenuItemProps) {
  return (
    <DropdownMenuItem
      role="menuitemradio"
      aria-checked={selected}
      className={cn(
        'h-ds-control-md min-h-ds-control-md gap-2 py-0',
        className
      )}
      {...props}
    >
      <span className="flex size-ds-icon-lg shrink-0 items-center justify-center">
        <span
          role="img"
          aria-label={statusLabel}
          className={cn(
            'size-2 rounded-full',
            configured
              ? 'bg-ds-text-success-default-default'
              : 'bg-ds-text-neutral-subtle-default opacity-10'
          )}
        />
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-ds-text-base',
          configured
            ? 'text-ds-ink-default-default'
            : 'text-ds-ink-subtle-default'
        )}
      >
        {children}
      </span>
      <span className="ml-auto flex size-ds-icon-md shrink-0 items-center justify-center">
        {selected ? (
          <Check
            className="size-ds-icon-md text-ds-ink-default-default"
            aria-hidden
          />
        ) : null}
      </span>
    </DropdownMenuItem>
  );
}
