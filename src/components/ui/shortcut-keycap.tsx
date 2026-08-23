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
import type { ComponentPropsWithoutRef } from 'react';

export interface ShortcutKeycapProps extends ComponentPropsWithoutRef<'kbd'> {
  appearance?: 'button' | 'keycap';
  size?: 'compact' | 'default';
}

/** Shared shortcut text, optionally presented as a compact filled keycap. */
export function ShortcutKeycap({
  appearance = 'keycap',
  className,
  size = 'default',
  ...props
}: ShortcutKeycapProps) {
  return (
    <kbd
      className={cn(
        'inline-flex shrink-0 items-center justify-center self-center rounded-md border-0 border-x-0 border-y-0 bg-ds-neutral-strong-default px-1 font-sans font-medium text-ds-ink-muted-default ring-1 ring-ds-hairline-default-default ring-offset-0',
        size === 'compact'
          ? 'h-4 min-w-4 text-ds-text-meta leading-none'
          : 'h-5 min-w-5 text-ds-text-meta leading-none',
        appearance === 'button' &&
          'rounded-full bg-ds-accent-subtle-default !text-ds-text-meta text-ds-accent-default-default opacity-60 ring-ds-hairline-muted-default',
        className
      )}
      {...props}
    />
  );
}
