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
import { UserMessageCard } from '@/components/ChatBox/MessageItem/UserMessageCard';
import ShinyText from '@/components/ui/ShinyText/ShinyText';
import {
  segmentDefaultsOpen,
  segmentTimelineRun,
  type TimelineNarrativeItem,
  type TimelineRunView,
  type TimelineSegment,
} from '@/lib/projector/chat/presentation';
import { cn } from '@/lib/utils';
import { SessionMode, type SessionModeType } from '@/types/constants';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { CallRow, isCallActiveStatus, isCallErrorStatus } from './CallRow';
import { RunFilesGroup } from './RunFiles';
import {
  disclosureMotion,
  eventEntryMotion,
  type InteractiveTimelinePlan,
  isActiveRunStatus,
  isTerminalRunStatus,
  RunElapsed,
  type TimelineModeProps,
} from './shared';

/**
 * Primary text is reserved for language the agent produced itself. Anything
 * this frontend derived from toolkit and method names stays in the subdued
 * label treatment, so the reader can always tell narration from inference.
 */
const PRIMARY_TEXT_CLASS =
  '!text-ds-text-base font-normal text-ds-ink-default-default';
const DERIVED_TEXT_CLASS =
  '!text-ds-text-base font-normal text-ds-ink-default-default';

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
  item: TimelineNarrativeItem
): { id: string; name: string } | null {
  if (item.kind === 'segment') {
    const id = (item.agentId || item.agentName || '').trim();
    if (!id) return null;
    return { id, name: item.agentName?.trim() || 'Agent' };
  }
  if (item.kind === 'interrupt') {
    const id = (item.call.agentId || item.call.agentName || '').trim();
    if (!id) return null;
    return { id, name: item.call.agentName?.trim() || 'Agent' };
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
  return false;
}

function itemHasActiveCall(item: TimelineNarrativeItem): boolean {
  if (item.kind === 'segment') {
    return item.calls.some((call) => isCallActiveStatus(call.status));
  }
  if (item.kind === 'interrupt') return isCallActiveStatus(item.call.status);
  return false;
}

function itemIsFailed(item: TimelineNarrativeItem): boolean {
  if (item.kind === 'segment') return isCallErrorStatus(item.status);
  if (item.kind === 'interrupt') return isCallErrorStatus(item.call.status);
  return false;
}

/**
 * Workforce folds contiguous work from one actor into a nested accordion.
 * Plans, notices, and unattributed interrupts stay at the work-log level so
 * they keep their chronological position. Single-agent stays a flat list.
 */
function groupNarrativeWork(
  items: readonly TimelineNarrativeItem[],
  workforce: boolean
): NarrativeWorkEntry[] {
  if (!workforce) {
    return items.map((item) => ({ kind: 'item', item }));
  }

  const entries: NarrativeWorkEntry[] = [];
  for (const item of items) {
    const agent = narrativeItemAgent(item);
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

function workLogSummary(run: TimelineRunView, paused: boolean): string {
  if (paused && isActiveRunStatus(run.status)) return 'Paused after';
  if (isActiveRunStatus(run.status)) return 'Working on tasks for';
  if (run.status === 'failed') return 'Failed after';
  if (run.status === 'interrupted') return 'Interrupted after';
  if (run.status === 'cancelled') return 'Stopped after';
  return 'Worked for';
}

/**
 * One unit of work: the agent's narration, then a folded disclosure holding
 * the calls it made. The disclosure reuses the same rows the trajectory
 * timeline renders, so drilling in never requires switching modes.
 */
function NarrativeSegment({
  segment,
  runActive,
  latestRunningCallId,
  reducedMotion,
}: {
  segment: TimelineSegment;
  runActive: boolean;
  latestRunningCallId: string | null;
  reducedMotion: boolean;
}) {
  const autoOpen = segmentDefaultsOpen(segment);
  const [open, setOpen] = useState(autoOpen);
  const wasAutoOpen = useRef(autoOpen);

  useEffect(() => {
    if (autoOpen) setOpen(true);
    else if (wasAutoOpen.current) setOpen(false);
    wasAutoOpen.current = autoOpen;
  }, [autoOpen]);

  const hasCalls = segment.calls.length > 0;
  // With no narration the derived label is the only text there is, so it is
  // promoted to primary rather than leaving the segment visually empty.
  const labelIsOnlyText = !segment.narration;
  // A closed segment hides the running call, so the shimmer moves up to the
  // label. Opening it hands the shimmer back to the call that owns it, which
  // keeps exactly one live indicator on screen either way.
  const ownsRunningCall = segment.calls.some(
    (call) => call.id === latestRunningCallId
  );
  const shimmerOnLabel = !open && ownsRunningCall;

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-2',
        segment.parentStepId
          ? 'ml-4 w-[calc(100%-1rem)] border-x-0 border-t-0 border-r-0 border-b-0 border-solid border-ds-border-neutral-subtle-default pl-3'
          : 'w-full'
      )}
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
      {hasCalls ? (
        <div className="flex w-full min-w-0 flex-col items-start">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="group inline-flex max-w-full min-w-0 items-center gap-1 self-start px-0 py-0.5 text-left opacity-60 transition-opacity hover:opacity-100"
            data-narrative-segment-trigger
          >
            {shimmerOnLabel ? (
              <ShinyText
                speed={2.5}
                text={segment.label}
                className={cn(
                  'min-w-0 shrink overflow-hidden !font-normal text-ellipsis whitespace-nowrap',
                  labelIsOnlyText ? PRIMARY_TEXT_CLASS : DERIVED_TEXT_CLASS
                )}
              />
            ) : (
              <span
                className={cn(
                  'min-w-0 shrink overflow-hidden text-ellipsis whitespace-nowrap',
                  labelIsOnlyText ? PRIMARY_TEXT_CLASS : DERIVED_TEXT_CLASS,
                  segment.status === 'failed' &&
                    'text-ds-text-status-error-default-default'
                )}
              >
                {segment.label}
              </span>
            )}
            <ChevronRight
              aria-hidden
              className={cn(
                'size-4 shrink-0 transition-[opacity,transform] duration-200',
                segment.status === 'failed'
                  ? 'text-ds-text-status-error-default-default'
                  : 'text-ds-ink-subtle-default',
                open
                  ? 'rotate-90 opacity-100'
                  : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'
              )}
            />
          </button>
          <AnimatePresence initial={false}>
            {open ? (
              <motion.div
                key="narrative-segment-detail"
                {...disclosureMotion(reducedMotion)}
                className="w-full min-w-0 overflow-hidden"
              >
                <div className="flex min-w-0 flex-col gap-1 pt-1">
                  {segment.calls.map((call) => (
                    <CallRow
                      call={call}
                      key={call.id}
                      latestRunningCallId={latestRunningCallId}
                      reducedMotion={reducedMotion}
                      runActive={runActive}
                    />
                  ))}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      ) : null}
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
  interactivePlan,
  runActive,
  latestRunningCallId,
  reducedMotion,
}: {
  item: TimelineNarrativeItem;
  interactivePlan?: InteractiveTimelinePlan;
  runActive: boolean;
  latestRunningCallId: string | null;
  reducedMotion: boolean;
}) {
  if (item.kind === 'segment') {
    return (
      <NarrativeSegment
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
  items,
  isLatest,
  animationsActive,
  runLive,
  latestRunningCallId,
  reducedMotion,
}: {
  agentName: string;
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
        {open ? (
          <ChevronDown
            aria-hidden
            className="size-4 shrink-0 text-ds-ink-muted-default"
          />
        ) : (
          <ChevronRight
            aria-hidden
            className="size-4 shrink-0 text-ds-ink-muted-default"
          />
        )}
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="narrative-agent-group-body"
            {...disclosureMotion(reducedMotion)}
            className="overflow-hidden"
          >
            <div className="flex min-w-0 flex-col gap-2 pt-1">
              {items.map((item) => (
                <NarrativeItem
                  item={item}
                  key={item.id}
                  latestRunningCallId={latestRunningCallId}
                  reducedMotion={reducedMotion}
                  runActive={animationsActive}
                />
              ))}
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
  for (const item of items) {
    if (item.kind === 'segment') {
      for (const call of item.calls) {
        if (isCallActiveStatus(call.status)) latest = call.id;
      }
      continue;
    }
    if (item.kind === 'interrupt' && isCallActiveStatus(item.call.status)) {
      latest = item.call.id;
    }
  }
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
  const entries = useMemo(
    () => groupNarrativeWork(items, workforce),
    [items, workforce]
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
  const [open, setOpen] = useState(live);
  const wasLive = useRef(live);
  const lastAgentIndex = entries.findLastIndex(
    (entry) => entry.kind === 'agent'
  );

  useEffect(() => {
    if (live) setOpen(true);
    else if (wasLive.current) setOpen(false);
    wasLive.current = live;
  }, [live]);

  if (items.length === 0) return null;

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
        onClick={() => setOpen((value) => !value)}
        className="flex w-full min-w-0 items-center justify-start gap-1 border-x-0 border-t-0 border-b border-solid border-ds-hairline-subtle-default px-0 py-2 text-left"
      >
        <span className="text-ds-text-base font-medium text-ds-ink-muted-default">
          {workLogSummary(run, paused)} <RunElapsed paused={paused} run={run} />
        </span>
        {open ? (
          <ChevronDown
            aria-hidden
            className="size-4 shrink-0 text-ds-ink-muted-default"
          />
        ) : (
          <ChevronRight
            aria-hidden
            className="size-4 shrink-0 text-ds-ink-muted-default"
          />
        )}
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="narrative-work-log-body"
            {...disclosureMotion(reducedMotion)}
            className="overflow-hidden"
          >
            <div
              className="flex min-w-0 flex-col gap-3 py-2"
              data-narrative-timeline
            >
              {entries.map((entry, index) => {
                if (entry.kind === 'agent') {
                  return (
                    <NarrativeAgentGroup
                      agentName={entry.agentName}
                      animationsActive={animationsActive}
                      isLatest={index === lastAgentIndex}
                      items={entry.items}
                      key={entry.id}
                      latestRunningCallId={runningCallId}
                      reducedMotion={reducedMotion}
                      runLive={live}
                    />
                  );
                }
                return (
                  <NarrativeItem
                    interactivePlan={interactivePlan}
                    item={entry.item}
                    key={entry.item.id}
                    latestRunningCallId={runningCallId}
                    reducedMotion={reducedMotion}
                    runActive={animationsActive}
                  />
                );
              })}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

export function NarrativeTimeline({
  runs,
  projectedArtifactsByRun = {},
  interactivePlansByRun = {},
  paused = false,
  sessionMode,
}: TimelineModeProps & { sessionMode?: SessionModeType }) {
  const workforce = sessionMode === SessionMode.WORKFORCE;
  return (
    <div className="flex w-full flex-col gap-3" data-timeline-mode="narrative">
      {runs.map((run) => {
        const projectedArtifacts = projectedArtifactsByRun[run.runId] || [];
        const interactivePlan = interactivePlansByRun[run.runId];
        const narrativeItems = segmentTimelineRun(
          run,
          interactivePlan?.eventId
        );
        const hasWorkBand = narrativeItems.length > 0;
        const hasFiles =
          run.artifacts.length > 0 || projectedArtifacts.length > 0;
        const showFiles = isTerminalRunStatus(run.status) && hasFiles;
        return (
          <section
            className="flex w-full flex-col gap-3"
            data-run-id={run.runId}
            key={run.id}
          >
            {run.userQuery ? (
              <UserMessageCard
                attaches={run.userQuery.attachments}
                content={run.userQuery.content}
                id={run.userQuery.id}
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
                      runId={run.runId}
                    />
                  ) : undefined
                }
                id={run.finalAssistantResponse.id}
                typewriter={isActiveRunStatus(run.status)}
              />
            ) : null}
            {!run.finalAssistantResponse && showFiles ? (
              <RunFilesGroup
                artifactNodes={run.artifacts}
                projectedArtifacts={projectedArtifacts}
                runId={run.runId}
              />
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
