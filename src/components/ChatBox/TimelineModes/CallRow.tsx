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

import { useTerminalProcesses } from '@/components/Session/PreviewPanel/tabs/terminal/useTerminalProcesses';
import { Button } from '@/components/ui/button';
import { useSessionPageTabStore } from '@/hooks/useSessionPageTabStore';
import { openTerminalProcessPreview } from '@/lib/terminalPreview';

import { ToolInputOutputDetails } from '@/components/ChatBox/MessageItem/ToolInputOutputDetails';
import {
  timelineCallTitle,
  type TimelineCall,
  type TimelineCallTitle,
} from '@/lib/projector/chat/presentation';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

import { callIcon } from './actionIcon';
import {
  TaskLogCollapsible,
  TaskLogContent,
  TaskLogDescription,
  TaskLogIcon,
  TaskLogLine,
  TaskLogTitle,
  TaskLogTrigger,
  useTaskLogOpenState,
} from './TaskLog';

const ERROR_STATUSES = new Set(['failed', 'timed_out', 'outcome_unknown']);

export function isCallErrorStatus(status: TimelineCall['status']): boolean {
  return ERROR_STATUSES.has(status);
}

export function isCallActiveStatus(status: TimelineCall['status']): boolean {
  return status === 'running' || status === 'pending';
}

interface CallRowProps {
  call: TimelineCall;
  /** Outcome-tense row title; defaults to one without a subject. */
  title?: TimelineCallTitle;
  /** Keep disclosure open if this call moves into a repeated-call group. */
  initialOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  runActive: boolean;
  /** Row id that currently owns the single running shimmer, if any. */
  latestRunningCallId?: string | null;
  reducedMotion: boolean;
}

/**
 * One request/response record, whoever produced the response.
 *
 * A toolkit invocation and a human interaction share this row because they
 * share a shape: a request, an executor, and a response. Only the labels and
 * the title grammar differ, both of which arrive on the `TimelineCall`.
 *
 * The row always renders in the subdued label treatment. Primary text in the
 * narrative timeline is reserved for the agent's own words.
 */
export function CallRow({
  call,
  title: titleOverride,
  initialOpen,
  onOpenChange,
  runActive,
  latestRunningCallId = null,
  reducedMotion,
}: CallRowProps) {
  const { t } = useTranslation();
  const projectId = useSessionPageTabStore(
    (state) => state.sessionPreviewProjectId
  );
  const processes = useTerminalProcesses(
    call.actionKind === 'command' ? projectId : null
  );
  const process = processes.find(
    (p) =>
      p.run_id === call.runId &&
      p.tool_call_id === call.toolCallId &&
      Boolean(call.toolCallId)
  );
  const running = runActive && isCallActiveStatus(call.status);
  const highlighted = running && call.id === latestRunningCallId;
  const failed = isCallErrorStatus(call.status);
  const pendingHuman = call.executor === 'human' && call.status === 'pending';
  const showWaitingOutput = !call.output && (running || pendingHuman);
  const description = call.notice?.content.trim() || undefined;
  let restingStatusText: string | null;
  switch (call.status) {
    case 'failed':
      restingStatusText = t('chat.timeline-failed', { defaultValue: 'Failed' });
      break;
    case 'timed_out':
      restingStatusText = t('chat.timeline-timed-out', {
        defaultValue: 'Timed out',
      });
      break;
    case 'cancelled':
      restingStatusText = t('chat.timeline-cancelled', {
        defaultValue: 'Cancelled',
      });
      break;
    case 'blocked':
      restingStatusText = t('chat.timeline-blocked', {
        defaultValue: 'Blocked',
      });
      break;
    case 'interrupted':
      restingStatusText = t('chat.timeline-interrupted', {
        defaultValue: 'Interrupted',
      });
      break;
    case 'outcome_unknown':
      restingStatusText = t('chat.tool-status-unknown', {
        defaultValue: 'Unknown',
      });
      break;
    default:
      restingStatusText = null;
  }
  // A pending human call is the one thing the user must act on, so it opens
  // itself and folds once answered. A running tool only shimmers, like a
  // legacy event-log row, so the list never jumps.
  const [open, setOpen] = useTaskLogOpenState(pendingHuman, initialOpen);
  // Only a row with something to reveal is a trigger. A running call with no
  // request yet stays a plain line until its detail arrives.
  const expandable =
    Boolean(call.input || call.output || call.notice?.content.trim()) ||
    pendingHuman;
  const title = titleOverride ?? timelineCallTitle(call);
  // Only an outcome the title does not already say gets a word at rest.
  const restingDescription = title.statesStatus ? null : restingStatusText;
  const lineStatus = failed ? 'error' : highlighted ? 'running' : undefined;
  const lineContent = (
    <>
      <TaskLogIcon
        icon={callIcon(call)}
        data-timeline-action-icon={call.actionKind}
      />
      <TaskLogTitle shimmer={highlighted}>{title.text}</TaskLogTitle>
      {restingDescription ? (
        <TaskLogDescription
          className={cn(!failed && 'text-ds-ink-muted-default')}
          data-timeline-call-resting-description
        >
          {restingDescription}
        </TaskLogDescription>
      ) : null}
    </>
  );
  const processAction = process ? (
    <Button
      variant="text"
      size="sm"
      onClick={() => openTerminalProcessPreview(process)}
    >
      {t(
        process.url && process.status === 'running'
          ? 'layout.terminal-process-open-server'
          : 'layout.terminal-process-open-output'
      )}
    </Button>
  ) : null;
  const rowData = {
    'data-timeline-call-executor': call.executor,
    'data-timeline-call-id': call.toolCallId || call.interactionId,
    'data-timeline-call-status': call.status,
    'data-timeline-action-kind': call.actionKind,
    'data-timeline-call-highlighted': highlighted ? 'true' : undefined,
    'data-interaction-id': call.interactionId,
  };

  if (!expandable) {
    return (
      <div className="flex w-full min-w-0 flex-col items-start" {...rowData}>
        <TaskLogLine status={lineStatus} data-timeline-call-line>
          {lineContent}
        </TaskLogLine>
        {processAction}
      </div>
    );
  }

  return (
    <TaskLogCollapsible
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        onOpenChange?.(nextOpen);
      }}
      reducedMotion={reducedMotion}
      {...rowData}
    >
      <TaskLogTrigger
        status={lineStatus}
        chevronProps={{ 'data-timeline-call-chevron': true }}
        data-timeline-call-line
        data-timeline-call-trigger
      >
        {lineContent}
      </TaskLogTrigger>
      {processAction}
      <TaskLogContent data-timeline-call-content>
        <ToolInputOutputDetails
          appearance="code-scroll"
          description={description}
          input={call.input}
          inputLabel={call.inputLabel}
          output={call.output}
          outputLabel={call.outputLabel}
          showEmptyOutput={showWaitingOutput}
          emptyOutputText={
            call.emptyOutputText ||
            (running ? 'Waiting for a response.' : 'Waiting for you.')
          }
        />
      </TaskLogContent>
    </TaskLogCollapsible>
  );
}
