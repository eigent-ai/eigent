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
      runSequence: positiveInteger(message.run_sequence, 1),
      runVersion: positiveInteger(message.run_version, 1),
      cloudCursor: optionalCursor(message.cloud_cursor),
      eventType: text(message.event_type, 'legacy.step'),
      payload,
      legacyStep:
        typeof message.legacy_step === 'string' ? message.legacy_step : null,
      createdAt: timestamp(message.created_at),
      source,
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
    raw,
  };
}
