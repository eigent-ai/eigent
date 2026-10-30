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

import { useEffect, useRef, useState } from 'react';

/**
 * Tracks whether an element's own width has dropped below `threshold` px, using
 * a ResizeObserver so it reacts to container (not viewport) resizes — e.g. side
 * panels opening beside the chat composer. Returns a ref to attach and the
 * current compact flag; state only flips when it crosses the threshold, so it
 * won't re-render on every resize tick.
 */
export function useIsCompactWidth<T extends HTMLElement>(threshold: number) {
  const ref = useRef<T>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const update = (width: number) => setCompact(width < threshold);
    update(el.getBoundingClientRect().width);

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) update(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return [ref, compact] as const;
}
