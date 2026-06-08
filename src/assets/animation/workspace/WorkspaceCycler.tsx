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

'use client';

import { useEffect, useRef } from 'react';

// Each mode holds for 4.5 seconds before switching
const HOLD_MS = 4500;
const ROOT_MARGIN = '200px';

/**
 * Drives the workspace landing animation by alternating between
 * "single" and "workforce" modes every 4.5 seconds.
 *
 * Only mutates data-* attributes — no React re-renders, no textContent.
 * CSS selectors handle all visual changes (show/hide heading variants,
 * show/hide agent row variants, fade-in animation restart).
 *
 *   [data-cycle-root].dataset.mode  → "single" | "workforce"
 *   [data-cycle-root].dataset.anim  → "a" | "b"  (restarts CSS fade)
 */
export default function WorkspaceCycler() {
  const anchorRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const root = anchor.closest<HTMLElement>('[data-cycle-root]');
    if (!root) return;

    const MODES = ['single', 'workforce'] as const;
    let modeIdx = 0; // start at single
    let timer: ReturnType<typeof setTimeout> | null = null;
    let isVisible = true;
    let isTabVisible = !document.hidden;

    const applyMode = (idx: number) => {
      root.dataset.mode = MODES[idx];
      // Alternate a↔b to restart the CSS keyframe fade each cycle
      root.dataset.anim = root.dataset.anim === 'a' ? 'b' : 'a';
    };

    const tick = () => {
      if (!isVisible || !isTabVisible) {
        timer = setTimeout(tick, HOLD_MS);
        return;
      }
      modeIdx = (modeIdx + 1) % MODES.length;
      applyMode(modeIdx);
      timer = setTimeout(tick, HOLD_MS);
    };

    // Sync to SSR default (single mode, anim=a to prime the first fade)
    applyMode(0);

    let idleHandle: number | null = null;
    let idleTimeout: ReturnType<typeof setTimeout> | null = null;
    const start = () => {
      timer = setTimeout(tick, HOLD_MS);
    };
    if (typeof window.requestIdleCallback === 'function') {
      idleHandle = window.requestIdleCallback(start, { timeout: 2500 });
    } else {
      idleTimeout = setTimeout(start, 500);
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry.isIntersecting;
      },
      { rootMargin: ROOT_MARGIN }
    );
    io.observe(root);

    const onVisibility = () => {
      isTabVisible = !document.hidden;
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (timer !== null) clearTimeout(timer);
      if (
        idleHandle !== null &&
        typeof window.cancelIdleCallback === 'function'
      ) {
        window.cancelIdleCallback(idleHandle);
      }
      if (idleTimeout !== null) clearTimeout(idleTimeout);
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <span ref={anchorRef} aria-hidden="true" style={{ display: 'none' }} />
  );
}
