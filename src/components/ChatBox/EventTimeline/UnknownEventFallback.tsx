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

import { useTranslation } from 'react-i18next';

type UnknownEventReason =
  'unsupported-event' | 'missing-renderer' | 'renderer-error';

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

function eventLabel(node: unknown, fallback: string): string {
  if (!isRecord(node)) return fallback;

  return (
    safeLabel(node.eventType) ??
    safeLabel(node.kind) ??
    safeLabel(node.legacyStep) ??
    fallback
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
  const { t } = useTranslation();

  return (
    <section
      aria-label={t('chat.timeline-unsupported-event-label')}
      className="rounded-xl border border-x border-y border-ds-hairline-subtle-default bg-ds-neutral-subtle-default px-4 py-3"
      data-event-fallback={reason}
      role="status"
    >
      <span className="block text-ds-text-base font-medium text-ds-ink-default-default">
        {t('chat.timeline-unsupported-event')}
      </span>
      <span className="mt-1 block truncate text-ds-text-meta font-normal text-ds-ink-muted-default">
        {eventLabel(node, t('chat.timeline-unknown-event'))}
      </span>
    </section>
  );
}

export type { UnknownEventFallbackProps, UnknownEventReason };
