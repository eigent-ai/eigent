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
import {
  getResolvedRunModels,
  subscribeResolvedRunModels,
  type ResolvedRunModel,
} from '@/service/projectRunsApi';
import { refreshSessionNavStatuses } from '@/service/sessionNavStatus';
import { useAuthStore } from '@/store/authStore';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

export interface RunActivity {
  runId: string;
  status: string;
  active: boolean;
}

const NO_MODELS: Readonly<Record<string, ResolvedRunModel | null>> =
  Object.freeze({});

/**
 * The model each Run of the open Session ran on. Session hydration fills the
 * map from its Run-list read; a Run that starts, changes state while active,
 * or ends triggers one bounded read of the newest Run so its model appears
 * without reopening the Session.
 */
export function useResolvedRunModels(
  projectId: string | null | undefined,
  runs: readonly RunActivity[]
): Readonly<Record<string, ResolvedRunModel | null>> {
  const subscribe = useCallback(
    (listener: () => void) =>
      projectId
        ? subscribeResolvedRunModels(projectId, listener)
        : () => undefined,
    [projectId]
  );
  const getSnapshot = useCallback(
    () => (projectId ? getResolvedRunModels(projectId) : NO_MODELS),
    [projectId]
  );
  const models = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const accountKey = useAuthStore(getAccountEnvironmentKey);
  const seenRef = useRef(new Map<string, string>());
  const lifetimeRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const lifetime = new AbortController();
    lifetimeRef.current = lifetime;
    seenRef.current = new Map();
    return () => lifetime.abort();
  }, [projectId, accountKey]);

  const activityKey = JSON.stringify(
    runs.map((run) => [run.runId, run.status, run.active])
  );
  useEffect(() => {
    const lifetime = lifetimeRef.current;
    if (!projectId || !lifetime || lifetime.signal.aborted) return;
    const seen = seenRef.current;
    let changed = false;
    for (const [runId, status, active] of JSON.parse(activityKey) as Array<
      [string, string, boolean]
    >) {
      const before = seen.get(runId);
      if (before === undefined ? active : before !== status) changed = true;
      seen.set(runId, status);
    }
    if (!changed) return;
    void refreshSessionNavStatuses(
      [projectId],
      accountKey,
      (candidate) => candidate === projectId,
      lifetime.signal
    );
  }, [projectId, accountKey, activityKey]);

  return models;
}
