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

/** Shared leading icon background for Space and Skills overview metrics. */
export default function OverviewIconFrame({
  children,
  emphasis = 'default',
}: {
  children: ReactNode;
  emphasis?: 'subtle' | 'default';
}) {
  return (
    <div
      aria-hidden
      className={cn(
        'flex size-ds-48 shrink-0 items-center justify-center rounded-ds-field border border-x border-y border-solid border-ds-hairline-subtle-default text-ds-ink-default-default',
        emphasis === 'subtle'
          ? 'bg-ds-neutral-subtle-default'
          : 'bg-ds-neutral-default-default'
      )}
    >
      {children}
    </div>
  );
}
