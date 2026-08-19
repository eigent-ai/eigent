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

import { formatSplittingElapsed } from '@/components/ChatBox/MessageItem/TokenUtils';
import type { TimelineRunView } from '@/lib/projector/chat/presentation';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import {
  CircleAlert,
  CircleCheck,
  CircleSlash,
  Clock3,
  Loader2,
  PauseCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';

export function isActiveRunStatus(status: TimelineRunView['status']): boolean {
  return ['pending', 'running', 'waiting_for_user', 'cancelling'].includes(
    status
  );
}

export function isTerminalRunStatus(
  status: TimelineRunView['status']
): boolean {
  return ['completed', 'failed', 'cancelled', 'interrupted'].includes(status);
}

export function statusLabel(status: string): string {
  return status.replaceAll('_', ' ');
}

export function statusTone(status: string): string {
  if (status === 'completed' || status === 'responded') {
    return 'text-ds-text-success-default-default';
  }
  if (status === 'failed' || status === 'outcome_unknown') {
    return 'text-ds-text-error-default-default';
  }
  if (status === 'timed_out') {
    return 'text-ds-text-warning-default-default';
  }
  if (
    status === 'pending' ||
    status === 'requested' ||
    status === 'running' ||
    status === 'waiting_for_user' ||
    status === 'cancelling'
  ) {
    return 'text-ds-text-information-default-default';
  }
  return 'text-ds-text-neutral-muted-default';
}

export function statusIcon(status: string): LucideIcon {
  if (status === 'completed' || status === 'responded') return CircleCheck;
  if (status === 'failed' || status === 'outcome_unknown') return CircleAlert;
  if (status === 'timed_out') return Clock3;
  if (status === 'running' || status === 'cancelling') return Loader2;
  if (status === 'waiting_for_user' || status === 'interrupted') {
    return PauseCircle;
  }
  if (status === 'pending' || status === 'requested') return Clock3;
  return CircleSlash;
}

export function StatusInline({
  status,
  className,
  hideLabel = false,
}: {
  status: string;
  className?: string;
  hideLabel?: boolean;
}) {
  const Icon = statusIcon(status);
  const animated = status === 'running' || status === 'cancelling';

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 text-label-xs font-normal capitalize',
        statusTone(status),
        className
      )}
    >
      <Icon aria-hidden className={cn('size-3', animated && 'animate-spin')} />
      {hideLabel ? null : <span>{statusLabel(status)}</span>}
    </span>
  );
}

function safeTimestamp(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function useRunElapsedMs(run: TimelineRunView): number {
  const active = isActiveRunStatus(run.status);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  if (run.timestamps.durationMs !== null) return run.timestamps.durationMs;
  const elapsedAnchor = run.timestamps.elapsedAnchor;
  if (elapsedAnchor) {
    const anchoredAt = safeTimestamp(elapsedAnchor.anchoredAt);
    const liveDelta = active && anchoredAt !== null ? now - anchoredAt : 0;
    return Math.max(0, elapsedAnchor.accumulatedMs + liveDelta);
  }
  const startedAt = safeTimestamp(
    run.timestamps.startedAt || run.timestamps.createdAt
  );
  if (startedAt === null) return 0;
  const endedAt = safeTimestamp(run.timestamps.endedAt);
  return Math.max(0, (endedAt ?? now) - startedAt);
}

export function RunElapsed({ run }: { run: TimelineRunView }) {
  const elapsedMs = useRunElapsedMs(run);
  return (
    <span className="tabular-nums text-ds-text-neutral-subtle-default">
      {formatSplittingElapsed(elapsedMs)}
    </span>
  );
}
