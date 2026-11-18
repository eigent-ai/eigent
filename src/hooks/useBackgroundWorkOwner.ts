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

import { getSessionWindowRole } from '@/lib/sessionWindows';
import { useEffect, useState } from 'react';

export const BACKGROUND_WORK_LOCK = 'eigent-background-work';

const locksSupported = () =>
  typeof navigator !== 'undefined' &&
  typeof navigator.locks?.request === 'function';

/**
 * Queued follow-ups, scheduled automations, trigger executions and the Remote
 * Control bridge are still started from a renderer. Exactly one renderer may
 * run them, or every extra window would start the same work again.
 *
 * Session windows never run them. Among main windows (one on desktop, possibly
 * several browser tabs on the web) the holder of a Web Lock does; when it
 * closes, the lock passes to the next tab.
 */
export function useIsBackgroundWorkOwner(): boolean {
  const isMain = getSessionWindowRole() === 'main';
  const [owner, setOwner] = useState(() => isMain && !locksSupported());

  useEffect(() => {
    if (!isMain || !locksSupported()) return;
    const controller = new AbortController();
    let release: (() => void) | null = null;
    navigator.locks
      .request(
        BACKGROUND_WORK_LOCK,
        { signal: controller.signal },
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
            setOwner(true);
          })
      )
      .catch(() => {
        // Aborted while waiting: another window still owns the work. Any other
        // failure (for example a page origin without Web Locks) must not stop
        // background work, so this main window runs it as it did before.
        if (!controller.signal.aborted) setOwner(true);
      });
    return () => {
      controller.abort();
      release?.();
      setOwner(false);
    };
  }, [isMain]);

  return owner;
}
