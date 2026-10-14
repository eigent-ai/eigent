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

import { AgentMessageCard } from '@/components/ChatBox/MessageItem/AgentMessageCard';
import { PreparingToExecuteTasks } from '@/components/ChatBox/MessageItem/PreparingToExecuteTasks';
import { SpaceWaitNotice } from '@/components/ChatBox/MessageItem/SpaceWaitNotice';
import { formatSplittingElapsed } from '@/components/ChatBox/MessageItem/TokenUtils';
import { ToolInputOutputDetails } from '@/components/ChatBox/MessageItem/ToolInputOutputDetails';
import { UserMessageCard } from '@/components/ChatBox/MessageItem/UserMessageCard';
import { DsIcon } from '@/components/ui/ds-icon';
import { itemFadeMotion } from '@/components/ui/motion';
import { DS_FOCUS_RING } from '@/components/ui/semanticProps';
import ShinyText from '@/components/ui/ShinyText/ShinyText';
import { AgentAvatar } from '@/components/Workspace/AgentAvatar';
import {
  resolveSubagentPresentationIdentity,
  segmentTimelineRun,
  type TimelineCall,
  type TimelineNarrativeItem,
  type TimelineRunView,
  type TimelineSegment,
} from '@/lib/projector/chat/presentation';
import { errorCopy } from '@/lib/usageErrors';
import { cn } from '@/lib/utils';
import { usePageTabStore } from '@/store/pageTabStore';
import {
  DEFAULT_NARRATIVE_INFORMATION_DENSITY,
  type NarrativeInformationDensity,
} from '@/types/chatTimeline';
import {
  AgentStep,
  SessionMode,
  type SessionModeType,
} from '@/types/constants';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { TaskErrorNotice } from '../TaskErrorNotice';
import { taskErrorReason } from '../taskErrorPresentation';

import { callIcon } from './actionIcon';
import { CallRow, isCallActiveStatus, isCallErrorStatus } from './CallRow';
import { ModelChangeDivider } from './ModelChangeDivider';
import { RunFilesGroup } from './RunFiles';
import {
  disclosureMotion,
  eventEntryMotion,
  type InteractiveTimelinePlan,
  isActiveRunStatus,
  isTerminalRunStatus,
  type TimelineModeProps,
  useRunElapsedMs,
} from './shared';

/**
 * Primary text is reserved for language the agent produced itself. Anything
 * this frontend derived from toolkit and method names stays in the subdued
 * label treatment, so the reader can always tell narration from inference.
 */
const PRIMARY_TEXT_CLASS =
  '!text-ds-text-base font-normal text-ds-ink-default-default';
const DERIVED_TEXT_CLASS =
  '!text-ds-text-base font-normal text-ds-ink-muted-default';

type NarrativeWorkEntry =
  | {
      kind: 'agent';
      id: string;
      agentKey: string;
      agentName: string;
      items: TimelineNarrativeItem[];
    }
  | { kind: 'flow'; id: string; items: TimelineNarrativeItem[] };

function narrativeItemAgent(
  item: TimelineNarrativeItem,
  fallbackName: string
): { id: string; name: string } | null {
  if (item.kind === 'segment') {
    const id = (item.agentId || item.agentName || '').trim();
    if (!id) return null;
    return { id, name: item.agentName?.trim() || fallbackName };
  }
  if (item.kind === 'interrupt') {
    const id = (item.call.agentId || item.call.agentName || '').trim();
    if (!id) return null;
    return { id, name: item.call.agentName?.trim() || fallbackName };
  }
  if (item.kind === 'subagent') {
    const id = (item.call.agentId || item.call.agentName || '').trim();
    if (!id) return null;
    return { id, name: item.call.agentName?.trim() || fallbackName };
  }
  return null;
}

function itemOwnsCall(
  item: TimelineNarrativeItem,
  callId: string | null
): boolean {
  if (!callId) return false;
  if (item.kind === 'segment') {
    return item.calls.some((call) => call.id === callId);
  }
  if (item.kind === 'interrupt') return item.call.id === callId;
  if (item.kind === 'subagent') {
    return (
      item.call.id === callId ||
      Boolean(item.children?.some((child) => itemOwnsCall(child, callId)))
    );
  }
  return false;
}

function itemHasActiveCall(item: TimelineNarrativeItem): boolean {
  if (item.kind === 'segment') {
    return item.calls.some((call) => isCallActiveStatus(call.status));
  }
  if (item.kind === 'interrupt') return isCallActiveStatus(item.call.status);
  if (item.kind === 'subagent') {
    return (
      isCallActiveStatus(item.call.status) ||
      Boolean(item.children?.some(itemHasActiveCall))
    );
  }
  return false;
}

function itemIsFailed(item: TimelineNarrativeItem): boolean {
  if (item.kind === 'segment') return isCallErrorStatus(item.status);
  if (item.kind === 'interrupt') return isCallErrorStatus(item.call.status);
  if (item.kind === 'subagent') {
    return (
      isCallErrorStatus(item.call.status) ||
      Boolean(item.children?.some(itemIsFailed))
    );
  }
  return false;
}

