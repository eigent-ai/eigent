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
  loadOlderProjectChatHistory,
  ProjectEventStoreHydrationError,
} from '@/service/projectEventStoreHydration';
import { getProjectEventStore } from '@/store/projectEventStore';
import { useCallback, useEffect, useRef, useState } from 'react';

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
  hasOlderHistory: boolean;
  isLoadingOlder: boolean;
  olderHistoryError: boolean;
  loadOlder: () => Promise<void>;
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
    Pick<
      ProjectEventStoreHydrationState,
      'status' | 'errorCode' | 'eventsTruncated'
    >
  >({
    status: 'idle',
    errorCode: null,
    eventsTruncated: false,
  });
  const olderRequestRef = useRef<AbortController | null>(null);
  const consumedRetryTokenRef = useRef(0);
  const [olderState, setOlderState] = useState({
    projectId,
    loading: false,
    error: false,
  });

  useEffect(() => {
    setOlderState({ projectId, loading: false, error: false });
    return () => {
      olderRequestRef.current?.abort();
      olderRequestRef.current = null;
    };
  }, [projectId, enabled]);

  const loadOlder = useCallback(async () => {
    if (!enabled || !projectId || olderRequestRef.current) return;
    const controller = new AbortController();
    olderRequestRef.current = controller;
    setOlderState({ projectId, loading: true, error: false });
    try {
      const store = getProjectEventStore(projectId);
      // Bounded reads keep live ingestion responsive; they are not a limit on
      // how much of the Session the user can see. Drain every historical page.
      do {
        const previous = store.getSnapshot().history;
        await loadOlderProjectChatHistory({
          projectId,
          signal: controller.signal,
          store,
        });
        if (controller.signal.aborted) return;
        const history = store.getSnapshot().history;
        if (
          !Object.values(history?.beforeByRun ?? {}).some((value) => value > 0)
        )
          break;
        if (
          !Object.entries(previous?.beforeByRun ?? {}).some(
            ([runId, before]) =>
              (history?.beforeByRun[runId] ?? before) < before
          )
        ) {
          throw new ProjectEventStoreHydrationError(
            'Historical replay did not advance',
            'invalid_response'
          );
        }
        // Give paint/input a turn between batches, not only promise microtasks.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      } while (!controller.signal.aborted);
      if (!controller.signal.aborted) {
        setOlderState({ projectId, loading: false, error: false });
        setHydrationState((state) => ({
          ...state,
          eventsTruncated:
            getProjectEventStore(projectId).getSnapshot().view.eventsTruncated,
        }));
      }
    } catch (error) {
      if (!controller.signal.aborted && !isAbortError(error)) {
        // Overflow requires a fresh checkpoint, not another read against the
        // rejected cursor. The hydration owner exposes its explicit retry.
        setOlderState({
          projectId,
          loading: false,
          error: !getProjectEventStore(projectId).getSnapshot().overflowed,
        });
      }
    } finally {
      if (olderRequestRef.current === controller)
        olderRequestRef.current = null;
    }
  }, [enabled, projectId]);

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
    // A retry belongs to this invocation, not to every future Session visit.
    let forceHydration = retryToken !== consumedRetryTokenRef.current;
    consumedRetryTokenRef.current = retryToken;

    const isBlockedByContract = () =>
      blockedIncarnation === store.getIncarnation();

    const needsHydration = () => {
      const snapshot = store.getSnapshot();
      return (
        forceHydration ||
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
      const snapshot = store.getSnapshot();
      if (
        !forceHydration &&
        snapshot.overflowed &&
        store.getControlReplayCursor() &&
        (snapshot.view.resyncReason?.startsWith('frontend_pending_control_') ||
          snapshot.view.resyncReason === 'frontend_control_replay_overflow')
      ) {
        // A successful tail read cannot repair an oversized control prefix.
        // Avoid repeatedly clearing backoff with that same partial snapshot.
        blockedIncarnation = store.getIncarnation();
        setHydrationState({
          status: 'error',
          errorCode: 'limit_exceeded',
          eventsTruncated: true,
        });
        return;
      }
      const requestIncarnation = store.getIncarnation();
      forceHydration = false;
      running = true;
      // A replacement owns a new replay boundary. Cancel the older-page pass
      // so it cannot race the replacement or leave automatic backfill stuck.
      olderRequestRef.current?.abort();
      olderRequestRef.current = null;
      setOlderState({ projectId, loading: false, error: false });
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
          if (mounted && store.getIncarnation() === requestIncarnation) {
            setHydrationState({
              status: 'ready',
              errorCode: null,
              eventsTruncated: result.eventsTruncated,
            });
          }
        })
        .catch((error: unknown) => {
          if (!mounted || isAbortError(error)) return;
          if (store.getIncarnation() !== requestIncarnation) return;
          forceHydration = true;
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
      olderRequestRef.current?.abort();
      olderRequestRef.current = null;
      unsubscribe();
      if (retryTimer) clearTimeout(retryTimer);
    };
    // `retryToken` restarts the effect, which clears the non-retryable block
    // and any pending backoff so a manual retry always gets a fresh attempt.
  }, [enabled, projectId, retryToken]);

  useEffect(() => {
    if (!enabled || !projectId || hydrationState.status !== 'ready') return;
    const snapshot = getProjectEventStore(projectId).getSnapshot();
    if (
      snapshot.hasHydratedSnapshot &&
      (Object.values(snapshot.history?.beforeByRun ?? {}).some(
        (value) => value > 0
      ) ||
        getProjectEventStore(projectId).getControlReplayCursor())
    ) {
      // One automatic pass per successful hydration. A failed page remains
      // visible and manually retryable instead of entering a hot retry loop.
      void loadOlder();
    }
  }, [enabled, projectId, hydrationState.status, loadOlder]);

  const snapshot =
    enabled && projectId
      ? getProjectEventStore(projectId).getSnapshot()
      : undefined;
  const history = snapshot?.history;
  return {
    ...hydrationState,
    eventsTruncated:
      snapshot?.view.eventsTruncated ?? hydrationState.eventsTruncated,
    retry,
    hasOlderHistory:
      Object.values(history?.beforeByRun ?? {}).some((value) => value > 0) ||
      Boolean(
        enabled &&
        projectId &&
        getProjectEventStore(projectId).getControlReplayCursor()
      ),
    isLoadingOlder:
      enabled && olderState.projectId === projectId && olderState.loading,
    olderHistoryError:
      enabled && olderState.projectId === projectId && olderState.error,
    loadOlder,
  };
}
