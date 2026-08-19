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
import { ToolInputOutputDetails } from '@/components/ChatBox/MessageItem/ToolInputOutputDetails';
import { UserMessageCard } from '@/components/ChatBox/MessageItem/UserMessageCard';
import ShinyText from '@/components/ui/ShinyText/ShinyText';
import type {
  TimelineRunView,
  TimelineToolInvocation,
  TimelineTraceRow,
} from '@/lib/projector/chat/presentation';
import type { ProjectedArtifact } from '@/lib/projector/types';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { RunFilesGroup } from './RunFiles';
import { isActiveRunStatus, RunElapsed, StatusInline } from './shared';

const CONTENT_EASE: [number, number, number, number] = [0.32, 0.72, 0, 1];
const HEIGHT_MOTION = {
  height: { duration: 0.22, ease: CONTENT_EASE },
  opacity: { duration: 0.16, ease: CONTENT_EASE },
} as const;

export interface TimelineModeProps {
  runs: readonly TimelineRunView[];
  projectedArtifactsByRun?: Readonly<Record<string, ProjectedArtifact[]>>;
}

function NormalToolRow({ invocation }: { invocation: TimelineToolInvocation }) {
  const active =
    invocation.status === 'running' || invocation.status === 'pending';
  const [open, setOpen] = useState(active);
  const wasActive = useRef(active);

  useEffect(() => {
    if (active) setOpen(true);
    else if (wasActive.current) setOpen(false);
    wasActive.current = active;
  }, [active]);

  return (
    <div className="flex w-full min-w-0 flex-col items-start">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="group inline-flex min-w-0 max-w-full items-center gap-1 self-start px-0 py-0.5 text-left transition-opacity hover:opacity-80"
      >
        {active ? (
          <ShinyText
            text={invocation.title}
            speed={2.5}
            className="min-w-0 shrink overflow-hidden text-ellipsis whitespace-nowrap !text-label-sm !font-normal text-ds-text-neutral-subtle-default"
          />
        ) : (
          <span className="min-w-0 shrink overflow-hidden text-ellipsis whitespace-nowrap !text-label-sm font-normal text-ds-text-neutral-subtle-default">
            {invocation.title}
          </span>
        )}
        <StatusInline status={invocation.status} hideLabel />
        <ChevronRight
          aria-hidden
          className={cn(
            'size-4 shrink-0 text-ds-icon-neutral-subtle-default transition-[opacity,transform] duration-200',
            open
              ? 'rotate-90 opacity-100'
              : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'
          )}
        />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="normal-tool-detail"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={HEIGHT_MOTION}
            className="w-full min-w-0 overflow-hidden"
          >
            <ToolInputOutputDetails
              className="mt-1"
              input={invocation.input}
              output={invocation.output}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function NormalInteractionRow({
  row,
}: {
  row: Extract<TimelineTraceRow, { kind: 'node' }>;
}) {
  if (row.node.kind !== 'interaction') return null;
  const interaction = row.node;
  if (interaction.status === 'requested' && !interaction.response) return null;

  return (
    <div
      className="w-full rounded-md bg-ds-bg-neutral-muted-default p-2 opacity-60"
      data-human-input-receipt
    >
      <span className="block !text-label-xs font-medium uppercase tracking-wide text-ds-text-neutral-subtle-default">
        Input required
      </span>
      {interaction.prompt ? (
        <div className="mt-2">
          <span className="block !text-label-xs font-medium uppercase tracking-wide text-ds-text-neutral-subtle-default">
            Question
          </span>
          <span className="mt-1 block whitespace-pre-wrap break-words !text-label-xs font-normal text-ds-text-neutral-default-default">
            {interaction.prompt}
          </span>
        </div>
      ) : null}
      {interaction.response ? (
        <div className="mt-2">
          <span className="block !text-label-xs font-medium uppercase tracking-wide text-ds-text-neutral-subtle-default">
            Answer
          </span>
          <span className="mt-1 block whitespace-pre-wrap break-words !text-label-xs font-normal text-ds-text-neutral-default-default">
            {interaction.response}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function isNormalWorkRow(row: TimelineTraceRow): boolean {
  if (row.kind === 'tool') return true;
  const node = row.node;
  if (node.kind === 'activity' || node.kind === 'notice') return true;
  if (node.kind === 'interaction') return node.status !== 'requested';
  return (
    node.kind === 'message' &&
    node.role === 'assistant' &&
    node.purpose !== 'final'
  );
}

function NormalWorkRow({ row }: { row: TimelineTraceRow }) {
  if (row.kind === 'tool') {
    return <NormalToolRow invocation={row.invocation} />;
  }
  const node = row.node;
  if (node.kind === 'interaction') return <NormalInteractionRow row={row} />;
  if (node.kind === 'message') {
    return (
      <span className="block whitespace-pre-wrap break-words !text-label-sm font-normal text-ds-text-neutral-default-default">
        {node.content}
      </span>
    );
  }
  if (node.kind === 'notice') {
    return (
      <span className="block whitespace-pre-wrap break-words !text-label-sm font-normal text-ds-text-neutral-subtle-default">
        {node.content}
      </span>
    );
  }
  if (node.kind === 'activity') {
    return (
      <div className="flex min-w-0 items-start gap-1.5 py-0.5">
        <StatusInline status={node.status} hideLabel />
        <span className="min-w-0 whitespace-pre-wrap break-words !text-label-sm font-normal text-ds-text-neutral-subtle-default">
          {node.title}
          {node.detail ? ` · ${node.detail}` : ''}
        </span>
      </div>
    );
  }
  return null;
}

function workLogSummary(run: TimelineRunView): string {
  if (isActiveRunStatus(run.status)) return 'Working on tasks for';
  if (run.status === 'failed') return 'Failed after';
  if (run.status === 'interrupted') return 'Interrupted after';
  if (run.status === 'cancelled') return 'Stopped after';
  return 'Worked for';
}

function NormalRunWorkLog({ run }: { run: TimelineRunView }) {
  const rows = useMemo(
    () => run.traceRows.filter(isNormalWorkRow),
    [run.traceRows]
  );
  const active = isActiveRunStatus(run.status);
  const [open, setOpen] = useState(active);
  const wasActive = useRef(active);

  useEffect(() => {
    if (active) setOpen(true);
    else if (wasActive.current) setOpen(false);
    wasActive.current = active;
  }, [active]);

  if (rows.length === 0) return null;

  return (
    <div className="flex w-full min-w-0 flex-col" data-normal-run-work-log>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full min-w-0 items-center justify-start gap-1 px-0 py-2 text-left"
      >
        <span className="text-body-sm font-medium text-ds-text-neutral-muted-default">
          {workLogSummary(run)} <RunElapsed run={run} />
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
            key="normal-work-log-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={HEIGHT_MOTION}
            className="overflow-hidden"
          >
            <div className="flex min-w-0 flex-col gap-1 pb-1">
              {rows.map((row) => (
                <NormalWorkRow key={row.id} row={row} />
              ))}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function NormalPlan({ run }: { run: TimelineRunView }) {
  const plan = run.plans.at(-1);
  if (!plan) return null;
  return (
    <section className="rounded-xl border border-ds-border-neutral-subtle-default bg-ds-bg-neutral-subtle-default px-3 py-2">
      <span className="block text-body-sm font-medium text-ds-text-neutral-default-default">
        {plan.title || 'Plan'}
      </span>
      {plan.summary ? (
        <span className="mt-1 block whitespace-pre-wrap text-label-sm font-normal text-ds-text-neutral-subtle-default">
          {plan.summary}
        </span>
      ) : null}
    </section>
  );
}

export function NormalTimeline({
  runs,
  projectedArtifactsByRun = {},
}: TimelineModeProps) {
  return (
    <div className="flex w-full flex-col gap-3" data-timeline-mode="normal">
      {runs.map((run) => {
        const projectedArtifacts = projectedArtifactsByRun[run.runId] || [];
        const hasExecutionRows = run.traceRows.some(isNormalWorkRow);
        return (
          <section
            key={run.id}
            className="flex w-full flex-col gap-3"
            data-run-id={run.runId}
          >
            {run.userQuery ? (
              <UserMessageCard
                id={run.userQuery.id}
                content={run.userQuery.content}
                attaches={run.userQuery.attachments}
              />
            ) : null}
            <NormalPlan run={run} />
            {isActiveRunStatus(run.status) && !hasExecutionRows ? (
              <PreparingToExecuteTasks />
            ) : null}
            <NormalRunWorkLog run={run} />
            {run.finalAssistantResponse ? (
              <AgentMessageCard
                id={run.finalAssistantResponse.id}
                content={run.finalAssistantResponse.content}
                typewriter={isActiveRunStatus(run.status)}
                deferredFooter={
                  <RunFilesGroup
                    artifactNodes={run.artifacts}
                    projectedArtifacts={projectedArtifacts}
                  />
                }
              />
            ) : run.artifacts.length > 0 || projectedArtifacts.length > 0 ? (
              <RunFilesGroup
                artifactNodes={run.artifacts}
                projectedArtifacts={projectedArtifacts}
              />
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
