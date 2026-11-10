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

export interface SidebarScrollAreaProps {
  children: ReactNode;
  className?: string;
  /** Pass `navigation` when the region is a menu. */
  role?: 'navigation';
  ariaLabel?: string;
}

/**
 * Scrolling region for app-sidebar content. It extends into the rail's right
 * padding, which is as wide as the scrollbar track, and always reserves that
 * track there. Rows keep the same inset on both sides whether or not the
 * content overflows, and never shift when the scrollbar appears.
 */
export function SidebarScrollArea({
  children,
  className,
  role,
  ariaLabel,
}: SidebarScrollAreaProps) {
  return (
    <div
      role={role}
      aria-label={ariaLabel}
      data-sidebar-scroll-area
      className={cn(
        'scrollbar-always-visible -mr-ds-8 flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto',
        className
      )}
    >
      {children}
    </div>
  );
}
