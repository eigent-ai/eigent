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
import { UserMessageCard } from '@/components/ChatBox/MessageItem/UserMessageCard';
import type { TimelineRunView } from '@/lib/projector/chat/presentation';
import { ListChecks } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { TimelineModeProps } from './NormalTimeline';
import { FilesChangedSummaryRow } from './RunFiles';
import {
  isActiveRunStatus,
  isTerminalRunStatus,
  RunElapsed,
  StatusInline,
} from './shared';

function CountTag({ count, label }: { count: number; label: string }) {
  return (
    <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-md bg-ds-bg-neutral-strong-default px-1.5 !text-label-xs font-medium leading-none text-ds-text-neutral-subtle-default">
      <span className="tabular-nums text-ds-text-neutral-default-default">
        {count}
      </span>
      <span>{label}</span>
    </span>
  );
}

function RunSummaryCard({ run }: { run: TimelineRunView }) {
  const { t } = useTranslation();
  const active = isActiveRunStatus(run.status);

  return (
    <div
      className="flex min-h-11 w-full min-w-0 items-center gap-2 bg-transparent px-3 py-2"
      data-run-summary-card
      data-run-status={run.status}
      role="status"
    >
      <ListChecks
        aria-hidden
        className="size-4 shrink-0 text-ds-icon-neutral-subtle-default"
      />
      <span className="min-w-0 flex-1 truncate text-body-sm font-semibold text-ds-text-neutral-default-default">
        {t('chat.timeline-run-status', {
          status: active ? 'running' : run.status.replaceAll('_', ' '),
          defaultValue: `Run ${active ? 'running' : run.status.replaceAll('_', ' ')}`,
        })}
      </span>
      <div className="flex shrink-0 items-center gap-1.5">
        <CountTag
          count={run.summary.toolCallCount}
          label={run.summary.toolCallCount === 1 ? 'tool call' : 'tool calls'}
        />
        <CountTag
          count={run.summary.agentMessageCount}
          label={
            run.summary.agentMessageCount === 1
              ? 'agent message'
              : 'agent messages'
          }
        />
      </div>
      <span className="inline-flex shrink-0 text-label-xs font-normal">
        <RunElapsed run={run} />
      </span>
      <StatusInline
        status={run.status}
        hideLabel={active}
        className="!text-label-xs !font-normal leading-4"
      />
    </div>
  );
}

function SummarizedRun({
  run,
  projectedArtifactsByRun,
}: {
  run: TimelineRunView;
  projectedArtifactsByRun: NonNullable<
    TimelineModeProps['projectedArtifactsByRun']
  >;
}) {
  const projectedArtifacts = projectedArtifactsByRun[run.runId] || [];
  const fileProps = {
    artifactNodes: run.artifacts,
    projectedArtifacts,
  };

  return (
    <section
      className="flex w-full flex-col gap-3"
      data-run-id={run.runId}
      data-summarized-run
    >
      {run.userQuery ? (
        <UserMessageCard
          id={run.userQuery.id}
          content={run.userQuery.content}
          attaches={run.userQuery.attachments}
        />
      ) : null}
      <div
        className="overflow-hidden rounded-2xl border border-solid border-ds-border-neutral-subtle-default bg-ds-bg-neutral-subtle-default"
        data-run-summary-group
      >
        <RunSummaryCard run={run} />
        {isTerminalRunStatus(run.status) ? (
          <FilesChangedSummaryRow {...fileProps} embedded />
        ) : null}
      </div>
      {run.finalAssistantResponse ? (
        <AgentMessageCard
          id={run.finalAssistantResponse.id}
          content={run.finalAssistantResponse.content}
          typewriter={isActiveRunStatus(run.status)}
        />
      ) : null}
    </section>
  );
}

export function SummarizedTimeline({
  runs,
  projectedArtifactsByRun = {},
}: TimelineModeProps) {
  return (
    <div className="flex w-full flex-col gap-3" data-timeline-mode="summarized">
      {runs.map((run) => (
        <SummarizedRun
          key={run.id}
          run={run}
          projectedArtifactsByRun={projectedArtifactsByRun}
        />
      ))}
    </div>
  );
}
