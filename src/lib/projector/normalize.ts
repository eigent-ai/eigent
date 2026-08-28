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

import { decodeTransportMessage } from './decode';
import type { CanonicalProjectEvent } from './types';

type SourceVersion = CanonicalProjectEvent['source'];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value ? value : fallback;
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

function optionalCursor(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function timestamp(value: unknown): string {
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(
      value < 10_000_000_000 ? value * 1000 : value
    ).toISOString();
  }
  return new Date(0).toISOString();
}

function eventOrigin(
  value: unknown
): CanonicalProjectEvent['origin'] | undefined {
  return value === 'local' || value === 'cloud_restore' || value === 'remote'
    ? value
    : undefined;
}

export function normalizeEvent(
  raw: unknown,
  source: SourceVersion = 'canonical'
): CanonicalProjectEvent {
  const message = decodeTransportMessage(raw);
  if (source === 'canonical') {
    const payload = record(message.payload);
    const eventId = text(message.event_id);
    const projectId = text(message.project_id);
    const runId = text(message.run_id);
    if (!eventId || !projectId || !runId) {
      throw new Error(
        'Canonical event requires event_id, project_id and run_id'
      );
    }
    return {
      eventId,
      projectId,
      runId,
      runSequence: positiveInteger(message.run_sequence ?? message.sequence, 1),
      runVersion: positiveInteger(message.run_version, 1),
      cloudCursor: optionalCursor(message.cloud_cursor),
      eventType: text(message.event_type, 'legacy.step'),
      payload,
      legacyStep:
        typeof message.legacy_step === 'string' ? message.legacy_step : null,
      createdAt: timestamp(message.created_at),
      source,
      origin: eventOrigin(message.origin),
      raw,
    };
  }

  const legacyData =
    message.data ?? message.content ?? message.payload ?? message;
  const data = record(legacyData);
  const taskId = text(message.task_id, text(message.run_id, 'legacy-run'));
  const projectId = text(message.project_id, taskId);
  const stepId = message.step_id ?? message.id ?? 1;
  const sequence = positiveInteger(stepId, 1);
  const step = text(message.step, 'legacy_unknown');
  return {
    eventId: text(message.event_id, `${source}:${taskId}:${String(stepId)}`),
    projectId,
    runId: taskId,
    runSequence: sequence,
    runVersion: positiveInteger(message.run_version, sequence),
    cloudCursor: optionalCursor(message.cloud_cursor),
    eventType: text(message.event_type, 'legacy.step'),
    payload: {
      ...data,
      __legacy_step_id: stepId,
      __legacy_data: legacyData,
    },
    legacyStep: step,
    createdAt: timestamp(message.timestamp ?? message.created_at),
    source,
    origin: eventOrigin(message.origin),
    raw,
  };
}
