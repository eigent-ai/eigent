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
import { itemFadeMotion } from '@/components/ui/motion';
import type { TimelineRunView } from '@/lib/projector/chat/presentation';
import type { ProjectedArtifact } from '@/lib/projector/types';
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
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

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

/** A submitted query and a pending receipt are still startup state. */
export function hasRunExecutionRows(run: TimelineRunView): boolean {
  return run.traceRows.some((row) => {
    if (row.kind === 'tool') return true;
    if (row.node.kind === 'message' && row.node.role === 'user') return false;
    if (row.node.kind === 'run_status') {
      return row.node.status !== 'pending';
    }
    return true;
  });
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
  return 'text-ds-ink-muted-default';
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
        'inline-flex shrink-0 items-center gap-1 text-ds-text-meta font-normal capitalize',
        statusTone(status),
        className
      )}
    >
      <Icon aria-hidden className={cn('size-3', animated && 'animate-spin')} />
      {hideLabel ? null : <span>{statusLabel(status)}</span>}
    </span>
  );
}

/**
 * Ephemeral tail marker for a progressing Run during quiet model/tool spans.
 * It is derived from projection state and never appended to durable history.
 */
export function RunActivityIndicator() {
  const { t } = useTranslation();

  return (
    <div
      className="flex min-h-6 w-full items-center gap-2 text-ds-text-meta font-normal text-ds-ink-muted-default"
      data-run-activity-indicator
      role="status"
      aria-live="polite"
    >
      <Loader2
        aria-hidden
        className="size-3.5 text-ds-icon-information-default-default motion-safe:animate-spin"
      />
      <span>{t('chat.run-working-indicator')}</span>
    </div>
  );
}

function safeTimestamp(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Wall-clock time the Run has spent paused.
 *
 * Pause is a user action the frontend owns; the durable Run journal keeps
 * accumulating real time regardless. Subtracting the paused span keeps the
 * displayed timer frozen while paused and continuing from the same value on
 * resume, instead of jumping forward by however long the user waited.
 */
function usePausedOffsetMs(paused: boolean, now: number): number {
  const [settledOffsetMs, setSettledOffsetMs] = useState(0);
  const [pausedAt, setPausedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!paused) return;
    const startedAt = Date.now();
    setPausedAt(startedAt);
    return () => {
      setPausedAt(null);
      setSettledOffsetMs(
        (total) => total + Math.max(0, Date.now() - startedAt)
      );
    };
  }, [paused]);

  const openSpanMs = pausedAt === null ? 0 : Math.max(0, now - pausedAt);
  return settledOffsetMs + openSpanMs;
}

export function useRunElapsedMs(run: TimelineRunView, paused = false): number {
  const active = isActiveRunStatus(run.status) && !paused;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  const pausedOffsetMs = usePausedOffsetMs(paused, now);

  if (run.timestamps.durationMs !== null) return run.timestamps.durationMs;
  const elapsedAnchor = run.timestamps.elapsedAnchor;
  if (elapsedAnchor) {
    const anchoredAt = safeTimestamp(elapsedAnchor.anchoredAt);
    const liveDelta =
      anchoredAt !== null && (active || paused)
        ? Math.max(0, now - anchoredAt - pausedOffsetMs)
        : 0;
    return Math.max(0, elapsedAnchor.accumulatedMs + liveDelta);
  }
  const startedAt = safeTimestamp(
    run.timestamps.startedAt || run.timestamps.createdAt
  );
  if (startedAt === null) return 0;
  const endedAt = safeTimestamp(run.timestamps.endedAt);
  return Math.max(0, (endedAt ?? now) - startedAt - pausedOffsetMs);
}

export function RunElapsed({
  run,
  paused = false,
}: {
  run: TimelineRunView;
  paused?: boolean;
}) {
  const elapsedMs = useRunElapsedMs(run, paused);
  return (
    <span className="text-ds-ink-subtle-default tabular-nums">
      {formatSplittingElapsed(elapsedMs)}
    </span>
  );
}

const CONTENT_EASE: [number, number, number, number] = [0.32, 0.72, 0, 1];
const HEIGHT_MOTION = {
  height: { duration: 0.22, ease: CONTENT_EASE },
  opacity: { duration: 0.16, ease: CONTENT_EASE },
} as const;
const REDUCED_EVENT_ENTER_TRANSITION = {
  duration: 0.12,
  ease: [0.32, 0.72, 0, 1],
} as const;

export function eventEntryMotion(reducedMotion: boolean) {
  return {
    ...itemFadeMotion(reducedMotion),
    layout: false,
  } as const;
}

export function disclosureMotion(reducedMotion: boolean) {
  if (reducedMotion) {
    return {
      initial: { height: 'auto', opacity: 0 },
      animate: { height: 'auto', opacity: 1 },
      exit: { height: 'auto', opacity: 0 },
      transition: { opacity: REDUCED_EVENT_ENTER_TRANSITION },
    } as const;
  }

  return {
    initial: { height: 0, opacity: 0 },
    animate: { height: 'auto', opacity: 1 },
    exit: { height: 0, opacity: 0 },
    transition: HEIGHT_MOTION,
  } as const;
}

export interface InteractiveTimelinePlan {
  eventId: string;
  content: ReactNode;
}

export interface TimelineModeProps {
  runs: readonly TimelineRunView[];
  projectedArtifactsByRun?: Readonly<Record<string, ProjectedArtifact[]>>;
  /**
   * The active workforce plan keeps its legacy view/edit surface while its
   * durable event remains the source of timeline ordering. Other plan events
   * continue through the read-only timeline renderer.
   */
  interactivePlansByRun?: Readonly<Record<string, InteractiveTimelinePlan>>;
  /**
   * The user has taken control of the Run. Elapsed time and the running
   * shimmer both hold until it resumes; the work log stays open because a
   * pause is not an ending.
   */
  paused?: boolean;
}