/**
 * Workforce folds contiguous work from one actor into a nested accordion.
 * Plans, notices, and unattributed interrupts stay at the work-log level so
 * they keep their chronological position. Single-agent stays a flat list.
 */
function groupNarrativeWork(
  items: readonly TimelineNarrativeItem[],
  workforce: boolean,
  fallbackAgentName: string
): NarrativeWorkEntry[] {
  if (!workforce) {
    return items.length > 0
      ? [{ kind: 'flow', id: 'flow', items: [...items] }]
      : [];
  }

  const entries: NarrativeWorkEntry[] = [];
  for (const item of items) {
    const agent = narrativeItemAgent(item, fallbackAgentName);
    if (!agent) {
      const last = entries.at(-1);
      if (last?.kind === 'flow') last.items.push(item);
      else entries.push({ kind: 'flow', id: `flow:${item.id}`, items: [item] });
      continue;
    }
    const last = entries.at(-1);
    if (last?.kind === 'agent' && last.agentKey === agent.id) {
      last.items.push(item);
      continue;
    }
    entries.push({
      kind: 'agent',
      id: `agent:${agent.id}:${item.id}`,
      agentKey: agent.id,
      agentName: agent.name,
      items: [item],
    });
  }
  return entries;
}

function workLogSummaryI18nKey(run: TimelineRunView): string {
  if (isActiveRunStatus(run.status)) return 'chat.working-on-tasks-for';
  if (run.status === 'failed') return 'chat.failed-after';
  if (run.status === 'timed_out') return 'chat.timed-out-after';
  if (run.status === 'interrupted') return 'chat.interrupted-after';
  if (run.status === 'cancelled') return 'chat.stopped-after';
  return 'chat.worked-for';
}

function NarrativeWorkLogSummary({
  run,
  paused,
}: {
  run: TimelineRunView;
  paused: boolean;
}) {
  const { t } = useTranslation();
  const elapsedMs = useRunElapsedMs(run, paused);
  const timeLabel = formatSplittingElapsed(elapsedMs);
  const elapsed = (
    <span className="text-ds-ink-subtle-default tabular-nums">{timeLabel}</span>
  );

  if (paused && isActiveRunStatus(run.status)) {
    return (
      <>
        {t('chat.paused-after', { defaultValue: 'Paused after' })} {elapsed}
      </>
    );
  }

  return (
    <Trans
      i18nKey={workLogSummaryI18nKey(run)}
      values={{ time: timeLabel }}
      components={{
        elapsed: <span className="text-ds-ink-subtle-default tabular-nums" />,
      }}
    />
  );
}

/**
 * Identity for collapsing consecutive repeats of one toolkit method. Human
 * calls own their question/answer receipt and always stay separate.
 */
function repeatedCallKey(call: TimelineCall): string | null {
  if (call.executor !== 'toolkit') return null;
  const normalize = (value: string | undefined) =>
    (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const toolkit = normalize(call.toolkitName);
  const method = normalize(call.methodName) || normalize(call.title);
  if (!toolkit || !method) return null;
  return JSON.stringify([
    toolkit,
    toolkit === 'searchtoolkit' && method.startsWith('search')
      ? 'search'
      : method,
  ]);
}

type NarrativeFlowEntry =
  | { kind: 'narration'; id: string; segment: TimelineSegment }
  | { kind: 'call'; id: string; call: TimelineCall }
  | { kind: 'repeat'; id: string; calls: TimelineCall[] }
  | { kind: 'item'; id: string; item: NarrativeStandaloneItem };

type NarrativeStandaloneItem = Exclude<TimelineNarrativeItem, TimelineSegment>;

/**
 * The work log reads like the legacy event log: the agent's words in place,
 * then one row per call. Minimum and Moderate collapse consecutive repeats of
 * one toolkit method into a counted row; Full lists every call on its own.
 */
function buildNarrativeFlow(
  items: readonly TimelineNarrativeItem[],
  density: NarrativeInformationDensity
): NarrativeFlowEntry[] {
  const entries: NarrativeFlowEntry[] = [];
  const pushCall = (call: TimelineCall) => {
    const key = density === 'expanded' ? null : repeatedCallKey(call);
    const previous = entries.at(-1);
    if (key && previous?.kind === 'call') {
      if (repeatedCallKey(previous.call) === key) {
        entries[entries.length - 1] = {
          kind: 'repeat',
          id: `repeat:${previous.call.id}`,
          calls: [previous.call, call],
        };
        return;
      }
    }
    if (key && previous?.kind === 'repeat') {
      if (repeatedCallKey(previous.calls[0]) === key) {
        previous.calls.push(call);
        return;
      }
    }
    entries.push({ kind: 'call', id: call.id, call });
  };

  for (const item of items) {
    if (item.kind !== 'segment') {
      entries.push({ kind: 'item', id: item.id, item });
      continue;
    }
    if (item.narration || item.summary) {
      entries.push({
        kind: 'narration',
        id: `narration:${item.id}`,
        segment: item,
      });
    }
    item.calls.forEach(pushCall);
  }
  return entries;
}

/** A collapsed row must not promote a long payload or credential-like text. */
function conciseRowText(value: string | undefined): string | null {
  const text = value?.trim();
  if (
    !text ||
    text.length > 160 ||
    /[\r\n\t{}]/.test(text) ||
    /\b(?:api[_-]?key|access[_-]?token|secret|password|authorization|bearer)\b|(?:^|\s)[\w.-]*(?:KEY|TOKEN|SECRET)=/i.test(
      text
    )
  ) {
    return null;
  }
  return text;
}

/** Only promote short, display-safe request text to a row. */
function callSubject(call: TimelineCall): string | null {
  const input = call.input?.trim();
  if (!input || input.length > 1_000) return null;

  let subject = input;
  if (input.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(input);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
      }
      const fields = parsed as Record<string, unknown>;
      const fieldNames =
        call.actionKind === 'search'
          ? ['query', 'search_query', 'q']
          : ['command', 'cmd'];
      const value = fieldNames
        .map((key) => fields[key])
        .find((field): field is string => typeof field === 'string');
      if (!value) return null;
      subject = value.trim();
    } catch {
      return null;
    }
  } else {
    subject = subject.replace(/^(?:search query|query|command):\s*/i, '');
    if (call.actionKind === 'command') subject = subject.replace(/^\$\s+/, '');
  }

  return conciseRowText(subject);
}

