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

import type {
  ChatActivityStatus,
  ChatNoticeNode,
  ChatPlanNode,
  ChatStepNode,
} from '../types';

import i18next from 'i18next';
import { toTimelineCall, type TimelineCall } from './timelineCalls';
import type { TimelineRunView, TimelineTraceRow } from './types';

/**
 * Where a segment's title came from.
 *
 * `derived` titles are inferred from toolkit/method names by this module and
 * stay in the subdued label treatment. `authored` titles are the agent's own
 * words and may be promoted to primary text. Backend step events will supply
 * `authored` segments without any renderer change.
 */
export type TimelineSegmentSource = 'derived' | 'authored';

export type SegmentBoundaryReason =
  | 'run_start'
  | 'narration'
  | 'agent_change'
  | 'task_change'
  | 'authored_step'
  | 'interrupt';

/**
 * One unit of meaningful work: the agent's narration plus the calls it made
 * while carrying it out. Segments never contain a human interaction — an
 * interrupt closes the current segment and stands on its own.
 */
export interface TimelineSegment {
  kind: 'segment';
  id: string;
  runId: string;
  source: TimelineSegmentSource;
  /** The agent's own words. Rendered as primary text. May be empty. */
  narration: string;
  /** Optional authored outcome, rendered adjacent to rather than inside narration. */
  summary?: string;
  narrationNodeIds: readonly string[];
  /** Machine-derived description, e.g. `Searched · 14 events`. */
  label: string;
  calls: readonly TimelineCall[];
  status: ChatActivityStatus;
  agentId?: string;
  agentName?: string;
  taskId?: string;
  stepId?: string;
  parentStepId?: string;
  boundaryReason: SegmentBoundaryReason;
}

/** A human interaction rendered at its own position, never inside a fold. */
export interface TimelineInterruptItem {
  kind: 'interrupt';
  id: string;
  call: TimelineCall;
}

/** One projection-classified delegated agent rendered as a single row. */
export interface TimelineSubagentItem {
  kind: 'subagent';
  id: string;
  call: TimelineCall;
  /** Authored Step text folded into the delegated-agent detail, not its identity. */
  authoredStepTitle?: string;
  summary?: string;
  /** Contiguous child-agent work admitted only by explicit opaque identity. */
  children?: readonly TimelineNarrativeItem[];
}

export interface TimelinePlanItem {
  kind: 'plan';
  id: string;
  node: ChatPlanNode;
}

export interface TimelineNoticeItem {
  kind: 'notice';
  id: string;
  node: ChatNoticeNode;
}

export type TimelineNarrativeItem =
  | TimelineSegment
  | TimelineInterruptItem
  | TimelineSubagentItem
  | TimelinePlanItem
  | TimelineNoticeItem;

const ACTIVE_STATUSES = new Set<ChatActivityStatus>(['pending', 'running']);
const FAILED_STATUSES = new Set<ChatActivityStatus>([
  'failed',
  'timed_out',
  'outcome_unknown',
]);

const NARRATIVE_LIFECYCLE_NOISE = new Set([
  'cleanup',
  'registeragent',
  'requestusage',
  'modelinvocation',
]);

