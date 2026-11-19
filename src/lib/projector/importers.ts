import { normalizeEvent } from './normalize';
import type { CanonicalProjectEvent } from './types';

function array(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['items', 'steps', 'messages', 'events']) {
      if (Array.isArray(record[key])) return record[key] as unknown[];
    }
  }
  return [];
}

export function importLegacyChatSteps(value: unknown): CanonicalProjectEvent[] {
  return array(value).map((item) => normalizeEvent(item, 'chat_step_v1'));
}

export function importIndexedDbV1(value: unknown): CanonicalProjectEvent[] {
  return array(value).map((item) => normalizeEvent(item, 'indexeddb_v1'));
}

export function importLocalMemoryV1(value: unknown): CanonicalProjectEvent[] {
  return array(value).map((item) => normalizeEvent(item, 'local_memory_v1'));
}