/** The call detail is the human-readable work description, when supplied. */
function callDescription(call: TimelineCall): string | null {
  for (const candidate of [call.notice?.content, call.detail]) {
    const description = conciseRowText(candidate);
    if (
      description &&
      !/^(?:completed|in progress|started|running|failed|cancelled|timed out|returned text)(?:[ .:(]|$)/i.test(
        description
      )
    ) {
      return description;
    }
  }
  return null;
}

/** Moderate and Full add one short subject: the query, the work, or the target. */
function callSummary(call: TimelineCall): string | null {
  const subject = callSubject(call);
  const description = callDescription(call);
  return call.actionKind === 'search'
    ? (subject ?? description)
    : (description ?? subject);
}

/** Consecutive calls of one toolkit method, counted like the legacy log. */
function NarrativeRepeatedCalls({
  calls,
  summarize,
  initiallyOpenCallIds,
  onCallOpenChange,
  runActive,
  latestRunningCallId,
  reducedMotion,
}: {
  calls: readonly TimelineCall[];
  summarize: boolean;
  initiallyOpenCallIds: ReadonlySet<string>;
  onCallOpenChange: (callId: string, open: boolean) => void;
  runActive: boolean;
  latestRunningCallId: string | null;
  reducedMotion: boolean;
}) {
  const { t } = useTranslation();
  const first = calls[0];
  const failed = calls.some((call) => isCallErrorStatus(call.status));
  const [open, setOpen] = useState(
    () => failed || calls.some((call) => initiallyOpenCallIds.has(call.id))
  );
  const wasFailed = useRef(failed);

  useEffect(() => {
    if (failed) setOpen(true);
    else if (wasFailed.current) setOpen(false);
    wasFailed.current = failed;
  }, [failed]);

  const countLabel = t('chat.repeated-tool-events', {
    tool: first.title,
    count: calls.length,
  });
  const summary = summarize ? callSummary(calls[calls.length - 1]) : null;
  const label = summary ? `${countLabel} · ${summary}` : countLabel;
  // A closed group hides the running call, so the shimmer moves up to the
  // label. Opening it hands the shimmer back to the call that owns it, which
  // keeps exactly one live indicator on screen either way.
  const shimmerOnLabel =
    !open && calls.some((call) => call.id === latestRunningCallId);

  return (
    <div
      className="flex w-full min-w-0 flex-col items-start"
      data-narrative-repeated-calls
      data-toolkit={first.toolkitName}
      data-method={first.methodName}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'group inline-flex max-w-full min-w-0 items-center gap-ds-6 self-start rounded-ds-compact-control px-0 py-ds-2 text-left text-ds-ink-subtle-default transition-opacity hover:opacity-80',
          DS_FOCUS_RING,
          failed && 'text-ds-text-status-error-default-default'
        )}
        data-narrative-segment-call-count={calls.length}
        data-narrative-segment-trigger
      >
        <DsIcon
          icon={callIcon(first)}
          recipe="main"
          data-timeline-action-icon={first.actionKind}
        />
        {shimmerOnLabel ? (
          <ShinyText
            speed={2.5}
            text={label}
            className="min-w-0 shrink overflow-hidden !text-ds-text-base !font-normal text-ellipsis whitespace-nowrap text-ds-ink-subtle-default"
          />
        ) : (
          <span className="min-w-0 shrink overflow-hidden !text-ds-text-base font-normal text-ellipsis whitespace-nowrap">
            {label}
          </span>
        )}
        <DsIcon
          icon={ChevronRight}
          className={cn(
            'transition-[opacity,transform] duration-200',
            open
              ? 'rotate-90 opacity-100'
              : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:opacity-100'
          )}
          data-narrative-segment-chevron
        />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="narrative-repeated-calls"
            {...disclosureMotion(reducedMotion)}
            className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-ds-6 overflow-hidden"
          >
            <span aria-hidden className="w-ds-icon-main" />
            <div
              className="flex min-w-0 flex-col gap-ds-4 pt-ds-4"
              data-narrative-segment-calls
            >
              <AnimatePresence initial={false}>
                {calls.map((call) => (
                  <motion.div
                    {...itemFadeMotion(reducedMotion)}
                    data-narrative-event-motion
                    data-narrative-event-motion-id={call.id}
                    key={call.id}
                  >
                    <CallRow
                      call={call}
                      summary={summarize ? callSummary(call) : null}
                      initialOpen={
                        initiallyOpenCallIds.has(call.id) ? true : undefined
                      }
                      onOpenChange={(callOpen) =>
                        onCallOpenChange(call.id, callOpen)
                      }
                      latestRunningCallId={latestRunningCallId}
                      reducedMotion={reducedMotion}
                      runActive={runActive}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** The agent's own words at their place in the work log. */
function NarrativeNarration({ segment }: { segment: TimelineSegment }) {
  return (
    <div
      className="flex w-full min-w-0 flex-col gap-ds-stack-related"
      data-narrative-segment-id={segment.id}
      data-narrative-segment-source={segment.source}
      data-narrative-segment-status={segment.status}
      data-narrative-parent-step-id={segment.parentStepId}
    >
      {segment.narration ? (
        <span
          className={cn('break-words whitespace-pre-wrap', PRIMARY_TEXT_CLASS)}
          data-narrative-segment-narration
        >
          {segment.narration}
        </span>
      ) : null}
      {segment.summary ? (
        <span
          className={cn('break-words whitespace-pre-wrap', DERIVED_TEXT_CLASS)}
          data-narrative-segment-summary
        >
          {segment.summary}
        </span>
      ) : null}
    </div>
  );
}

/**
 * One chronological list of narration, calls, and standalone items. Density
 * changes only how calls are presented; narration is always shown.
 */
function NarrativeFlow({
  items,
  density,
  interactivePlan,
  runActive,
  latestRunningCallId,
  reducedMotion,
}: {
  items: readonly TimelineNarrativeItem[];
  density: NarrativeInformationDensity;
  interactivePlan?: InteractiveTimelinePlan;
  runActive: boolean;
  latestRunningCallId: string | null;
  reducedMotion: boolean;
}) {
  const flow = useMemo(
    () => buildNarrativeFlow(items, density),
    [density, items]
  );
  const summarize = density !== 'compact';
  // A call moves into a repeated group when its successor arrives, which
  // remounts its row. Remember what the user opened so the move keeps it open.
  const [manuallyOpenCalls, setManuallyOpenCalls] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const rememberCallOpen = (callId: string, open: boolean) => {
    setManuallyOpenCalls((current) => {
      if (current.has(callId) === open) return current;
      const next = new Set(current);
      if (open) next.add(callId);
      else next.delete(callId);
      return next;
    });
  };

  // A density change re-presents existing rows; it is not new activity, so the
  // list swaps in place instead of animating every row out and back in.
  return (
    <AnimatePresence initial={false} key={density}>
      {flow.map((entry) => (
        <motion.div
          {...itemFadeMotion(reducedMotion)}
          data-narrative-event-motion
          data-narrative-event-motion-id={entry.id}
          key={entry.id}
        >
          {entry.kind === 'narration' ? (
            <NarrativeNarration segment={entry.segment} />
          ) : entry.kind === 'call' ? (
            <CallRow
              call={entry.call}
              summary={summarize ? callSummary(entry.call) : null}
              initialOpen={
                manuallyOpenCalls.has(entry.call.id) ? true : undefined
              }
              onOpenChange={(open) => rememberCallOpen(entry.call.id, open)}
              latestRunningCallId={latestRunningCallId}
              reducedMotion={reducedMotion}
              runActive={runActive}
            />
          ) : entry.kind === 'repeat' ? (
            <NarrativeRepeatedCalls
              calls={entry.calls}
              summarize={summarize}
              initiallyOpenCallIds={manuallyOpenCalls}
              onCallOpenChange={rememberCallOpen}
              latestRunningCallId={latestRunningCallId}
              reducedMotion={reducedMotion}
              runActive={runActive}
            />
          ) : (
            <NarrativeItem
              density={density}
              interactivePlan={interactivePlan}
              item={entry.item}
              latestRunningCallId={latestRunningCallId}
              reducedMotion={reducedMotion}
              runActive={runActive}
            />
          )}
        </motion.div>
      ))}
    </AnimatePresence>
  );
}

function NarrativeSubagentRow({
  item,
  density,
  latestRunningCallId,
  reducedMotion,
  runActive,
}: {
  item: Extract<TimelineNarrativeItem, { kind: 'subagent' }>;
  density: NarrativeInformationDensity;
  latestRunningCallId: string | null;
  reducedMotion: boolean;
  runActive: boolean;
}) {
  const { t } = useTranslation();
  const { call } = item;
  const subagentIdentity = resolveSubagentPresentationIdentity({
    subagentName: call.subagentName,
    subagentType: call.subagentType,
    toolCallId: call.toolCallId,
    stepId: call.stepId,
    subagentAgentId: call.subagentAgentId,
    subagentTaskId: call.subagentTaskId,
    fallbackName: t('layout.session-panel-subagent', {
      defaultValue: 'Subagent',
    }),
    fallbackSeed: call.id,
  });
  const agentName = subagentIdentity.name;
  let statusLabel: string;
  let statusClassName: string;

  switch (call.status) {
    case 'pending':
      statusLabel = t('chat.timeline-created', { defaultValue: 'Created' });
      statusClassName = 'text-ds-text-status-pending-default-default';
      break;
    case 'running':
      statusLabel = t('chat.timeline-subagent-working', {
        defaultValue: 'Working on it',
      });
      statusClassName = 'text-ds-text-status-running-default-default';
      break;
    case 'completed':
      statusLabel = t('chat.timeline-subagent-finished', {
        defaultValue: 'Finished',
      });
      statusClassName = 'text-ds-text-status-completed-default-default';
      break;
    case 'failed':
      statusLabel = t('chat.timeline-failed', { defaultValue: 'Failed' });
      statusClassName = 'text-ds-text-status-error-default-default';
      break;
    case 'cancelled':
      statusLabel = t('chat.timeline-cancelled', {
        defaultValue: 'Cancelled',
      });
      statusClassName = 'text-ds-text-status-cancelled-default-default';
      break;
    case 'timed_out':
      statusLabel = t('chat.timeline-timed-out', { defaultValue: 'Timed out' });
      statusClassName = 'text-ds-text-status-error-default-default';
      break;
    case 'blocked':
      statusLabel = t('chat.timeline-blocked', { defaultValue: 'Blocked' });
      statusClassName = 'text-ds-text-status-pending-default-default';
      break;
    case 'interrupted':
      statusLabel = t('chat.timeline-interrupted', {
        defaultValue: 'Interrupted',
      });
      statusClassName = 'text-ds-text-status-cancelled-default-default';
      break;
    case 'outcome_unknown':
    case 'unknown':
      statusLabel = t('chat.tool-status-unknown', { defaultValue: 'Unknown' });
      statusClassName = 'text-ds-ink-muted-default';
      break;
  }
  const active = isCallActiveStatus(call.status);
  const failed = isCallErrorStatus(call.status);
  const autoOpen = active || failed;
  const [open, setOpen] = useState(autoOpen);
  const wasAutoOpen = useRef(autoOpen);

  useEffect(() => {
    if (autoOpen) setOpen(true);
    else if (wasAutoOpen.current) setOpen(false);
    wasAutoOpen.current = autoOpen;
  }, [autoOpen]);

  const reasoningText =
    item.summary?.trim() || item.authoredStepTitle?.trim() || '';
  const reasoning =
    reasoningText && reasoningText !== agentName ? reasoningText : undefined;
  const noticeErrorReason = call.notice ? taskErrorReason(call.notice) : null;
  const description =
    (noticeErrorReason
      ? errorCopy(noticeErrorReason)
      : call.notice?.content.trim()) ||
    call.detail ||
    (failed
      ? t('chat.no-failure-details', {
          defaultValue: 'No failure details were recorded.',
        })
      : undefined);

  return (
    <div
      className="flex w-full min-w-0 flex-col items-start"
      data-narrative-subagent-row
      data-narrative-subagent-status={call.status}
      data-timeline-call-id={call.toolCallId}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${agentName} · ${statusLabel}`}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'group inline-flex max-w-full min-w-0 items-center justify-start gap-ds-6 self-start rounded-ds-compact-control px-0 py-ds-4 text-left transition-opacity hover:opacity-80',
          DS_FOCUS_RING
        )}
        data-narrative-subagent-trigger
      >
        <AgentAvatar
          agentName={agentName}
          agentType="subagent"
          avatarSeed={subagentIdentity.avatarSeed}
          className="rounded-sm"
          model={call.agentModel}
          provider={call.agentProvider}
          size="md"
        />
        <span
          className="min-w-0 truncate text-ds-text-base font-medium text-ds-ink-default-default"
          data-narrative-subagent-name
        >
          {agentName}
        </span>
        <span
          aria-live="polite"
          className={cn(
            'shrink-0 text-ds-text-meta font-normal',
            statusClassName
          )}
          data-narrative-subagent-status-label
        >
          {statusLabel}
        </span>
        <DsIcon
          icon={ChevronRight}
          className={cn(
            'text-ds-ink-subtle-default transition-[opacity,transform] duration-200',
            open
              ? 'rotate-90 opacity-100'
              : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:opacity-100'
          )}
          data-narrative-subagent-chevron
        />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="narrative-subagent-detail"
            {...disclosureMotion(reducedMotion)}
            className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-ds-6 overflow-hidden"
          >
            <span aria-hidden className="w-ds-icon-main" />
            <div
              className="flex w-full min-w-0 flex-col gap-ds-10 pt-ds-4"
              data-narrative-subagent-content
            >
              {reasoning ? (
                <span
                  className={cn(
                    'break-words whitespace-pre-wrap',
                    DERIVED_TEXT_CLASS
                  )}
                  data-narrative-subagent-reasoning
                >
                  {reasoning}
                </span>
              ) : null}
              <ToolInputOutputDetails
                appearance="code-scroll"
                description={description}
                input={call.input}
                inputLabel={call.inputLabel}
                output={call.output}
                outputLabel={call.outputLabel}
                showEmptyOutput={runActive && active && !call.output}
                emptyOutputText={t('chat.timeline-waiting-response', {
                  defaultValue: 'Waiting for a response.',
                })}
              />
              {item.children?.length ? (
                <div
                  className="flex min-w-0 flex-col gap-ds-stack-related"
                  data-narrative-subagent-children
                >
                  <NarrativeFlow
                    density={density}
                    items={item.children}
                    latestRunningCallId={latestRunningCallId}
                    reducedMotion={reducedMotion}
                    runActive={runActive}
                  />
                </div>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function NarrativePlan({
  item,
}: {
  item: Extract<TimelineNarrativeItem, { kind: 'plan' }>;
}) {
  const { node } = item;
  const heading = node.title?.trim() || node.summary?.trim();
  if (!heading && node.tasks.length === 0) return null;

  return (
    <div
      className="flex w-full min-w-0 flex-col gap-2"
      data-narrative-plan-id={node.id}
    >
      {heading ? <span className={PRIMARY_TEXT_CLASS}>{heading}</span> : null}
      {node.tasks.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {node.tasks.map((task) => (
            <li className={PRIMARY_TEXT_CLASS} key={task.id}>
              {task.title}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function NarrativeNotice({
  item,
}: {
  item: Extract<TimelineNarrativeItem, { kind: 'notice' }>;
}) {
  const { node } = item;
  const reason = taskErrorReason(node);
  if (reason) return <TaskErrorNotice reason={reason} />;
  if (node.writerWait) return <SpaceWaitNotice wait={node.writerWait} />;
  return (
    <span
      className={cn(
        DERIVED_TEXT_CLASS,
        node.severity === 'error' &&
          'text-ds-text-status-error-default-default',
        node.severity === 'warning' && 'text-ds-text-warning-strong-default',
        node.severity === 'success' && 'text-ds-text-success-default-default'
      )}
      data-narrative-notice-id={node.id}
    >
      {node.title ? `${node.title} · ` : ''}
      {node.content}
    </span>
  );
}

function NarrativeItem({
  item,
  density,
  interactivePlan,
  runActive,
  latestRunningCallId,
  reducedMotion,
}: {
  item: NarrativeStandaloneItem;
  density: NarrativeInformationDensity;
  interactivePlan?: InteractiveTimelinePlan;
  runActive: boolean;
  latestRunningCallId: string | null;
  reducedMotion: boolean;
}) {
  if (item.kind === 'plan') {
    if (item.node.eventId === interactivePlan?.eventId) {
      return (
        <div
          className="w-full min-w-0"
          data-narrative-plan-id={item.node.id}
          data-narrative-plan-interactive
        >
          {interactivePlan.content}
        </div>
      );
    }
    return <NarrativePlan item={item} />;
  }
  if (item.kind === 'notice') {
    return <NarrativeNotice item={item} />;
  }
  if (item.kind === 'subagent') {
    return (
      <NarrativeSubagentRow
        density={density}
        item={item}
        latestRunningCallId={latestRunningCallId}
        reducedMotion={reducedMotion}
        runActive={runActive}
      />
    );
  }
  return (
    <CallRow
      call={item.call}
      latestRunningCallId={latestRunningCallId}
      reducedMotion={reducedMotion}
      runActive={runActive}
    />
  );
}

/**
 * Workforce-only wrapper. The agent's name is the accordion trigger; their
 * narration and calls live inside so the work log reads as a roster of actors
 * rather than a flat stream with labels.
 */
function NarrativeAgentGroup({
  agentName,
  density,
  items,
  isLatest,
  animationsActive,
  runLive,
  latestRunningCallId,
  reducedMotion,
}: {
  agentName: string;
  density: NarrativeInformationDensity;
  items: readonly TimelineNarrativeItem[];
  isLatest: boolean;
  animationsActive: boolean;
  runLive: boolean;
  latestRunningCallId: string | null;
  reducedMotion: boolean;
}) {
  const ownsShimmer = items.some((item) =>
    itemOwnsCall(item, latestRunningCallId)
  );
  const autoOpen =
    !runLive ||
    isLatest ||
    ownsShimmer ||
    items.some(itemHasActiveCall) ||
    items.some(itemIsFailed);
  const [open, setOpen] = useState(autoOpen);
  const wasAutoOpen = useRef(autoOpen);

  useEffect(() => {
    if (autoOpen) setOpen(true);
    else if (wasAutoOpen.current) setOpen(false);
    wasAutoOpen.current = autoOpen;
  }, [autoOpen]);

  const shimmerOnLabel = !open && ownsShimmer;

  return (
    <div
      className="flex w-full min-w-0 flex-col"
      data-narrative-agent-group={agentName}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="group flex w-full min-w-0 items-center justify-start gap-1 px-0 py-1 text-left"
        data-narrative-agent-trigger
      >
        {shimmerOnLabel ? (
          <ShinyText
            speed={2.5}
            text={agentName}
            className="min-w-0 shrink overflow-hidden !text-ds-text-base !font-medium text-ellipsis whitespace-nowrap text-ds-ink-muted-default"
          />
        ) : (
          <span className="min-w-0 shrink overflow-hidden text-ds-text-base font-medium text-ellipsis whitespace-nowrap text-ds-ink-muted-default">
            {agentName}
          </span>
        )}
        <DsIcon
          icon={open ? ChevronDown : ChevronRight}
          className={cn(
            'text-ds-ink-muted-default transition-opacity duration-200',
            !open &&
              'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:opacity-100'
          )}
        />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="narrative-agent-group-body"
            {...disclosureMotion(reducedMotion)}
            className="overflow-hidden"
          >
            <div className="flex min-w-0 flex-col gap-ds-stack-related pt-ds-4">
              <NarrativeFlow
                density={density}
                items={items}
                latestRunningCallId={latestRunningCallId}
                reducedMotion={reducedMotion}
                runActive={animationsActive}
              />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/**
 * Pick the one call that owns the running shimmer. Narrative shows at most one
 * so a burst of parallel calls does not read as several competing cursors.
 */
function latestRunningCallId(
  items: readonly TimelineNarrativeItem[],
  runActive: boolean
): string | null {
  if (!runActive) return null;
  let latest: string | null = null;
  const visit = (entries: readonly TimelineNarrativeItem[]) => {
    for (const item of entries) {
      if (item.kind === 'segment') {
        for (const call of item.calls) {
          if (isCallActiveStatus(call.status)) latest = call.id;
        }
        continue;
      }
      if (item.kind === 'interrupt' && isCallActiveStatus(item.call.status)) {
        latest = item.call.id;
      }
      if (item.kind === 'subagent' && isCallActiveStatus(item.call.status)) {
        latest = item.call.id;
      }
      if (item.kind === 'subagent' && item.children?.length) {
        visit(item.children);
      }
    }
  };
  visit(items);
  return latest;
}

function NarrativeRunWorkLog({
  run,
  items,
  paused,
  workforce,
  interactivePlan,
}: {
  run: TimelineRunView;
  items: readonly TimelineNarrativeItem[];
  paused: boolean;
  workforce: boolean;
  interactivePlan?: InteractiveTimelinePlan;
}) {
  const { t } = useTranslation();
  const fallbackAgentName = t('chat.agent', { defaultValue: 'Agent' });
  const entries = useMemo(
    () => groupNarrativeWork(items, workforce, fallbackAgentName),
    [fallbackAgentName, items, workforce]
  );
  const live = isActiveRunStatus(run.status);
  // Pausing stops the shimmer but must not collapse the log: the user is still
  // in the middle of this Run, so only a terminal status folds it away.
  const animationsActive = live && !paused;
  const runningCallId = useMemo(
    () => latestRunningCallId(items, animationsActive),
    [animationsActive, items]
  );
  const reducedMotion = Boolean(useReducedMotion());
  const density = usePageTabStore(
    (state) =>
      state.narrativeInformationDensity ?? DEFAULT_NARRATIVE_INFORMATION_DENSITY
  );
  // Density changes only action presentation. It never hides all narration.
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const open = manualOpen ?? !isTerminalRunStatus(run.status);
  const lastAgentIndex = entries.findLastIndex(
    (entry) => entry.kind === 'agent'
  );

  if (items.length === 0) {
    // Lifecycle/time belongs to the Task, not to the availability of tool
    // rows. Keep its receipt visible even before older work-log pages arrive.
    return isTerminalRunStatus(run.status) ? (
      <div
        className="w-full border-x-0 border-t-0 border-b border-solid border-ds-hairline-subtle-default py-ds-8"
        data-narrative-run-summary
      >
        <span className="text-ds-text-base font-medium text-ds-ink-muted-default">
          <NarrativeWorkLogSummary paused={paused} run={run} />
        </span>
      </div>
    ) : null;
  }

  return (
    <motion.div
      {...eventEntryMotion(reducedMotion)}
      className="flex w-full min-w-0 flex-col"
      data-narrative-run-motion={reducedMotion ? 'reduced' : 'standard'}
      data-narrative-run-motion-id={run.id}
      data-narrative-run-work-log
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setManualOpen(!open);
        }}
        className="group flex w-full min-w-0 items-center justify-start gap-1 border-x-0 border-t-0 border-b border-solid border-ds-hairline-subtle-default px-0 py-2 text-left"
      >
        <span className="text-ds-text-base font-medium text-ds-ink-muted-default">
          <NarrativeWorkLogSummary paused={paused} run={run} />
        </span>
        <DsIcon
          icon={open ? ChevronDown : ChevronRight}
          className={cn(
            'text-ds-ink-muted-default transition-opacity duration-200',
            !open &&
              'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:opacity-100'
          )}
        />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="narrative-work-log-body"
            {...disclosureMotion(reducedMotion)}
            className="overflow-hidden"
          >
            <div
              className="flex min-w-0 flex-col gap-ds-stack-related py-ds-8"
              data-narrative-timeline
            >
              <AnimatePresence initial={false}>
                {entries.map((entry, index) =>
                  entry.kind === 'agent' ? (
                    <motion.div
                      {...itemFadeMotion(reducedMotion)}
                      data-narrative-event-motion
                      data-narrative-event-motion-id={entry.id}
                      key={entry.id}
                    >
                      <NarrativeAgentGroup
                        agentName={entry.agentName}
                        density={density}
                        animationsActive={animationsActive}
                        isLatest={index === lastAgentIndex}
                        items={entry.items}
                        latestRunningCallId={runningCallId}
                        reducedMotion={reducedMotion}
                        runLive={live}
                      />
                    </motion.div>
                  ) : (
                    <NarrativeFlow
                      density={density}
                      interactivePlan={interactivePlan}
                      items={entry.items}
                      key={entry.id}
                      latestRunningCallId={runningCallId}
                      reducedMotion={reducedMotion}
                      runActive={animationsActive}
                    />
                  )
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

export function NarrativeTimeline({
  runs,
  resolvedModelsByRun = {},
  projectedArtifactsByRun = {},
  artifactManifestsByRun = {},
  interactivePlansByRun = {},
  paused = false,
  sessionMode,
  onEditUserMessage,
}: TimelineModeProps & { sessionMode?: SessionModeType }) {
  const workforce = sessionMode === SessionMode.WORKFORCE;
  return (
    <div className="flex w-full flex-col gap-3" data-timeline-mode="narrative">
      {runs.map((run, index) => {
        const projectedArtifacts = projectedArtifactsByRun[run.runId];
        const artifactManifest = artifactManifestsByRun[run.runId];
        const interactivePlan = interactivePlansByRun[run.runId];
        const narrativeItems = segmentTimelineRun(
          run,
          interactivePlan?.eventId
        );
        const hasWorkBand = narrativeItems.length > 0;
        const hasFiles =
          run.artifacts.length > 0 ||
          projectedArtifacts !== undefined ||
          artifactManifest !== undefined;
        const showFiles = isTerminalRunStatus(run.status) && hasFiles;
        return (
          <section
            className="flex w-full flex-col gap-3"
            data-run-id={run.runId}
            key={run.id}
          >
            {index > 0 ? (
              <ModelChangeDivider
                previous={resolvedModelsByRun[runs[index - 1].runId]}
                current={resolvedModelsByRun[run.runId]}
              />
            ) : null}
            {run.userQuery ? (
              <UserMessageCard
                attaches={run.userQuery.attachments}
                content={run.userQuery.content}
                id={run.userQuery.id}
                createdAt={run.userQuery.createdAt}
                onEditAndResend={
                  onEditUserMessage
                    ? () =>
                        onEditUserMessage({
                          id: run.userQuery!.id,
                          content: run.userQuery!.content,
                          attaches: run.userQuery!.attachments,
                        })
                    : undefined
                }
              />
            ) : null}
            {isActiveRunStatus(run.status) && !hasWorkBand ? (
              <PreparingToExecuteTasks />
            ) : null}
            <NarrativeRunWorkLog
              items={narrativeItems}
              paused={paused}
              run={run}
              workforce={workforce}
              interactivePlan={interactivePlan}
            />
            {run.finalAssistantResponse ? (
              <AgentMessageCard
                content={run.finalAssistantResponse.content}
                deferredFooter={
                  showFiles ? (
                    <RunFilesGroup
                      artifactNodes={run.artifacts}
                      projectedArtifacts={projectedArtifacts}
                      artifactManifest={artifactManifest}
                      projectId={run.projectId}
                      runId={run.runId}
                    />
                  ) : undefined
                }
                feedbackMessageId={
                  run.finalAssistantResponse.messageId ??
                  run.finalAssistantResponse.sourceEventId
                }
                feedbackRunId={run.runId}
                id={run.finalAssistantResponse.id}
                messageStep={AgentStep.END}
                typewriter={isActiveRunStatus(run.status)}
              />
            ) : null}
            {!run.finalAssistantResponse && showFiles ? (
              <RunFilesGroup
                artifactNodes={run.artifacts}
                projectedArtifacts={projectedArtifacts}
                artifactManifest={artifactManifest}
                projectId={run.projectId}
                runId={run.runId}
              />
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