function normalizedOperation(value: string | undefined): string {
  return (value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Narrative deliberately omits successful framework bookkeeping. Failures
 * remain visible and Trajectory receives the unfiltered source rows.
 */
function isSuccessfulLifecycleNoise(row: TimelineTraceRow): boolean {
  if (row.kind !== 'tool' || row.invocation.status !== 'completed') {
    return false;
  }
  return [row.invocation.methodName, row.invocation.toolName]
    .map(normalizedOperation)
    .some((identity) => NARRATIVE_LIFECYCLE_NOISE.has(identity));
}

/**
 * Method-name verb heuristics. Deliberately pattern-based rather than a
 * toolkit lookup table so a new toolkit reads sensibly without registration.
 */
const METHOD_VERBS: readonly (readonly [RegExp, () => string])[] =
  Object.freeze([
    [
      /(^|_)search$|_search|^search_/,
      () => i18next.t('chat.timeline-searched', { defaultValue: 'Searched' }),
    ],
    [
      /^read_|_read$/,
      () => i18next.t('chat.timeline-read', { defaultValue: 'Read' }),
    ],
    [
      /^write_|_write$/,
      () => i18next.t('chat.timeline-wrote', { defaultValue: 'Wrote' }),
    ],
    [
      /^browser_|_navigate$|^navigate/,
      () => i18next.t('chat.timeline-browsed', { defaultValue: 'Browsed' }),
    ],
    [
      /^list_|_list$/,
      () => i18next.t('chat.timeline-listed', { defaultValue: 'Listed' }),
    ],
    [
      /^fetch_|_fetch$|^download/,
      () => i18next.t('chat.timeline-fetched', { defaultValue: 'Fetched' }),
    ],
    [
      /^run_|^exec|^shell|^terminal/,
      () => i18next.t('chat.timeline-ran', { defaultValue: 'Ran' }),
    ],
    [
      /^create_|^new_/,
      () => i18next.t('chat.timeline-created', { defaultValue: 'Created' }),
    ],
    [
      /^update_|^edit_|^modify_/,
      () => i18next.t('chat.timeline-edited', { defaultValue: 'Edited' }),
    ],
    [
      /^delete_|^remove_/,
      () => i18next.t('chat.timeline-deleted', { defaultValue: 'Deleted' }),
    ],
    [
      /^ask_|^request_/,
      () => i18next.t('chat.timeline-asked', { defaultValue: 'Asked' }),
    ],
  ]);

function humanizeIdentifier(value: string): string {
  const words = value.trim().replaceAll('_', ' ').trim();
  if (!words) return '';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Describe a set of calls in human terms. A uniform method gets its verb; a
 * mixed segment falls back to a plain count so the label never overclaims.
 */
export function deriveSegmentLabel(calls: readonly TimelineCall[]): string {
  const count = calls.length;
  if (count === 0) return '';
  if (count === 1) return calls[0]!.title;

  const suffix = i18next.t('chat.timeline-action-count', {
    defaultValue_one: '{{count}} action',
    defaultValue_other: '{{count}} actions',
    count,
  });

  const methods = new Set(calls.map((call) => call.methodName?.trim() || ''));
  if (methods.size !== 1) return suffix;

  const [method] = [...methods];
  if (!method) return suffix;

  const normalized = method.toLowerCase();
  const verb = METHOD_VERBS.find(([pattern]) => pattern.test(normalized))?.[1];
  const description = verb?.() || humanizeIdentifier(method);
  return `${description} · ${suffix}`;
}

/** A segment inherits the most severe status among its calls. */
function aggregateSegmentStatus(
  calls: readonly TimelineCall[]
): ChatActivityStatus {
  if (calls.length === 0) return 'completed';
  if (calls.some((call) => FAILED_STATUSES.has(call.status))) return 'failed';
  if (calls.some((call) => ACTIVE_STATUSES.has(call.status))) return 'running';
  if (calls.every((call) => call.status === 'cancelled')) return 'cancelled';
  return 'completed';
}

/**
 * Narration is language the agent produced about its own work: assistant
 * reasoning messages and work-log progress frames. It is never the final
 * answer, and never a toolkit invocation.
 *
 * Work-log frames count because their title is think-progress text
 * ("Searching for README files"), not a request/response record.
 */
function narrationText(row: TimelineTraceRow): string | null {
  if (row.kind !== 'node') return null;
  const node = row.node;
  if (node.kind === 'activity' && node.activityType === 'work_log') {
    return node.title.trim() || null;
  }
  if (node.kind !== 'message') return null;
  if (node.role !== 'assistant') return null;
  if (node.purpose === 'final') return null;
  const content = node.content.trim();
  return content || null;
}

interface OpenSegment {
  id: string;
  runId: string;
  narration: string[];
  narrationNodeIds: string[];
  calls: TimelineCall[];
  agentId?: string;
  agentName?: string;
  taskId?: string;
  boundaryReason: SegmentBoundaryReason;
}

function sealSegment(open: OpenSegment): TimelineSegment | null {
  const narration = open.narration.join('\n').trim();
  if (!narration && open.calls.length === 0) return null;

  return {
    kind: 'segment',
    id: open.id,
    runId: open.runId,
    source: 'derived',
    narration,
    narrationNodeIds: open.narrationNodeIds,
    label: deriveSegmentLabel(open.calls),
    calls: open.calls,
    status: aggregateSegmentStatus(open.calls),
    agentId: open.agentId,
    agentName: open.agentName,
    taskId: open.taskId,
    boundaryReason: open.boundaryReason,
  };
}

/**
 * Fold a Run's trace rows into narrative segments.
 *
 * Boundaries come only from data the projection already carries: a new piece
 * of narration, a change of agent or task, or an interrupt. Toolkit changes
 * stay inside one contiguous action group. Wall-clock gaps are deliberately
 * not a boundary — they split long-running single tools into meaningless
 * fragments.
 */
export function segmentTimelineRows(
  traceRows: readonly TimelineTraceRow[]
): TimelineNarrativeItem[] {
  const items: TimelineNarrativeItem[] = [];
  let open: OpenSegment | null = null;

  const close = () => {
    if (!open) return;
    const sealed = sealSegment(open);
    if (sealed) items.push(sealed);
    open = null;
  };

  const start = (
    row: TimelineTraceRow,
    boundaryReason: SegmentBoundaryReason,
    seed?: TimelineCall
  ): OpenSegment => {
    const next: OpenSegment = {
      id: `timeline-segment:${row.id}`,
      runId: row.kind === 'tool' ? row.invocation.runId : row.node.runId,
      narration: [],
      narrationNodeIds: [],
      calls: [],
      agentId: seed?.agentId,
      agentName: seed?.agentName,
      taskId: seed?.taskId,
      boundaryReason,
    };
    open = next;
    return next;
  };

  for (const row of traceRows) {
    const narration = narrationText(row);
    if (narration) {
      close();
      const next = start(row, 'narration');
      next.narration.push(narration);
      next.narrationNodeIds.push(row.id);
      if (row.kind === 'node' && row.node.kind !== 'plan') {
        const source = row.node as { agentId?: string; agentName?: string };
        next.agentId = source.agentId;
        next.agentName = source.agentName;
      }
      continue;
    }

    if (row.kind === 'node' && row.node.kind === 'plan') {
      close();
      items.push({ kind: 'plan', id: row.id, node: row.node });
      continue;
    }

    if (row.kind === 'node' && row.node.kind === 'notice') {
      close();
      items.push({ kind: 'notice', id: row.id, node: row.node });
      continue;
    }

    const call = toTimelineCall(row);
    if (!call) continue;

    if (call.subagentInvocation === true) {
      close();
      items.push({ kind: 'subagent', id: row.id, call });
      continue;
    }

    if (call.executor === 'human') {
      close();
      items.push({ kind: 'interrupt', id: row.id, call });
      continue;
    }

    if (open) {
      const current: OpenSegment = open;
      const agentChanged =
        current.calls.length > 0 && (current.agentId || call.agentId)
          ? current.agentId !== call.agentId
          : false;
      const taskChanged =
        current.calls.length > 0 && (current.taskId || call.taskId)
          ? current.taskId !== call.taskId
          : false;
      if (agentChanged || taskChanged) {
        close();
        const reason: SegmentBoundaryReason = agentChanged
          ? 'agent_change'
          : 'task_change';
        start(row, reason, call);
      }
    }

    const target = open ?? start(row, 'run_start', call);
    if (target.calls.length === 0) {
      target.agentId = target.agentId ?? call.agentId;
      target.agentName = target.agentName ?? call.agentName;
      target.taskId = target.taskId ?? call.taskId;
    }
    target.calls.push(call);
  }

  close();
  return items;
}

function authoredStepStatusLabel(step: ChatStepNode): string {
  switch (step.status) {
    case 'pending':
      return i18next.t('chat.timeline-planned', { defaultValue: 'Planned' });
    case 'running':
      return i18next.t('chat.timeline-in-progress', {
        defaultValue: 'In progress',
      });
    case 'blocked':
      return i18next.t('chat.timeline-blocked', { defaultValue: 'Blocked' });
    case 'completed':
      return i18next.t('chat.timeline-completed', {
        defaultValue: 'Completed',
      });
    case 'failed':
      return i18next.t('chat.timeline-failed', { defaultValue: 'Failed' });
    case 'cancelled':
      return i18next.t('chat.timeline-cancelled', {
        defaultValue: 'Cancelled',
      });
    case 'interrupted':
      return i18next.t('chat.timeline-interrupted', {
        defaultValue: 'Interrupted',
      });
  }
}

/**
 * Prefer code-owned Step boundaries whenever a Run contains Step facts.
 * Step text becomes an authored reasoning item when work actually starts.
 * Calls remain in receipt order and flow through the derived action grouper,
 * so a later tool can never jump above an intervening sub-agent or interrupt.
 */
function segmentAuthoredTimelineRows(
  traceRows: readonly TimelineTraceRow[]
): TimelineNarrativeItem[] {
  const stepEvents = traceRows.flatMap((row) =>
    row.kind === 'node' && row.node.kind === 'step' ? [row.node] : []
  );
  if (stepEvents.length === 0) return segmentTimelineRows(traceRows);

  const latestByStep = new Map<string, ChatStepNode>();
  const activeSequenceByStep = new Map<string, number>();
  for (const step of stepEvents) {
    latestByStep.set(step.stepId, step);
    if (
      !activeSequenceByStep.has(step.stepId) &&
      !(step.phase === 'requested' && step.status === 'pending')
    ) {
      activeSequenceByStep.set(step.stepId, step.runSequence);
    }
  }
  const segmentFor = (stepId: string): TimelineSegment => {
    const step = latestByStep.get(stepId)!;
    const summary = step.summary?.trim();
    return {
      kind: 'segment',
      id: `timeline-step:${step.stepId}`,
      runId: step.runId,
      source: 'authored',
      // A Step lifecycle owns one text slot. Later authored progress replaces
      // the earlier label instead of rendering as a second Timeline event.
      narration: summary || step.title,
      narrationNodeIds: stepEvents
        .filter((event) => event.stepId === stepId)
        .map((event) => event.id),
      label: authoredStepStatusLabel(step),
      calls: [],
      status: step.status,
      agentId: step.agentId,
      agentName: step.agentName,
      stepId,
      parentStepId: step.parentStepId,
      boundaryReason: 'authored_step',
    };
  };

  const subagentStepIds = new Set(
    traceRows.flatMap((row) =>
      row.kind === 'tool' &&
      row.invocation.subagentInvocation === true &&
      row.invocation.stepId
        ? [row.invocation.stepId]
        : []
    )
  );
  const items: TimelineNarrativeItem[] = [];
  const emitted = new Set<string>();
  let unscoped: TimelineTraceRow[] = [];
  const flushUnscoped = () => {
    if (unscoped.length) {
      items.push(
        ...segmentTimelineRows(unscoped).map((item): TimelineNarrativeItem => {
          if (item.kind !== 'subagent' || !item.call.stepId) return item;
          const step = latestByStep.get(item.call.stepId);
          if (!step) return item;
          return {
            ...item,
            authoredStepTitle: step.title.trim() || undefined,
            summary: step.summary?.trim() || undefined,
          };
        })
      );
    }
    unscoped = [];
  };
  for (const row of traceRows) {
    if (row.kind === 'node' && row.node.kind === 'step') {
      // The delegated-agent disclosure owns the correlated authored Step, so
      // its name/reasoning does not appear as a duplicate sibling event.
      if (subagentStepIds.has(row.node.stepId)) continue;
      const anchorSequence = activeSequenceByStep.get(row.node.stepId);
      if (!emitted.has(row.node.stepId) && row.runSequence === anchorSequence) {
        flushUnscoped();
        items.push(segmentFor(row.node.stepId));
        emitted.add(row.node.stepId);
      }
      continue;
    }
    unscoped.push(row);
  }
  flushUnscoped();
  return items;
}

function itemBelongsToSubagent(
  item: TimelineNarrativeItem,
  subagent: TimelineSubagentItem
): boolean {
  const agentId = subagent.call.subagentAgentId;
  const taskId = subagent.call.subagentTaskId;
  if (!agentId && !taskId) return false;

  if (item.kind === 'segment') {
    return Boolean(
      (agentId && item.agentId === agentId) ||
      (taskId && item.taskId === taskId)
    );
  }
  if (item.kind === 'interrupt' || item.kind === 'subagent') {
    return Boolean(
      (agentId && item.call.agentId === agentId) ||
      (taskId && item.call.taskId === taskId)
    );
  }
  return false;
}

/**
 * A child process may stream after its creation receipt. Admit only contiguous
 * items carrying the exact child identity; an unrelated parent action closes
 * the disclosure scope and stays at its own chronological Timeline position.
 */
function nestExplicitSubagentWork(
  items: readonly TimelineNarrativeItem[]
): TimelineNarrativeItem[] {
  const nested: TimelineNarrativeItem[] = [];
  for (const item of items) {
    const previous = nested.at(-1);
    if (
      previous?.kind === 'subagent' &&
      itemBelongsToSubagent(item, previous)
    ) {
      nested[nested.length - 1] = {
        ...previous,
        children: [...(previous.children || []), item],
      };
      continue;
    }
    nested.push(item);
  }
  return nested;
}

/** Convenience wrapper for one composed Run view. */
export function segmentTimelineRun(
  run: TimelineRunView,
  preservePlanEventId?: string
): TimelineNarrativeItem[] {
  const narrativeToolCallIds = new Set(
    run.traceRows.flatMap((row) => {
      if (
        row.kind !== 'tool' ||
        isSuccessfulLifecycleNoise(row) ||
        row.invocation.nodes.some(
          (node) => node.semanticKind === 'plan_operation'
        )
      ) {
        return [];
      }
      return row.invocation.toolCallId ? [row.invocation.toolCallId] : [];
    })
  );
  const narrativeRows = run.traceRows.filter((row) => {
    if (row.kind === 'tool') {
      if (isSuccessfulLifecycleNoise(row)) return false;
      return !row.invocation.nodes.some(
        (node) => node.semanticKind === 'plan_operation'
      );
    }
    // A correlated notice annotates its logical tool row. Keeping a second
    // standalone `Title · content` row would duplicate the same action and
    // hide the useful request/response disclosure behind it.
    if (
      row.node.kind === 'notice' &&
      row.node.toolCallId &&
      narrativeToolCallIds.has(row.node.toolCallId)
    ) {
      return false;
    }
    // Task lifecycle receipts describe the container around the work, not an
    // action the user can inspect. Failed task receipts remain visible; normal
    // progress is represented by authored Step text and its real tool calls.
    if (
      row.node.kind === 'activity' &&
      row.node.activityType === 'task' &&
      !FAILED_STATUSES.has(row.node.status)
    ) {
      return false;
    }
    // The Progress surface owns the live plan. Keeping the complete plan in
    // narrative Chat makes every later message carry a large, stale-looking
    // block; the detailed trajectory still retains every plan snapshot.
    if (row.node.kind === 'plan') {
      return row.node.eventId === preservePlanEventId;
    }
    return true;
  });
  return nestExplicitSubagentWork(segmentAuthoredTimelineRows(narrativeRows));
}

/**
 * Calls stay folded by default — narrative's whole purpose is to show the
 * agent's words rather than its tool rows, and a running segment still signals
 * liveness through the shimmer on its label.
 *
 * A failure is the exception: it breaks the abstraction and opens to the row
 * that actually failed.
 */
export function segmentDefaultsOpen(segment: TimelineSegment): boolean {
  return FAILED_STATUSES.has(segment.status);
}
