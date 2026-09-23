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
import { CreateAutomationFromTask } from '@/components/ChatBox/MessageItem/CreateAutomationFromTask';
import { PreparingToExecuteTasks } from '@/components/ChatBox/MessageItem/PreparingToExecuteTasks';
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
import { SessionMode, type SessionModeType } from '@/types/constants';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { TaskErrorNotice } from '../TaskErrorNotice';
import { taskErrorReason } from '../taskErrorPresentation';

import { actionIcon } from './actionIcon';
import { CallRow, isCallActiveStatus, isCallErrorStatus } from './CallRow';
import { ModelChangeDivider } from './ModelChangeDivider';
import { RunFilesGroup } from './RunFiles';
import {
  disclosureMotion,
  eventEntryMotion,
  type InteractiveTimelinePlan,
  isActiveRunStatus,
  isTerminalRunStatus,
  RunActivityIndicator,
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
  | { kind: 'item'; item: TimelineNarrativeItem };

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
    return items.map((item) => ({ kind: 'item', item }));
  }

  const entries: NarrativeWorkEntry[] = [];
  for (const item of items) {
    const agent = narrativeItemAgent(item, fallbackAgentName);
    if (!agent) {
      entries.push({ kind: 'item', item });
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

function NarrativeToolGroup({
  calls,
  label,
  runActive,
  latestRunningCallId,
  reducedMotion,
}: {
  calls: readonly TimelineCall[];
  label?: string;
  runActive: boolean;
  latestRunningCallId: string | null;
  reducedMotion: boolean;
}) {
  const { t } = useTranslation();
  const autoOpen = calls.some((call) => isCallErrorStatus(call.status));
  const [open, setOpen] = useState(autoOpen);
  const wasAutoOpen = useRef(autoOpen);

  useEffect(() => {
    if (autoOpen) setOpen(true);
    else if (wasAutoOpen.current) setOpen(false);
    wasAutoOpen.current = autoOpen;
  }, [autoOpen]);

  const callCount = calls.length;
  const actionKinds = useMemo(
    () => [...new Set(calls.map((call) => call.actionKind))],
    [calls]
  );
  // The group owns only structure. Individual CallRows own invocation titles,
  // so a one-call group never repeats its child's title in the header.
  const toolGroupLabel =
    label ??
    t('chat.timeline-action-count', {
      defaultValue_one: '{{count}} action',
      defaultValue_other: '{{count}} actions',
      count: callCount,
    });
  // A closed segment hides the running call, so the shimmer moves up to the
  // label. Opening it hands the shimmer back to the call that owns it, which
  // keeps exactly one live indicator on screen either way.
  const ownsRunningCall = calls.some((call) => call.id === latestRunningCallId);
  const shimmerOnLabel = !open && ownsRunningCall;

  return (
    <div className="flex w-full min-w-0 flex-col items-start">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'group inline-flex max-w-full min-w-0 items-center gap-ds-6 self-start rounded-ds-compact-control px-0 py-ds-2 text-left text-ds-ink-muted-default transition-colors hover:text-ds-ink-default-default focus-visible:text-ds-ink-default-default',
          DS_FOCUS_RING
        )}
        data-narrative-segment-call-count={callCount}
        data-narrative-segment-trigger
      >
        <span
          aria-hidden
          className="inline-flex shrink-0 items-center gap-ds-6"
          data-narrative-segment-action-icons
        >
          {actionKinds.map((kind) => (
            <DsIcon
              icon={actionIcon(kind)}
              key={kind}
              recipe="main"
              data-narrative-segment-action-icon={kind}
            />
          ))}
        </span>
        {shimmerOnLabel ? (
          <ShinyText
            speed={2.5}
            text={toolGroupLabel}
            className="min-w-0 shrink overflow-hidden !text-ds-text-base !font-normal text-ellipsis whitespace-nowrap group-hover:!bg-none group-hover:!text-ds-ink-default-default group-focus-visible:!bg-none group-focus-visible:!text-ds-ink-default-default"
          />
        ) : (
          <span className="min-w-0 shrink overflow-hidden !text-ds-text-base font-normal text-ellipsis whitespace-nowrap">
            {toolGroupLabel}
          </span>
        )}
        <DsIcon
          icon={ChevronRight}
          className={cn(
            'opacity-0 transition-[opacity,transform] duration-200 group-hover:opacity-100 group-focus-visible:opacity-100',
            open && 'rotate-90 opacity-100'
          )}
          data-narrative-segment-chevron
        />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="narrative-segment-detail"
            {...disclosureMotion(reducedMotion)}
            className="w-full min-w-0 overflow-hidden"
          >
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

/** A missing toolkit identity cannot justify folding unrelated calls. */
function groupCallsByToolkit(calls: readonly TimelineCall[]): TimelineCall[][] {
  const groups: TimelineCall[][] = [];
  for (const call of calls) {
    const toolkit = call.toolkitName?.trim();
    const previous = groups.at(-1);
    if (toolkit && previous?.[0]?.toolkitName?.trim() === toolkit) {
      previous.push(call);
    } else {
      groups.push([call]);
    }
  }
  return groups;
}

function toolkitGroupLabel(calls: readonly TimelineCall[]): string {
  const toolkit = calls[0]?.toolkitName?.trim() || '';
  const descriptions = [
    ...new Set(
      calls.map((call) =>
        (call.methodName?.trim() || call.title.trim()).replaceAll('_', ' ')
      )
    ),
  ];
  return [toolkit, descriptions.join(', ')].filter(Boolean).join(' · ');
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
            'text-ds-ink-subtle-default transition-transform duration-200',
            open && 'rotate-90'
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
                  <AnimatePresence initial={false}>
                    {item.children.map((child) => (
                      <motion.div
                        {...itemFadeMotion(reducedMotion)}
                        data-narrative-event-motion
                        data-narrative-event-motion-id={child.id}
                        key={child.id}
                      >
                        <NarrativeItem
                          density={density}
                          item={child}
                          latestRunningCallId={latestRunningCallId}
                          reducedMotion={reducedMotion}
                          runActive={runActive}
                        />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** One unit of reasoning followed by calls in their projected order. */
function NarrativeSegment({
  segment,
  density,
  runActive,
  latestRunningCallId,
  reducedMotion,
}: {
  segment: TimelineSegment;
  density: NarrativeInformationDensity;
  runActive: boolean;
  latestRunningCallId: string | null;
  reducedMotion: boolean;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-ds-stack-related',
        segment.parentStepId
          ? 'ml-4 w-[calc(100%-1rem)] border-x-0 border-t-0 border-r-0 border-b-0 border-solid border-ds-border-neutral-subtle-default pl-3'
          : 'w-full'
      )}
      data-narrative-segment-id={segment.id}
      data-narrative-segment-source={segment.source}
      data-narrative-segment-status={segment.status}
      data-narrative-parent-step-id={segment.parentStepId}
    >
      {segment.narration || segment.summary ? (
        <div className="flex min-w-0 flex-col gap-ds-stack-related">
          {segment.narration ? (
            <span
              className={cn(
                'break-words whitespace-pre-wrap',
                PRIMARY_TEXT_CLASS
              )}
              data-narrative-segment-narration
            >
              {segment.narration}
            </span>
          ) : null}
          {segment.summary ? (
            <span
              className={cn(
                'break-words whitespace-pre-wrap',
                DERIVED_TEXT_CLASS
              )}
              data-narrative-segment-summary
            >
              {segment.summary}
            </span>
          ) : null}
        </div>
      ) : null}
      {segment.calls.length > 0 && density === 'compact' ? (
        <NarrativeToolGroup
          calls={segment.calls}
          latestRunningCallId={latestRunningCallId}
          reducedMotion={reducedMotion}
          runActive={runActive}
        />
      ) : null}
      {density === 'balanced'
        ? groupCallsByToolkit(segment.calls).map((calls) =>
            calls.length === 1 ? (
              <CallRow
                call={calls[0]}
                key={calls[0].id}
                latestRunningCallId={latestRunningCallId}
                reducedMotion={reducedMotion}
                runActive={runActive}
              />
            ) : (
              <NarrativeToolGroup
                calls={calls}
                key={calls[0].id}
                label={toolkitGroupLabel(calls)}
                latestRunningCallId={latestRunningCallId}
                reducedMotion={reducedMotion}
                runActive={runActive}
              />
            )
          )
        : null}
      {density === 'expanded'
        ? segment.calls.map((call) => (
            <CallRow
              call={call}
              key={call.id}
              latestRunningCallId={latestRunningCallId}
              reducedMotion={reducedMotion}
              runActive={runActive}
            />
          ))
        : null}
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
  item: TimelineNarrativeItem;
  density: NarrativeInformationDensity;
  interactivePlan?: InteractiveTimelinePlan;
  runActive: boolean;
  latestRunningCallId: string | null;
  reducedMotion: boolean;
}) {
  if (item.kind === 'segment') {
    return (
      <NarrativeSegment
        density={density}
        latestRunningCallId={latestRunningCallId}
        reducedMotion={reducedMotion}
        runActive={runActive}
        segment={item}
      />
    );
  }
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
        className="flex w-full min-w-0 items-center justify-start gap-1 px-0 py-1 text-left"
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
          className="text-ds-ink-muted-default"
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
              <AnimatePresence initial={false}>
                {items.map((item) => (
                  <motion.div
                    {...itemFadeMotion(reducedMotion)}
                    data-narrative-event-motion
                    data-narrative-event-motion-id={item.id}
                    key={item.id}
                  >
                    <NarrativeItem
                      density={density}
                      item={item}
                      latestRunningCallId={latestRunningCallId}
                      reducedMotion={reducedMotion}
                      runActive={animationsActive}
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
  const defaultOpen = true;
  const [open, setOpen] = useState(defaultOpen);
  const manuallyToggled = useRef(false);
  const lastAgentIndex = entries.findLastIndex(
    (entry) => entry.kind === 'agent'
  );

  useEffect(() => {
    if (!manuallyToggled.current) setOpen(defaultOpen);
  }, [defaultOpen]);

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
          manuallyToggled.current = true;
          setOpen((value) => !value);
        }}
        className="flex w-full min-w-0 items-center justify-start gap-1 border-x-0 border-t-0 border-b border-solid border-ds-hairline-subtle-default px-0 py-2 text-left"
      >
        <span className="text-ds-text-base font-medium text-ds-ink-muted-default">
          <NarrativeWorkLogSummary paused={paused} run={run} />
        </span>
        <DsIcon
          icon={open ? ChevronDown : ChevronRight}
          className="text-ds-ink-muted-default"
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
                {entries.map((entry, index) => {
                  const entryId =
                    entry.kind === 'agent' ? entry.id : entry.item.id;
                  return (
                    <motion.div
                      {...itemFadeMotion(reducedMotion)}
                      data-narrative-event-motion
                      data-narrative-event-motion-id={entryId}
                      key={entryId}
                    >
                      {entry.kind === 'agent' ? (
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
                      ) : (
                        <NarrativeItem
                          density={density}
                          interactivePlan={interactivePlan}
                          item={entry.item}
                          latestRunningCallId={runningCallId}
                          reducedMotion={reducedMotion}
                          runActive={animationsActive}
                        />
                      )}
                    </motion.div>
                  );
                })}
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
              <>
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
                  id={run.finalAssistantResponse.id}
                  typewriter={isActiveRunStatus(run.status)}
                />
                {run.status === 'completed' && run.userQuery?.content ? (
                  <CreateAutomationFromTask
                    projectId={run.projectId}
                    taskPrompt={run.userQuery.content}
                    resultContent={run.finalAssistantResponse.content}
                  />
                ) : null}
              </>
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
            {run.status === 'running' && !paused && hasWorkBand ? (
              <RunActivityIndicator />
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
