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

type UnknownEventReason =
  | 'unsupported-event'
  | 'missing-renderer'
  | 'renderer-error';

interface UnknownEventFallbackProps {
  node: unknown;
  reason?: UnknownEventReason;
}

const MAX_EVENT_LABEL_LENGTH = 120;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function safeLabel(value: unknown): string | null {
  if (!['string', 'number', 'boolean'].includes(typeof value)) {
    return null;
  }

  const label = String(value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim();
  if (!label) return null;

  return label.length > MAX_EVENT_LABEL_LENGTH
    ? `${label.slice(0, MAX_EVENT_LABEL_LENGTH)}…`
    : label;
}

function eventLabel(node: unknown): string {
  if (!isRecord(node)) return 'Unknown event';

  return (
    safeLabel(node.eventType) ??
    safeLabel(node.kind) ??
    safeLabel(node.legacyStep) ??
    'Unknown event'
  );
}

/**
 * A deliberately small fallback for events that the current frontend does not
 * understand. Raw payloads are never rendered because they may be large or
 * contain backend-only diagnostic data.
 */
export function UnknownEventFallback({
  node,
  reason = 'unsupported-event',
}: UnknownEventFallbackProps) {
  return (
    <section
      aria-label="Unsupported chat event"
      className="rounded-xl border border-ds-border-neutral-subtle-default bg-ds-bg-neutral-subtle-default px-4 py-3"
      data-event-fallback={reason}
      role="status"
    >
      <p className="m-0 text-body-sm font-medium text-ds-text-neutral-default-default">
        This event is not available in this version.
      </p>
      <p className="m-0 mt-1 truncate text-label-xs text-ds-text-neutral-muted-default">
        {eventLabel(node)}
      </p>
    </section>
  );
}

export type { UnknownEventFallbackProps, UnknownEventReason };
