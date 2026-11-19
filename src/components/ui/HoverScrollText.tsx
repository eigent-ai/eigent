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
import { useLayoutEffect, useRef, useState } from 'react';

/** Horizontal drift speed (~px/s) — readable marquee, not a snap. Matches TaskList task query. */
const HOVER_SCROLL_PX_PER_SEC = 16;
const HOVER_SCROLL_MIN_MS = 10_000;
const HOVER_SCROLL_MAX_MS = 90_000;

function hoverScrollDurationMs(scrollPx: number): number {
  if (scrollPx <= 0) return 300;
  const proportional = (scrollPx / HOVER_SCROLL_PX_PER_SEC) * 1000;
  return Math.min(
    HOVER_SCROLL_MAX_MS,
    Math.max(HOVER_SCROLL_MIN_MS, Math.round(proportional))
  );
}

export interface HoverScrollTextProps {
  text: string;
  /** When true (e.g. row hovered), scroll to show overflow in one linear pass. */
  active: boolean;
  className?: string;
  innerClassName?: string;
}

/**
 * Single-line text that overflows hidden; on `active`, translates to reveal the rest
 * (same behavior as task query labels in ChatBox ChatTimeline).
 */
export function HoverScrollText({
  text,
  active,
  className,
  innerClassName,
}: HoverScrollTextProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const [scrollPx, setScrollPx] = useState(0);

  useLayoutEffect(() => {
    if (!outerRef.current || !innerRef.current) return;

    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const o = outerRef.current;
      const i = innerRef.current;
      if (!o || !i) return;
      setScrollPx(Math.max(0, i.scrollWidth - o.clientWidth));
    };

    measure();
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(measure);
    });
    const ro = new ResizeObserver(measure);
    ro.observe(outerRef.current);
    ro.observe(innerRef.current);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      ro.disconnect();
    };
  }, [text, active]);

  const slide = active && scrollPx > 0;
  const slideMs = hoverScrollDurationMs(scrollPx);

  return (
    <div
      ref={outerRef}
      className={cn('min-w-0 w-full overflow-hidden', className)}
    >
      <span
        ref={innerRef}
        title={text}
        className={cn(
          'inline-block whitespace-nowrap',
          'transition-[transform]',
          slide ? 'ease-linear' : 'ease-out duration-300',
          innerClassName
        )}
        style={{
          transform: slide ? `translateX(-${scrollPx}px)` : 'translateX(0)',
          transitionDuration: slide ? `${slideMs}ms` : undefined,
        }}
      >
        {text}
      </span>
    </div>
  );
}
