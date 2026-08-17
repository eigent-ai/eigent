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
import type { Trigger } from '@/types';
import { useCallback, useEffect, useState } from 'react';

export function useHomeHubTriggers() {
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [loading, setLoading] = useState(true);

  const reloadTriggers = useCallback(async () => {
    setLoading(true);
    try {
      const response = await proxyFetchTriggers(undefined, undefined, 1, 100);
      setTriggers(response?.items ?? response ?? []);
    } catch (error) {
      console.error('Failed to load triggers:', error);
      setTriggers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadTriggers();
  }, [reloadTriggers]);

  return {
    triggers,
    triggersLoading: loading,
    reloadTriggers,
  };
}
