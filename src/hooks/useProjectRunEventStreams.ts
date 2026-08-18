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

import type { SSETransportOptions } from '@/api/http';
import {
  ProjectRunEventStreamOwner,
  type ProjectRunEventStreamOwnerOptions,
} from '@/service/projectRunEventStream';
import {
  getProjectEventStore,
  type ProjectEventStoreSnapshot,
} from '@/store/projectEventStore';
import { useEffect, useRef } from 'react';

type EventStreamTransport = (options: SSETransportOptions) => Promise<void>;

export type UseProjectRunEventStreamsOptions = {
  projectId: string | null | undefined;
  snapshot: ProjectEventStoreSnapshot | null;
  enabled?: boolean;
  maxStreams?: number;
  reconnectDelayMs?: number;
  /** Test/host seam; production uses the shared authenticated SSE transport. */
  transport?: EventStreamTransport;
};

/**
 * React lifecycle owner for the temporary canonical companion stream.
 * ChatBox can pass the same snapshot it already reads with useSyncExternalStore.
 */
export function useProjectRunEventStreams({
  projectId,
  snapshot,
  enabled = true,
  maxStreams,
  reconnectDelayMs,
  transport,
}: UseProjectRunEventStreamsOptions): void {
  const ownerRef = useRef<ProjectRunEventStreamOwner | null>(null);

  useEffect(() => {
    if (!enabled || !projectId) {
      ownerRef.current?.dispose();
      ownerRef.current = null;
      return;
    }

    const options: ProjectRunEventStreamOwnerOptions = {
      projectId,
      store: getProjectEventStore(projectId),
      maxStreams,
      reconnectDelayMs,
      transport,
    };
    const owner = new ProjectRunEventStreamOwner(options);
    ownerRef.current = owner;

    return () => {
      if (ownerRef.current === owner) ownerRef.current = null;
      owner.dispose();
    };
  }, [enabled, maxStreams, projectId, reconnectDelayMs, transport]);

  // `projectId`/`enabled` are dependencies even though they are unused here:
  // they are what construct a new owner above, and effects run in declaration
  // order within one commit. Without them a freshly created owner would be fed
  // only when the snapshot reference happened to change too, so a Project
  // switch that reuses a snapshot reference would open no streams at all until
  // the next unrelated store publish.
  useEffect(() => {
    if (snapshot) ownerRef.current?.updateSnapshot(snapshot);
  }, [snapshot, projectId, enabled]);
}
