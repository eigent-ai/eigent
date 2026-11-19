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

import type { ChatProjectionState } from '@/lib/projector/chat/types';
import {
  selectSessionWorkers,
  type SessionWorker,
} from '@/lib/projector/chat/workerView';
import {
  peekProjectEventStore,
  subscribeProjectEventStores,
} from '@/store/projectEventStore';
import { useEffect, useState } from 'react';

const workersByChat = new WeakMap<ChatProjectionState, SessionWorker[]>();
const NO_WORKERS: SessionWorker[] = [];

/** Workers of a Session whose timeline is loaded in this window. */
export function readSessionWorkers(projectId: string): SessionWorker[] {
  const chat = peekProjectEventStore(projectId)?.getSnapshot().chat;
  if (!chat) return NO_WORKERS;
  let workers = workersByChat.get(chat);
  if (!workers) {
    workers = selectSessionWorkers(
      chat.nodes.filter((node) => node.projectId === projectId)
    );
    workersByChat.set(chat, workers);
  }
  return workers;
}

function readAll(projectIds: readonly string[]) {
  return Object.fromEntries(
    projectIds.map((projectId) => [projectId, readSessionWorkers(projectId)])
  );
}

function sameWorkers(
  a: Record<string, SessionWorker[]>,
  b: Record<string, SessionWorker[]>
) {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => a[key] === b[key])
  );
}

/**
 * Live workers per Session, for Sessions whose timeline is loaded. Sessions
 * that were never opened in this window have no workers yet.
 */
export function useSessionWorkers(
  projectIds: readonly string[]
): Record<string, SessionWorker[]> {
  const idsKey = projectIds.join('\n');
  const [workers, setWorkers] = useState(() => readAll(projectIds));

  useEffect(() => {
    const ids = idsKey ? idsKey.split('\n') : [];
    const storeUnsubscribers = new Map<string, () => void>();
    const refresh = () =>
      setWorkers((previous) => {
        const next = readAll(ids);
        return sameWorkers(previous, next) ? previous : next;
      });
    const bind = (projectId: string) => {
      storeUnsubscribers.get(projectId)?.();
      storeUnsubscribers.delete(projectId);
      const store = peekProjectEventStore(projectId);
      if (store) storeUnsubscribers.set(projectId, store.subscribe(refresh));
    };
    ids.forEach(bind);
    refresh();
    const unsubscribeRegistry = subscribeProjectEventStores((projectId) => {
      if (!ids.includes(projectId)) return;
      bind(projectId);
      refresh();
    });
    return () => {
      unsubscribeRegistry();
      storeUnsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [idsKey]);

  return workers;
}
