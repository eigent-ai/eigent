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
import { useCallback, useEffect, useState } from 'react';

const RETRY_DELAY_MS = 1_000;
/**
 * Ceiling for exponential retry backoff. A retryable failure that never clears
 * (backend down) otherwise re-fetched the whole Project snapshot every second.
 */
const MAX_RETRY_DELAY_MS = 30_000;

export type UseProjectEventStoreHydrationOptions = {
  projectId: string | null | undefined;
  enabled: boolean;
};

export type ProjectEventStoreHydrationState = {
  status: 'idle' | 'loading' | 'retrying' | 'ready' | 'error';
  errorCode:
    | ProjectEventStoreHydrationError['code']
    | 'request_failed'
    | 'unsupported'
    | null;
  eventsTruncated: boolean;
  /**
   * Starts a fresh attempt, including after a non-retryable failure that has
   * disabled automatic backoff. Safe to call while an attempt is running.
   */
  retry: () => void;
};

function isAbortError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'name' in error &&
    error.name === 'AbortError'
  );
}

function requestStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as {
    status?: unknown;
    response?: { status?: unknown };
  };
  const status = candidate.status ?? candidate.response?.status;
  return typeof status === 'number' && Number.isInteger(status) ? status : null;
}

function nonRetryableErrorCode(
  error: unknown
): ProjectEventStoreHydrationState['errorCode'] {
  if (
    error instanceof ProjectEventStoreHydrationError &&
    (error.code === 'invalid_response' || error.code === 'limit_exceeded')
  ) {
    return error.code;
  }
  // Older/local Brain deployments may not expose the event replay API yet.
  // Retrying an unsupported capability forever cannot make it appear.
  if (requestStatus(error) === 404) return 'unsupported';
  return null;
}

/**
 * Own one authoritative initial snapshot per fresh store and later fail-closed
 * rebuilds. Live-only projection does not mark that checkpoint complete. The
 * shared Project runtime owns this hook and reuses the existing SSE ingest
 * owner; it never opens another live connection.
 */
export function useProjectEventStoreHydration({
  projectId,
  enabled,
}: UseProjectEventStoreHydrationOptions): ProjectEventStoreHydrationState {
  const [retryToken, setRetryToken] = useState(0);
  const [hydrationState, setHydrationState] = useState<
    Omit<ProjectEventStoreHydrationState, 'retry'>
  >({
    status: 'idle',
    errorCode: null,
    eventsTruncated: false,
  });

  const retry = useCallback(() => setRetryToken((token) => token + 1), []);

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
    let blockedIncarnation: number | null = null;
    let consecutiveFailures = 0;

    const isBlockedByContract = () =>
      blockedIncarnation === store.getIncarnation();

    const needsHydration = () => {
      const snapshot = store.getSnapshot();
      return (
        !snapshot.hasHydratedSnapshot ||
        snapshot.overflowed ||
        snapshot.view.needsResync
      );
    };

    const scheduleRetry = () => {
      if (!mounted || retryTimer || isBlockedByContract()) return;
      const delay = Math.min(
        RETRY_DELAY_MS * 2 ** Math.max(0, consecutiveFailures - 1),
        MAX_RETRY_DELAY_MS
      );
      retryTimer = setTimeout(() => {
        retryTimer = null;
        requestHydration();
      }, delay);
    };

    const requestHydration = () => {
      // A pending retry owns the next attempt. Without this the store
      // subscription below could re-enter immediately on any unrelated publish
      // and defeat the backoff entirely.
      if (
        !mounted ||
        running ||
        isBlockedByContract() ||
        retryTimer ||
        !needsHydration()
      ) {
        return;
      }
      const requestIncarnation = store.getIncarnation();
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
          consecutiveFailures = 0;
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
          consecutiveFailures += 1;
          const nonRetryableCode = nonRetryableErrorCode(error);
          if (nonRetryableCode) {
            blockedIncarnation = requestIncarnation;
            setHydrationState({
              status: 'error',
              errorCode: nonRetryableCode,
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
          if (store.getIncarnation() !== requestIncarnation) {
            requestHydration();
          }
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
    // `retryToken` restarts the effect, which clears the non-retryable block
    // and any pending backoff so a manual retry always gets a fresh attempt.
  }, [enabled, projectId, retryToken]);

  return { ...hydrationState, retry };
}
