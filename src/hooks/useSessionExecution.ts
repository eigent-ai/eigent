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

import { getAccountEnvironmentKey } from '@/lib/authEnvironment';
import { useAuthStore } from '@/store/authStore';
import {
  getSessionExecutionState,
  observeSessionExecution,
  subscribeSessionExecution,
} from '@/store/sessionExecutionStore';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

export function useSessionExecution(projectId: string | null | undefined) {
  const accountKey = useAuthStore(getAccountEnvironmentKey);
  const scope = useMemo(
    () => ({ projectId: projectId || '', accountKey }),
    [projectId, accountKey]
  );
  const subscribe = useCallback(
    (listener: () => void) => subscribeSessionExecution(scope, listener),
    [scope]
  );
  const snapshot = useCallback(() => getSessionExecutionState(scope), [scope]);
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(
    () => (projectId ? observeSessionExecution(scope) : undefined),
    [projectId, scope]
  );
  return { scope, state };
}
