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

import { useAuthStore } from '@/store/authStore';
import { useEffect, useState } from 'react';

/**
 * Waits for the persisted auth store to finish rehydrating from storage.
 * Use this before reading auth state (token, initState, etc.) to avoid
 * temporary redirects or UI flicker when persisted state loads after first render.
 *
 * @returns true once the auth store has been hydrated (sync or async)
 */
export function useAuthHydration(): boolean {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Subscribe first so we don't miss hydration completing between check and subscribe
    const unsubFinish = useAuthStore.persist.onFinishHydration(() => {
      setHydrated(true);
    });
    // Sync check: hydration may already be done (e.g. sync localStorage)
    if (useAuthStore.persist.hasHydrated()) {
      setHydrated(true);
    }
    return () => {
      unsubFinish();
    };
  }, []);

  return hydrated;
}
