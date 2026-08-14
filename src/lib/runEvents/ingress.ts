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

import { normalizeEvent, type CanonicalProjectEvent } from '@/lib/projector';
import { RunDomainEventHub, runDomainEventHub } from './eventHub';
import { RunProjectionStore, runProjectionStore } from './projectionStore';
import {
  categoryForRunEvent,
  type RunDomainEvent,
  type RunEventDeliveryMode,
  type RunEventOrigin,
} from './types';

const REDACTED_KEY =
  /(?:authorization|cookie|password|secret|token|api[_-]?key)/i;

function safeHubValue(value: unknown, depth = 0): unknown {
  if (depth >= 6) return '[TRUNCATED]';
  if (typeof value === 'string') {
    return value.length > 4096 ? `${value.slice(0, 4096)}…` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => safeHubValue(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 200)
        .map(([key, item]) => [
          key,
          REDACTED_KEY.test(key) ? '[REDACTED]' : safeHubValue(item, depth + 1),
        ])
    );
  }
  return value;
}

function originFromRaw(
  raw: unknown,
  deliveryMode: RunEventDeliveryMode
): RunEventOrigin {
  if (deliveryMode === 'cloud_restore') return 'cloud_restore';
  if (raw && typeof raw === 'object') {
    const origin = (raw as Record<string, unknown>).origin;
    if (origin === 'cloud_restore' || origin === 'remote') return origin;
  }
  return 'local';
}

export class RunEventIngress {
  private lastGapReason: string | null = null;

  constructor(
    readonly projectId: string,
    readonly runId: string,
    private readonly store: RunProjectionStore = runProjectionStore,
    private readonly hub: RunDomainEventHub = runDomainEventHub
  ) {}

  ingest(
    raw: unknown,
    deliveryMode: RunEventDeliveryMode = 'live'
  ): { applied: boolean; gapDetected: boolean } {
    const canonical = normalizeEvent(raw);
    this.assertScope(canonical);
    const event: RunDomainEvent = {
      ...canonical,
      schemaVersion: 1,
      deliveryMode,
      origin: originFromRaw(raw, deliveryMode),
      category: categoryForRunEvent(canonical.eventType),
    };
    const result = this.store.apply(event);
    if (result.applied) {
      this.lastGapReason = null;
      // Store first, Hub second: listeners can synchronously query the state
      // produced by this exact event.
      this.hub.publish({
        ...event,
        payload: safeHubValue(event.payload) as Record<string, unknown>,
        raw: undefined,
      });
    } else if (result.gapDetected) {
      const reason = result.next.resyncReason || 'unknown_gap';
      if (reason !== this.lastGapReason) {
        this.lastGapReason = reason;
        this.hub.publish({
          ...event,
          eventId: `sync-gap:${event.eventId}:${reason}`,
          eventType: 'run.sync.gap_detected',
          category: 'sync',
          payload: { reason, blocked_event_id: event.eventId },
          raw: undefined,
        });
      }
    }
    return { applied: result.applied, gapDetected: result.gapDetected };
  }

  private assertScope(event: CanonicalProjectEvent): void {
    if (event.projectId !== this.projectId || event.runId !== this.runId) {
      throw new Error(
        `Run event scope mismatch: expected ${this.projectId}/${this.runId}, received ${event.projectId}/${event.runId}`
      );
    }
  }
}
