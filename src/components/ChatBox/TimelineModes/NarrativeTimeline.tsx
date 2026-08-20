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
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { CallRow, isCallActiveStatus } from './CallRow';
import { RunFilesGroup } from './RunFiles';
import {
  disclosureMotion,
  eventEntryMotion,
  isActiveRunStatus,
  RunElapsed,
  type TimelineModeProps,
} from './shared';

/**
 * Primary text is reserved for language the agent produced itself. Anything
 * this frontend derived from toolkit and method names stays in the subdued
 * label treatment, so the reader can always tell narration from inference.
 */
const PRIMARY_TEXT_CLASS =
  'text-body-sm font-normal text-ds-text-neutral-default-default';
const DERIVED_TEXT_CLASS =
  '!text-label-sm font-normal text-ds-text-neutral-subtle-default';

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
  showAgentName,
  runActive,
  latestRunningCallId,
  reducedMotion,
}: {
  segment: TimelineSegment;
  /** True when this segment starts a new actor's stretch of work. */
  showAgentName: boolean;
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
      className="flex w-full min-w-0 flex-col gap-1"
      data-narrative-segment-id={segment.id}
      data-narrative-segment-source={segment.source}
      data-narrative-segment-status={segment.status}
    >
      {showAgentName && segment.agentName ? (
        <span
          className="!text-label-xs font-medium text-ds-text-neutral-muted-default"
          data-narrative-segment-agent={segment.agentName}
        >
          {segment.agentName}
        </span>
      ) : null}
      {segment.narration ? (
        <span
          className={cn('whitespace-pre-wrap break-words', PRIMARY_TEXT_CLASS)}
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
            className="group inline-flex min-w-0 max-w-full items-center gap-1 self-start px-0 py-0.5 text-left transition-opacity hover:opacity-80"
            data-narrative-segment-trigger
          >
            {shimmerOnLabel ? (
              <ShinyText
                speed={2.5}
                text={segment.label}
                className={cn(
                  'min-w-0 shrink overflow-hidden text-ellipsis whitespace-nowrap !font-normal',
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
                  : 'text-ds-icon-neutral-subtle-default',
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
                <div className="flex min-w-0 flex-col gap-1 pl-3 pt-1">
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
      className="flex w-full min-w-0 flex-col gap-1"
      data-narrative-plan-id={node.id}
    >
      {heading ? <span className={PRIMARY_TEXT_CLASS}>{heading}</span> : null}
      {node.tasks.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
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
        node.severity === 'warning' &&
          'text-ds-text-status-warning-default-default'
      )}
      data-narrative-notice-id={node.id}
    >
      {node.title ? `${node.title} · ` : ''}
      {node.content}
    </span>
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
  paused,
}: {
  run: TimelineRunView;
  paused: boolean;
}) {
  const items = useMemo(() => segmentTimelineRun(run), [run]);
  const live = isActiveRunStatus(run.status);
  // Pausing stops the shimmer but must not collapse the log: the user is still
  // in the middle of this Run, so only a terminal status folds it away.
  const active = live && !paused;
  const runningCallId = useMemo(
    () => latestRunningCallId(items, active),
    [active, items]
  );
  const reducedMotion = Boolean(useReducedMotion());
  const [open, setOpen] = useState(live);
  const wasLive = useRef(live);

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
        className="flex w-full min-w-0 items-center justify-start gap-1 border-x-0 border-b border-t-0 border-solid border-ds-border-neutral-subtle-default px-0 py-2 text-left"
      >
        <span className="text-body-sm font-medium text-ds-text-neutral-muted-default">
          {workLogSummary(run, paused)} <RunElapsed paused={paused} run={run} />
        </span>
        {open ? (
          <ChevronDown
            aria-hidden
            className="size-4 shrink-0 text-ds-icon-neutral-muted-default"
          />
        ) : (
          <ChevronRight
            aria-hidden
            className="size-4 shrink-0 text-ds-icon-neutral-muted-default"
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
              {items.map((item, index) => {
                if (item.kind === 'segment') {
                  // Workforce loses its per-agent accordion in narrative mode,
                  // so attribution rides on the segment where the actor
                  // changes. Single-agent runs never show a name.
                  const previous = items
                    .slice(0, index)
                    .findLast((candidate) => candidate.kind === 'segment');
                  const showAgentName =
                    previous?.kind !== 'segment' ||
                    previous.agentName !== item.agentName;
                  return (
                    <NarrativeSegment
                      key={item.id}
                      latestRunningCallId={runningCallId}
                      reducedMotion={reducedMotion}
                      runActive={active}
                      segment={item}
                      showAgentName={showAgentName}
                    />
                  );
                }
                if (item.kind === 'plan') {
                  return <NarrativePlan item={item} key={item.id} />;
                }
                if (item.kind === 'notice') {
                  return <NarrativeNotice item={item} key={item.id} />;
                }
                return (
                  <CallRow
                    call={item.call}
                    key={item.id}
                    latestRunningCallId={runningCallId}
                    reducedMotion={reducedMotion}
                    runActive={active}
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
  paused = false,
}: TimelineModeProps) {
  return (
    <div className="flex w-full flex-col gap-3" data-timeline-mode="narrative">
      {runs.map((run) => {
        const projectedArtifacts = projectedArtifactsByRun[run.runId] || [];
        const hasExecutionRows = run.traceRows.length > 0;
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
            {isActiveRunStatus(run.status) && !hasExecutionRows ? (
              <PreparingToExecuteTasks />
            ) : null}
            <NarrativeRunWorkLog paused={paused} run={run} />
            {run.finalAssistantResponse ? (
              <AgentMessageCard
                content={run.finalAssistantResponse.content}
                deferredFooter={
                  <RunFilesGroup
                    artifactNodes={run.artifacts}
                    projectedArtifacts={projectedArtifacts}
                    runId={run.runId}
                  />
                }
                id={run.finalAssistantResponse.id}
                typewriter={isActiveRunStatus(run.status)}
              />
            ) : run.artifacts.length > 0 || projectedArtifacts.length > 0 ? (
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
