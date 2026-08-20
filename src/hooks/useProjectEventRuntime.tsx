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

import {
  useProjectEventStoreHydration,
  type ProjectEventStoreHydrationState,
} from '@/hooks/useProjectEventStoreHydration';
import { useProjectRunEventStreams } from '@/hooks/useProjectRunEventStreams';
import {
  getProjectEventStore,
  type ProjectEventStoreSnapshot,
} from '@/store/projectEventStore';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

const subscribeToNothing = () => () => undefined;
const getNullSnapshot = () => null;
const retryNothing = () => undefined;

const IDLE_HYDRATION: ProjectEventStoreHydrationState = {
  status: 'idle',
  errorCode: null,
  eventsTruncated: false,
  retry: retryNothing,
};

export interface ProjectEventRuntimeValue {
  hydration: ProjectEventStoreHydrationState;
  projectId: string | null;
  snapshot: ProjectEventStoreSnapshot | null;
}

const ProjectEventRuntimeContext = createContext<ProjectEventRuntimeValue>({
  hydration: IDLE_HYDRATION,
  projectId: null,
  snapshot: null,
});

/**
 * Own the durable Project event runtime once for the whole Session shell.
 * ChatBox and SessionSidePanel are read-only consumers of this shared owner.
 */
export function ProjectEventRuntimeProvider({
  children,
  projectId,
}: {
  children: ReactNode;
  projectId: string | null | undefined;
}) {
  const normalizedProjectId = projectId || null;
  const runtimeEnabled = Boolean(normalizedProjectId);
  const store = useMemo(
    () =>
      runtimeEnabled && normalizedProjectId
        ? getProjectEventStore(normalizedProjectId)
        : null,
    [normalizedProjectId, runtimeEnabled]
  );
  const subscribe = useCallback(
    (listener: () => void) =>
      store?.subscribe(listener) ?? subscribeToNothing(),
    [store]
  );
  const getSnapshot = useCallback(() => store?.getSnapshot() ?? null, [store]);
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getNullSnapshot
  );
  const hydration = useProjectEventStoreHydration({
    projectId: normalizedProjectId,
    enabled: runtimeEnabled,
  });

  useProjectRunEventStreams({
    projectId: normalizedProjectId,
    snapshot,
    enabled: runtimeEnabled,
  });

  const value = useMemo<ProjectEventRuntimeValue>(
    () => ({ hydration, projectId: normalizedProjectId, snapshot }),
    [hydration, normalizedProjectId, snapshot]
  );

  return (
    <ProjectEventRuntimeContext.Provider value={value}>
      {children}
    </ProjectEventRuntimeContext.Provider>
  );
}

export function useProjectEventRuntime(): ProjectEventRuntimeValue {
  return useContext(ProjectEventRuntimeContext);
}
