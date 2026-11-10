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
  assertExecutionScope,
  fetchSessionExecutionRoute,
  fetchSessionExecutions,
  SessionExecutionError,
  type ExecutionScope,
  type SessionExecutionRequest,
  type SessionExecutionRoute,
} from '@/service/executionApi';
import { useAuthStore } from '@/store/authStore';

export interface SessionExecutionState {
  route: SessionExecutionRoute | null;
  managed: boolean;
  loading: boolean;
  error: unknown;
  requests: SessionExecutionRequest[];
  nextCursor: number | null;
  revision: string;
}

const EMPTY: SessionExecutionState = {
  route: null,
  managed: false,
  loading: true,
  error: null,
  requests: [],
  nextCursor: null,
  revision: '',
};
interface Entry {
  state: SessionExecutionState;
  listeners: Set<() => void>;
  readers: number;
  pages: number;
  stop?: () => void;
  refresh?: () => void;
}
const entries = new Map<string, Entry>();
const key = (scope: ExecutionScope) =>
  JSON.stringify([scope.accountKey, scope.projectId]);
function entry(scope: ExecutionScope): Entry {
  const id = key(scope);
  let value = entries.get(id);
  if (!value) {
    value = { state: EMPTY, listeners: new Set(), readers: 0, pages: 1 };
    entries.set(id, value);
  }
  return value;
}
function publish(owner: Entry, update: Partial<SessionExecutionState>) {
  owner.state = { ...owner.state, ...update };
  owner.listeners.forEach((listener) => listener());
}
export const getSessionExecutionState = (scope: ExecutionScope) =>
  entry(scope).state;
export const subscribeSessionExecution = (
  scope: ExecutionScope,
  listener: () => void
) => {
  const owner = entry(scope);
  owner.listeners.add(listener);
  return () => {
    owner.listeners.delete(listener);
  };
};
export function selectManagedSession(scope: ExecutionScope) {
  assertExecutionScope(scope);
  publish(entry(scope), { managed: true });
}

export async function requireLegacyExecution(
  scope: ExecutionScope
): Promise<void> {
  if (entry(scope).state.managed)
    throw new SessionExecutionError('managed_execution_required');
  const route = await readSessionExecutionRoute(scope);
  if (route.route !== 'legacy')
    throw new SessionExecutionError('managed_execution_required');
}

export async function readSessionExecutionRoute(
  scope: ExecutionScope
): Promise<SessionExecutionRoute> {
  const route = await fetchSessionExecutionRoute(scope);
  const owner = entry(scope);
  if (owner.state.managed && route.route !== 'managed')
    throw new SessionExecutionError('managed_execution_required');
  publish(owner, {
    route,
    managed: owner.state.managed || route.route === 'managed',
    loading: false,
    error: null,
  });
  return route;
}

export const refreshSessionExecution = (scope: ExecutionScope) =>
  entry(scope).refresh?.();

/** Mounted readers only observe. Neither this owner nor its timers admit work. */
export function observeSessionExecution(scope: ExecutionScope): () => void {
  const owner = entry(scope);
  owner.readers += 1;
  if (!owner.stop) {
    let alive = true;
    let running = false;
    let rerun = false;
    let failures = 0;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      if (!alive) return;
      if (running) {
        rerun = true;
        return;
      }
      clearTimeout(timer);
      running = true;
      controller = new AbortController();
      const deadline = setTimeout(() => controller?.abort(), 5000);
      const captured = { ...scope, signal: controller.signal };
      try {
        const route = await fetchSessionExecutionRoute(captured);
        if (!alive) return;
        if (owner.state.managed && route.route !== 'managed')
          throw new SessionExecutionError('managed_execution_required');
        const managed = owner.state.managed || route.route === 'managed';
        publish(owner, { route, managed });
        if (route.route === 'managed') {
          let page = await fetchSessionExecutions(
            captured,
            route.request_cursor
          );
          const items = [...page.items];
          for (
            let index = 1;
            index < owner.pages && page.next_cursor !== null;
            index += 1
          ) {
            page = await fetchSessionExecutions(captured, page.next_cursor);
            items.push(...page.items);
          }
          if (!alive) return;
          publish(owner, {
            requests: items,
            nextCursor: page.next_cursor,
            revision: JSON.stringify(
              items.map((request) => [
                request.request_id,
                request.admitted_run_id,
                request.run_status,
                request.settlement,
                request.cancel_requested,
              ])
            ),
          });
        }
        failures = 0;
        publish(owner, { loading: false, error: null });
      } catch (error) {
        if (
          alive &&
          scope.accountKey === getAccountEnvironmentKey(useAuthStore.getState())
        ) {
          failures += 1;
          publish(owner, { loading: false, error });
        }
      } finally {
        clearTimeout(deadline);
        running = false;
        if (
          alive &&
          (rerun || failures || owner.state.managed || !owner.state.route)
        ) {
          const busy = owner.state.requests.some(
            (request) =>
              request.status !== 'cancelled' && request.settlement !== 'settled'
          );
          timer = setTimeout(
            () => {
              void refresh();
            },
            rerun
              ? 0
              : Math.min(
                  8000,
                  failures ? 500 * 2 ** failures : busy ? 500 : 2000
                )
          );
          rerun = false;
        }
      }
    };
    const unsubscribe = useAuthStore.subscribe((auth) => {
      if (scope.accountKey !== getAccountEnvironmentKey(auth)) owner.stop?.();
    });
    owner.stop = () => {
      alive = false;
      clearTimeout(timer);
      controller?.abort();
      unsubscribe();
      owner.stop = undefined;
      owner.refresh = undefined;
    };
    owner.refresh = () => {
      void refresh();
    };
    void refresh();
  }
  return () => {
    owner.readers -= 1;
    if (owner.readers === 0) owner.stop?.();
  };
}

export async function loadMoreSessionExecutions(
  scope: ExecutionScope
): Promise<void> {
  const owner = entry(scope);
  const cursor = owner.state.nextCursor;
  if (cursor === null) return;
  const page = await fetchSessionExecutions(scope, cursor);
  if (owner.state.nextCursor !== cursor) return;
  const rows = new Map(
    owner.state.requests.map((request) => [request.request_id, request])
  );
  page.items.forEach((request) => rows.set(request.request_id, request));
  // Refresh only the pages the reader explicitly requested. Capping this count
  // silently discarded later pages on the next refresh. Each page remains
  // bounded and the whole refresh shares the five-second abort deadline.
  owner.pages += 1;
  publish(owner, {
    requests: [...rows.values()].sort((a, b) => a.queue_seq - b.queue_seq),
    nextCursor: page.next_cursor,
  });
}

export function resetSessionExecutionStore(): void {
  entries.forEach((owner) => owner.stop?.());
  entries.clear();
}
