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

import type { ChatProjectionState } from '@/lib/projector/chat';
import {
  createHumanControlProjectionState,
  type HumanControlProjectionState,
} from '@/lib/projector/control';
import {
  getProjectEventStore,
  type ProjectEventStoreSnapshot,
} from '@/store/projectEventStore';
import { useMemo, useSyncExternalStore } from 'react';

const EMPTY_HUMAN_CONTROL_PROJECTION = createHumanControlProjectionState('');
const subscribeToNothing = () => () => undefined;
const getEmptyHumanControlProjection = () => EMPTY_HUMAN_CONTROL_PROJECTION;

/** Subscribe to one Project projection without coupling components to ChatStore. */
export function useProjectEventView(
  projectId: string
): ProjectEventStoreSnapshot {
  const store = useMemo(() => getProjectEventStore(projectId), [projectId]);
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
}

/** Subscribe only to the semantic ChatBox slice of a Project projection. */
export function useProjectChatProjection(
  projectId: string
): ChatProjectionState {
  const store = useMemo(() => getProjectEventStore(projectId), [projectId]);
  return useSyncExternalStore(
    store.subscribe,
    store.getChatSnapshot,
    store.getChatSnapshot
  );
}

/** Subscribe to BottomBox controls; unresolved requests are never evicted. */
export function useProjectHumanControlProjection(
  projectId: string | null | undefined
): HumanControlProjectionState {
  const store = useMemo(
    () => (projectId ? getProjectEventStore(projectId) : null),
    [projectId]
  );
  return useSyncExternalStore(
    store?.subscribe ?? subscribeToNothing,
    store?.getControlSnapshot ?? getEmptyHumanControlProjection,
    store?.getControlSnapshot ?? getEmptyHumanControlProjection
  );
}
