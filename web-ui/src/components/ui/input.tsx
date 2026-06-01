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
import * as React from 'react';

export type InputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'size'
> & {
  size?: 'default' | 'sm';
  note?: string;
  state?: 'default' | 'error' | 'success' | 'disabled';
  leadingIcon?: React.ReactNode;
};

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      note,
      state = 'default',
      size = 'default',
      leadingIcon,
      disabled,
      ...props
    },
    ref
  ) => (
    <div className="w-full">
      <div className="relative">
        {leadingIcon ? (
          <span className="pointer-events-none absolute left-3 top-1/2 flex -translate-y-1/2 items-center">
            {leadingIcon}
          </span>
        ) : null}
        <input
          ref={ref}
          disabled={disabled}
          className={cn(
            'w-full rounded-xl border border-solid bg-ds-bg-neutral-subtle-default px-3 text-body-sm text-ds-text-neutral-default-default outline-none transition-colors placeholder:text-ds-text-neutral-muted-default focus:border-ds-border-brand-default-focus focus:ring-1 focus:ring-ds-ring-brand-default-focus disabled:cursor-not-allowed disabled:opacity-60',
            size === 'sm' ? 'h-9' : 'h-10',
            leadingIcon && 'pl-9',
            state === 'error' && 'border-ds-border-error-default-default',
            state === 'success' && 'border-ds-border-success-default-default',
            className
          )}
          {...props}
        />
      </div>
      {note ? (
        <p className="mt-1 text-body-xs text-ds-text-neutral-muted-default">
          {note}
        </p>
      ) : null}
    </div>
  )
);
Input.displayName = 'Input';

export { Input };
