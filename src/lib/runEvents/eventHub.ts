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
// Licensed under the Apache License, Version 2.0 (the "License");

import type {
  RunDomainEvent,
  RunDomainEventFilter,
  RunDomainEventListener,
} from './types';

type Subscription = {
  id: number;
  filter: RunDomainEventFilter;
  listener: RunDomainEventListener;
};

function includes<T>(
  values: ReadonlySet<T> | readonly T[] | undefined,
  value: T
): boolean {
  if (!values) return true;
  return Array.isArray(values)
    ? values.includes(value)
    : (values as ReadonlySet<T>).has(value);
}

function matches(filter: RunDomainEventFilter, event: RunDomainEvent): boolean {
  return (
    (!filter.projectId || filter.projectId === event.projectId) &&
    (!filter.runId || filter.runId === event.runId) &&
    includes(filter.eventTypes, event.eventType) &&
    includes(filter.categories, event.category) &&
    includes(filter.deliveryModes, event.deliveryMode)
  );
}

/**
 * Renderer-only fan-out for canonical Run events.
 *
 * It deliberately owns no network connection and stores no history. Listener
 * failures are isolated because a toast/analytics adapter must never affect a
 * Run or another UI consumer.
 */
export class RunDomainEventHub {
  private nextId = 1;
  private readonly subscriptions = new Map<number, Subscription>();

  subscribe(
    filter: RunDomainEventFilter,
    listener: RunDomainEventListener
  ): () => void {
    const id = this.nextId++;
    this.subscriptions.set(id, { id, filter, listener });
    return () => {
      this.subscriptions.delete(id);
    };
  }

  publish(event: RunDomainEvent): void {
    for (const subscription of [...this.subscriptions.values()]) {
      if (!matches(subscription.filter, event)) continue;
      try {
        subscription.listener(event);
      } catch (error) {
        console.error('[RunDomainEventHub] listener failed', error);
      }
    }
  }

  listenerCount(): number {
    return this.subscriptions.size;
  }

  clear(): void {
    this.subscriptions.clear();
  }
}

export const runDomainEventHub = new RunDomainEventHub();
