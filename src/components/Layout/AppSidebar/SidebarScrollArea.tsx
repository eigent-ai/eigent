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
import { type ReactNode, useEffect, useRef, useState } from 'react';

export interface SidebarScrollAreaProps {
  children: ReactNode;
  className?: string;
  /** Pass `navigation` when the region is a menu. */
  role?: 'navigation';
  ariaLabel?: string;
}

/**
 * Scrolling region for app-sidebar content. The scrollbar (and the gutter it
 * reserves) only exists while the content actually overflows, so rows keep the
 * rail's full width instead of losing a strip down the right edge.
 */
export function SidebarScrollArea({
  children,
  className,
  role,
  ariaLabel,
}: SidebarScrollAreaProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const checkOverflow = () => {
      setOverflowing(el.scrollHeight > el.clientHeight + 1);
    };

    // Children are observed individually so a row growing — not just the list
    // gaining rows — re-runs the check.
    let resizeObserver = new ResizeObserver(checkOverflow);
    const observeAll = () => {
      resizeObserver.disconnect();
      resizeObserver = new ResizeObserver(checkOverflow);
      resizeObserver.observe(el);
      Array.from(el.children).forEach((child) => resizeObserver.observe(child));
      checkOverflow();
    };

    observeAll();
    const mutationObserver = new MutationObserver(observeAll);
    mutationObserver.observe(el, { childList: true, subtree: true });

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, []);

  return (
    <div
      ref={ref}
      role={role}
      aria-label={ariaLabel}
      data-sidebar-scroll-overflow={overflowing ? 'true' : 'false'}
      className={cn(
        'flex min-h-0 min-w-0 flex-1 flex-col',
        overflowing
          ? 'scrollbar-always-visible overflow-y-auto'
          : 'overflow-hidden',
        className
      )}
    >
      {children}
    </div>
  );
}
