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

import { proxyFetchTriggers } from '@/service/triggerApi';
import { useAuthStore } from '@/store/authStore';
import type { Trigger } from '@/types';
import { useCallback, useEffect, useState } from 'react';

/** The last list, so a page that mounts again shows it while it refreshes. */
let triggersSnapshot: { email: string | null; triggers: Trigger[] } | null =
  null;

export function useHomeHubTriggers() {
  const email = useAuthStore((s) => s.email);
  const [triggers, setTriggers] = useState<Trigger[]>(() =>
    triggersSnapshot?.email === (email ?? null) ? triggersSnapshot.triggers : []
  );
  const [loading, setLoading] = useState(
    () => triggersSnapshot?.email !== (email ?? null)
  );

  const reloadTriggers = useCallback(async () => {
    if (triggersSnapshot?.email !== (email ?? null)) setLoading(true);
    try {
      const response = await proxyFetchTriggers(undefined, undefined, 1, 100);
      const items: Trigger[] = response?.items ?? response ?? [];
      triggersSnapshot = { email: email ?? null, triggers: items };
      setTriggers(items);
    } catch (error) {
      console.error('Failed to load triggers:', error);
      setTriggers([]);
    } finally {
      setLoading(false);
    }
  }, [email]);

  useEffect(() => {
    void reloadTriggers();
  }, [reloadTriggers]);

  return {
    triggers,
    triggersLoading: loading,
    reloadTriggers,
  };
}
