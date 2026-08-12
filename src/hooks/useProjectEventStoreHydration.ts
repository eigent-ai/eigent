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
  hydrateProjectEventStore,
  ProjectEventStoreHydrationError,
} from '@/service/projectEventStoreHydration';
import { getProjectEventStore } from '@/store/projectEventStore';
import { useEffect, useState } from 'react';

const RETRY_DELAY_MS = 1_000;

export type UseProjectEventStoreHydrationOptions = {
  projectId: string | null | undefined;
  enabled: boolean;
};

export type ProjectEventStoreHydrationState = {
  status: 'idle' | 'loading' | 'retrying' | 'ready' | 'error';
  errorCode: ProjectEventStoreHydrationError['code'] | 'request_failed' | null;
  eventsTruncated: boolean;
};

function isAbortError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'name' in error &&
    error.name === 'AbortError'
  );
}

function isNonRetryable(
  error: unknown
): error is ProjectEventStoreHydrationError {
  return (
    error instanceof ProjectEventStoreHydrationError &&
    (error.code === 'invalid_response' || error.code === 'limit_exceeded')
  );
}

/**
 * Own one authoritative initial snapshot per fresh store and later fail-closed
 * rebuilds. Live-only projection does not mark that checkpoint complete. The
 * hook is mounted only for the feature-flagged ChatBox path and reuses its
 * existing SSE ingest owner; it never opens another live connection.
 */
export function useProjectEventStoreHydration({
  projectId,
  enabled,
}: UseProjectEventStoreHydrationOptions): ProjectEventStoreHydrationState {
  const [hydrationState, setHydrationState] =
    useState<ProjectEventStoreHydrationState>({
      status: 'idle',
      errorCode: null,
      eventsTruncated: false,
    });

  useEffect(() => {
    if (!enabled || !projectId) {
      setHydrationState({
        status: 'idle',
        errorCode: null,
        eventsTruncated: false,
      });
      return;
    }

    const store = getProjectEventStore(projectId);
    const controller = new AbortController();
    let mounted = true;
    let running = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let blockedByContract = false;

    const needsHydration = () => {
      const snapshot = store.getSnapshot();
      return (
        !snapshot.hasHydratedSnapshot ||
        snapshot.overflowed ||
        snapshot.view.needsResync
      );
    };

    const scheduleRetry = () => {
      if (!mounted || retryTimer || blockedByContract) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        requestHydration();
      }, RETRY_DELAY_MS);
    };

    const requestHydration = () => {
      if (!mounted || running || blockedByContract || !needsHydration()) {
        return;
      }
      running = true;
      setHydrationState({
        status: 'loading',
        errorCode: null,
        eventsTruncated: false,
      });
      void hydrateProjectEventStore({
        projectId,
        signal: controller.signal,
        store,
      })
        .then((result) => {
          if (mounted) {
            setHydrationState({
              status: 'ready',
              errorCode: null,
              eventsTruncated: result.eventsTruncated,
            });
          }
        })
        .catch((error: unknown) => {
          if (!mounted || isAbortError(error)) return;
          if (isNonRetryable(error)) {
            blockedByContract = true;
            setHydrationState({
              status: 'error',
              errorCode: error.code,
              eventsTruncated: false,
            });
          } else {
            setHydrationState({
              status: 'retrying',
              errorCode:
                error instanceof ProjectEventStoreHydrationError
                  ? error.code
                  : 'request_failed',
              eventsTruncated: false,
            });
            scheduleRetry();
          }
          if (import.meta.env.DEV) {
            console.warn('[ProjectEventStore] Hydration failed', error);
          }
        })
        .finally(() => {
          running = false;
        });
    };

    const unsubscribe = store.subscribe(requestHydration);
    if (!needsHydration()) {
      setHydrationState({
        status: 'ready',
        errorCode: null,
        eventsTruncated: store.getSnapshot().view.eventsTruncated,
      });
    }
    requestHydration();

    return () => {
      mounted = false;
      controller.abort();
      unsubscribe();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [enabled, projectId]);

  return hydrationState;
}
