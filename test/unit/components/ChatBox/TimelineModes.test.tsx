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

import { TimelineModeRenderer } from '@/components/ChatBox/TimelineModes';
import {
  composeTimelineRuns,
  reconcileTimelineRun,
} from '@/lib/projector/chat/presentation';
import type { ChatProjectionNode } from '@/lib/projector/chat/types';
import { getSessionPreviewSlice, usePageTabStore } from '@/store/pageTabStore';
import { SessionMode } from '@/types/constants';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const motionPreference = vi.hoisted(() => ({ reduced: false }));

vi.mock('framer-motion', async () => {
  const actual =
    await vi.importActual<typeof import('framer-motion')>('framer-motion');
  return {
    ...actual,
    useReducedMotion: () => motionPreference.reduced,
  };
});

const base = {
  projectId: 'project-1',
  runId: 'run-1',
  cloudCursor: 1,
  legacyStep: null,
} as const;

function nodes(status: 'running' | 'completed'): ChatProjectionNode[] {
  const result: ChatProjectionNode[] = [
    {
      ...base,
      kind: 'message',
      id: 'user-1',
      eventId: 'user-1',
      eventType: 'user.message',
      runSequence: 1,
      createdAt: '2026-08-19T00:00:00Z',
      role: 'user',
      purpose: 'query',
      status: 'complete',
      content: 'Review the event timeline',
      attachments: [
        {
          fileName: 'timeline-notes.md',
          filePath: 'uploads/timeline-notes.md',
          source: 'upload',
        },
      ],
    },
    {
      ...base,
      kind: 'message',
      id: 'narration-1',
      eventId: 'narration-1',
      eventType: 'message.completed',
      runSequence: 2,
      createdAt: '2026-08-19T00:00:01Z',
      role: 'assistant',
      purpose: 'narration',
      status: 'complete',
      content: 'I will inspect the implementation.',
      agentName: 'Developer Agent',
    },
    {
      ...base,
      kind: 'activity',
      id: 'tool-start',
      eventId: 'tool-start',
      eventType: 'tool.started',
      runSequence: 3,
      createdAt: '2026-08-19T00:00:02Z',
      activityType: 'tool',
      phase: 'started',
      status: 'running',
      title: 'read_file',
      input: 'src/components/ChatBox/index.tsx',
      toolCallId: 'call-1',
      toolkitName: 'File Toolkit',
      methodName: 'read_file',
    },
  ];

  if (status === 'completed') {
    result.push(
      {
        ...base,
        kind: 'activity',
        id: 'tool-end',
        eventId: 'tool-end',
        eventType: 'tool.completed',
        runSequence: 4,
        createdAt: '2026-08-19T00:00:03Z',
        activityType: 'tool',
        phase: 'completed',
        status: 'completed',
        title: 'read_file',
        output: 'Loaded 220 lines',
        toolCallId: 'call-1',
        toolkitName: 'File Toolkit',
        methodName: 'read_file',
      },
      {
        ...base,
        kind: 'artifact',
        id: 'artifact-1',
        eventId: 'artifact-1',
        eventType: 'artifact.updated',
        runSequence: 5,
        createdAt: '2026-08-19T00:00:04Z',
        operation: 'updated',
        path: 'src/timeline.tsx',
        relativePath: 'src/timeline.tsx',
      },
      {
        ...base,
        kind: 'run_status',
        id: 'run-completed',
        eventId: 'run-completed',
        eventType: 'run.completed',
        runSequence: 6,
        createdAt: '2026-08-19T00:00:05Z',
        status: 'completed',
      }
    );
  }

  return result;
}

function interactionNodes(
  status: 'requested' | 'responded'
): ChatProjectionNode[] {
  return [
    {
      ...base,
      kind: 'interaction',
      id: 'interaction-request',
      eventId: 'interaction-request',
      eventType:
        status === 'requested'
          ? 'interaction.requested'
          : 'interaction.resolved',
      runSequence: 1,
      createdAt: '2026-08-19T00:00:00Z',
      interactionId: 'format-choice',
      interactionType: 'choice',
      status,
      prompt: 'Which output format should I use?',
      response: status === 'responded' ? 'Markdown file' : undefined,
      options: [{ id: 'markdown', label: 'Markdown file' }],
    },
  ];
}

function runStatusNodes(
  status: 'completed' | 'running' | 'failed' | 'cancelling' | 'cancelled'
): ChatProjectionNode[] {
  return [
    {
      ...base,
      kind: 'run_status',
      id: `run-${status}`,
      eventId: `run-${status}`,
      eventType: `run.${status}`,
      runSequence: 1,
      createdAt: '2026-08-19T00:00:00Z',
      status,
    },
  ];
}

function normalToolActivity({
  id,
  runSequence,
  status = 'running',
  toolkitName = 'File Toolkit',
  methodName = 'read_file',
  title = `${toolkitName} · ${methodName}`,
  toolCallId = id,
  agentName,
  stepId,
  subagentInvocation,
  subagentType,
  subagentName,
  subagentStatus,
  subagentAgentId,
  agentProvider,
  agentModel,
  input,
  output,
}: {
  id: string;
  runSequence: number;
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  toolkitName?: string;
  methodName?: string;
  title?: string;
  toolCallId?: string;
  agentName?: string;
  stepId?: string;
  subagentInvocation?: boolean;
  subagentType?: string;
  subagentName?: string;
  subagentStatus?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  subagentAgentId?: string;
  agentProvider?: string;
  agentModel?: string;
  input?: string;
  output?: string;
}): ChatProjectionNode {
  return {
    ...base,
    kind: 'activity',
    id,
    eventId: id,
    eventType: `tool.${
      status === 'pending'
        ? 'requested'
        : status === 'running'
          ? 'started'
          : status
    }`,
    runSequence,
    createdAt: `2026-08-19T00:00:${String(runSequence).padStart(2, '0')}Z`,
    activityType: 'tool',
    phase:
      status === 'pending'
        ? 'requested'
        : status === 'running'
          ? 'started'
          : status,
    status,
    title,
    input,
    output:
      output ?? (status === 'completed' ? `${title} complete` : undefined),
    toolCallId,
    toolkitName,
    methodName,
    agentName,
    stepId,
    subagentInvocation,
    subagentType,
    subagentName,
    subagentStatus,
    subagentAgentId,
    agentProvider,
    agentModel,
  };
}

function runningRunStatus(runSequence: number): ChatProjectionNode {
  return {
    ...base,
    kind: 'run_status',
    id: `running-run-${runSequence}`,
    eventId: `running-run-${runSequence}`,
    eventType: 'run.running',
    runSequence,
    createdAt: `2026-08-19T00:00:${String(runSequence).padStart(2, '0')}Z`,
    status: 'running',
  };
}

/**
 * Narrative folds its calls by default. Tests that assert on individual call
 * rows open every segment first, which is also the real drill-down path.
 */
function openNarrativeSegments(container: HTMLElement) {
  for (const trigger of container.querySelectorAll(
    '[data-narrative-segment-trigger]'
  )) {
    fireEvent.click(trigger as HTMLElement);
  }
}

describe('ChatBox timeline modes', () => {
  afterEach(() => {
    vi.useRealTimers();
    motionPreference.reduced = false;
    usePageTabStore.setState({
      sessionPreviewProjectId: null,
      sessionPreviewByProject: {},
    });
  });

  it('renders Detailed as labelled rows with vertical Input then Output', () => {
    const runs = composeTimelineRuns(nodes('completed'));
    const { container } = render(
      <TimelineModeRenderer detailLevel="trajectory" runs={runs} />
    );

    expect(
      container.querySelector('[data-timeline-mode="trajectory"]')
    ).toBeTruthy();
    expect(screen.getByText('User')).toBeInTheDocument();
    expect(screen.getByText('Assistant')).toBeInTheDocument();
    expect(screen.getByText('Tool')).toBeInTheDocument();

    const rows = container.querySelectorAll('[data-detailed-trace-row]');
    expect(rows.length).toBeGreaterThan(0);
    expect(container.querySelectorAll('[data-trace-chevron]')).toHaveLength(
      rows.length
    );
    rows.forEach((row) => {
      const rowButton = row.querySelector(':scope > button');
      expect(row).toHaveAttribute('data-expanded', 'false');
      expect(row).toHaveClass(
        'bg-ds-neutral-subtle-default',
        'hover:bg-ds-neutral-default-default'
      );
      expect(row.querySelectorAll(':scope > button')).toHaveLength(1);
      expect(rowButton).toHaveClass('flex', 'flex-row', 'items-center');
      expect(rowButton).not.toHaveClass('grid');
      expect(row.querySelector('[data-trace-summary]')).toHaveClass(
        'flex-1',
        'truncate',
        '!text-ds-text-meta'
      );
      expect(row.querySelector('[data-trace-tag-column]')).toHaveClass(
        'w-28',
        'shrink-0',
        'justify-end'
      );
      expect(row.querySelector('[data-trace-tag]')).toHaveClass(
        'max-w-full',
        'text-right',
        '!text-ds-text-meta'
      );
      expect(row.querySelector('[data-trace-ending]')).toHaveClass(
        'ml-auto',
        'shrink-0'
      );
    });
    expect(
      container.querySelector('[data-timeline-mode="trajectory"] ol')
    ).toHaveClass('bg-transparent');
    const contextTag = container.querySelector(
      '[data-trace-category="context"] [data-trace-tag]'
    );
    const userTag = container.querySelector(
      '[data-trace-category="user"] [data-trace-tag]'
    );
    const assistantTag = container.querySelector(
      '[data-trace-category="assistant"] [data-trace-tag]'
    );
    const toolTag = container.querySelector(
      '[data-trace-category="tool"] [data-trace-tag]'
    );
    const fileTag = container.querySelector(
      '[data-trace-category="file"] [data-trace-tag]'
    );
    expect(userTag).toHaveClass(
      'bg-ds-category-blue-background-default',
      'text-ds-category-blue-text-strong'
    );
    expect(contextTag).toHaveClass(
      'bg-ds-category-slate-background-default',
      'text-ds-category-slate-text-strong'
    );
    expect(assistantTag).toHaveClass(
      'bg-ds-category-indigo-background-default',
      'text-ds-category-indigo-text-strong'
    );
    expect(toolTag).toHaveClass(
      'bg-ds-category-teal-background-default',
      'text-ds-category-teal-text-strong'
    );
    expect(fileTag).toHaveClass(
      'bg-ds-category-green-background-default',
      'text-ds-category-green-text-strong'
    );
    expect(contextTag?.className).not.toBe(toolTag?.className);

    const toolRow = container.querySelector(
      '[data-trace-category="tool"]'
    ) as HTMLElement;
    fireEvent.click(within(toolRow).getByRole('button'));
    const input = within(toolRow).getByText('Input');
    const output = within(toolRow).getByText('Output');
    expect(
      input.compareDocumentPosition(output) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      within(toolRow).getByText('src/components/ChatBox/index.tsx')
    ).toBeInTheDocument();
    expect(within(toolRow).getByText('Loaded 220 lines')).toBeInTheDocument();
    expect(within(toolRow).getByText('completed').parentElement).toHaveClass(
      '!text-ds-text-meta'
    );
  });

  it('opens a trajectory Artifact in the owning Run review', () => {
    usePageTabStore.setState({
      sessionPreviewProjectId: 'project-1',
      sessionPreviewByProject: {},
    });
    const { container } = render(
      <TimelineModeRenderer
        detailLevel="trajectory"
        runs={composeTimelineRuns(nodes('completed'))}
      />
    );
    const fileRow = container.querySelector(
      '[data-trace-category="file"]'
    ) as HTMLElement;

    fireEvent.click(fileRow.querySelector(':scope > button') as HTMLElement);
    fireEvent.click(within(fileRow).getByTitle('Review this change'));

    const preview = getSessionPreviewSlice(usePageTabStore.getState());
    expect(preview.tabs[0]).toMatchObject({
      type: 'review',
      reviewTarget: {
        scope: 'run',
        runId: 'run-1',
        focusPath: 'src/timeline.tsx',
      },
    });
  });

  it('auto-expands a pending question and folds it after the answer arrives', () => {
    const { container, rerender } = render(
      <TimelineModeRenderer
        detailLevel="trajectory"
        runs={composeTimelineRuns(interactionNodes('requested'))}
      />
    );

    const row = container.querySelector(
      '[data-trace-category="input-required"]'
    ) as HTMLElement;
    expect(row).toHaveAttribute('data-expanded', 'true');
    expect(row.querySelector('[data-trace-tag]')).toHaveClass(
      'bg-ds-category-amber-background-default',
      'text-ds-category-amber-text-strong'
    );
    expect(within(row).getByText('Question')).toHaveClass('!text-ds-text-meta');
    expect(
      within(row).getAllByText('Which output format should I use?')[1]
    ).toHaveClass('!text-ds-text-meta');

    rerender(
      <TimelineModeRenderer
        detailLevel="trajectory"
        runs={composeTimelineRuns(interactionNodes('responded'))}
      />
    );

    const resolvedRow = container.querySelector(
      '[data-trace-category="input-required"]'
    ) as HTMLElement;
    expect(resolvedRow).toHaveAttribute('data-expanded', 'false');
    expect(within(resolvedRow).queryByText('Question')).toBeNull();
    expect(within(resolvedRow).queryByText('Answer')).toBeNull();

    fireEvent.click(within(resolvedRow).getByRole('button'));
    expect(within(resolvedRow).getByText('Question')).toHaveClass(
      '!text-ds-text-meta'
    );
    expect(within(resolvedRow).getByText('Answer')).toHaveClass(
      '!text-ds-text-meta'
    );
    expect(within(resolvedRow).getByText('Markdown file')).toHaveClass(
      '!text-ds-text-meta'
    );
  });

  it('uses lightly tinted backgrounds with strong text for agent tags', () => {
    const agentNode: ChatProjectionNode = {
      ...base,
      kind: 'activity',
      id: 'agent-status',
      eventId: 'agent-status',
      eventType: 'agent.completed',
      runSequence: 1,
      createdAt: '2026-08-19T00:00:00Z',
      activityType: 'agent',
      phase: 'completed',
      status: 'completed',
      title: 'question_confirm_agent',
    };
    const { container } = render(
      <TimelineModeRenderer
        detailLevel="trajectory"
        runs={composeTimelineRuns([agentNode])}
      />
    );
    const agentTag = container.querySelector(
      '[data-trace-category="agent"] [data-trace-tag]'
    );

    expect(agentTag).toHaveClass(
      'bg-ds-category-purple-background-default',
      'text-ds-category-purple-text-strong'
    );
  });

  it('uses the same design-system status color for detailed labels and icons', () => {
    const cases = [
      [
        'completed',
        'text-ds-text-status-completed-default-default',
        '!text-ds-text-status-completed-default-default',
      ],
      [
        'running',
        'text-ds-text-status-running-default-default',
        '!text-ds-text-status-running-default-default',
      ],
      [
        'failed',
        'text-ds-text-status-error-default-default',
        '!text-ds-text-status-error-default-default',
      ],
      [
        'cancelling',
        'text-ds-text-status-cancelled-default-default',
        '!text-ds-text-status-cancelled-default-default',
      ],
      [
        'cancelled',
        'text-ds-text-status-cancelled-default-default',
        '!text-ds-text-status-cancelled-default-default',
      ],
    ] as const;

    cases.forEach(([status, labelTone, iconTone]) => {
      const { container, unmount } = render(
        <TimelineModeRenderer
          detailLevel="trajectory"
          runs={composeTimelineRuns(runStatusNodes(status))}
        />
      );
      const statusLabel = container.querySelector(
        `[data-detailed-status="${status}"]`
      ) as HTMLElement;

      expect(statusLabel).toHaveClass(labelTone);
      expect(statusLabel.querySelector('svg')).toHaveClass(iconTone);
      expect(statusLabel.querySelector('span')).toHaveClass(labelTone);
      unmount();
    });

    const { container } = render(
      <TimelineModeRenderer
        detailLevel="trajectory"
        runs={composeTimelineRuns(interactionNodes('requested'))}
      />
    );
    const inputStatus = container.querySelector(
      '[data-detailed-status="requested"]'
    ) as HTMLElement;

    expect(inputStatus).toHaveClass(
      'text-ds-text-status-pending-default-default'
    );
    expect(inputStatus.querySelector('svg')).toHaveClass(
      '!text-ds-text-status-pending-default-default'
    );
    expect(inputStatus.querySelector('span')).toHaveClass(
      'text-ds-text-status-pending-default-default'
    );
  });

  it('renders event-native Normal with the legacy work-log disclosure', () => {
    const runs = composeTimelineRuns(nodes('running'));
    const { container } = render(
      <TimelineModeRenderer detailLevel="narrative" runs={runs} />
    );

    expect(
      container.querySelector('[data-timeline-mode="narrative"]')
    ).toBeTruthy();
    expect(screen.getByText('Review the event timeline')).toBeInTheDocument();
    expect(screen.getByText('timeline-notes.md')).toHaveClass(
      '!text-ds-text-meta'
    );
    expect(screen.getByText(/Working on tasks for/)).toBeInTheDocument();
    expect(
      container.querySelector('[data-narrative-timeline]')
    ).toBeInTheDocument();

    // Narration is primary text; the calls behind it stay folded until asked
    // for, which is the whole point of the narrative mode.
    expect(
      container.querySelector('[data-narrative-segment-narration]')
    ).toHaveClass('text-ds-ink-default-default');
    expect(container.querySelector('[data-timeline-call-id]')).toBeNull();
    expect(screen.queryByText('Developer Agent')).toBeNull();
    expect(container.querySelector('[data-narrative-agent-group]')).toBeNull();

    openNarrativeSegments(container);

    const tool = container.querySelector(
      '[data-timeline-call-id="call-1"]'
    ) as HTMLElement;
    const trigger = tool.querySelector(
      '[data-timeline-call-trigger]'
    ) as HTMLElement;
    expect(tool).toHaveAttribute('data-timeline-call-status', 'running');
    expect(tool).toHaveAttribute('data-timeline-call-executor', 'toolkit');
    expect(trigger.querySelectorAll('svg')).toHaveLength(2);
    expect(tool).toHaveAttribute('data-timeline-action-kind', 'inspect');
    expect(
      trigger.querySelector('[data-timeline-action-icon="inspect"]')
    ).toBeInTheDocument();
    expect(within(tool).getByText('Request')).toBeInTheDocument();
    expect(
      within(tool).getByText('src/components/ChatBox/index.tsx')
    ).toBeInTheDocument();
    expect(within(tool).getByText('Response')).toBeInTheDocument();
    expect(
      within(tool).getByText('Waiting for a response.')
    ).toBeInTheDocument();
  });

  it('renders one live authored Step text slot', () => {
    const timelineNodes: ChatProjectionNode[] = [
      {
        ...base,
        kind: 'step',
        id: 'step-started',
        eventId: 'step-started',
        eventType: 'step.started',
        runSequence: 1,
        createdAt: '2026-08-19T00:00:01Z',
        stepId: 'research-step',
        title: 'Research streaming rendering',
        status: 'running',
        phase: 'started',
        source: 'authored',
      },
      {
        ...base,
        kind: 'step',
        id: 'step-completed',
        eventId: 'step-completed',
        eventType: 'step.completed',
        runSequence: 2,
        createdAt: '2026-08-19T00:00:02Z',
        stepId: 'research-step',
        title: 'Research streaming rendering',
        summary: 'Compiled the implementation strategy.',
        status: 'completed',
        phase: 'completed',
        source: 'authored',
      },
      runningRunStatus(3),
    ];
    const { container } = render(
      <TimelineModeRenderer
        detailLevel="narrative"
        runs={composeTimelineRuns(timelineNodes)}
      />
    );
    const text = container.querySelector(
      '[data-narrative-segment-narration]'
    ) as HTMLElement;

    expect(text).toHaveTextContent('Compiled the implementation strategy.');
    expect(text).not.toHaveTextContent('Research streaming rendering');
    expect(
      container.querySelector('[data-narrative-segment-summary]')
    ).toBeNull();
  });

  it('keeps a correlated notice inside the real tool disclosure', () => {
    const timelineNodes: ChatProjectionNode[] = [
      {
        ...base,
        kind: 'activity',
        id: 'report-tool',
        eventId: 'report-tool',
        eventType: 'tool.completed',
        runSequence: 1,
        createdAt: '2026-08-19T00:00:01Z',
        activityType: 'tool',
        phase: 'completed',
        status: 'completed',
        title: 'Draft report',
        input: 'Write report.md',
        output: 'Saved report.md',
        durationMs: 25,
        toolCallId: 'report-call',
        toolkitName: 'File Toolkit',
        methodName: 'write_file',
      },
      {
        ...base,
        kind: 'notice',
        id: 'report-notice',
        eventId: 'report-notice',
        eventType: 'notice.result',
        runSequence: 2,
        createdAt: '2026-08-19T00:00:02Z',
        severity: 'success',
        title: 'Report completed',
        content: 'The markdown report is ready.',
        toolCallId: 'report-call',
      },
      runningRunStatus(3),
    ];
    const { container } = render(
      <TimelineModeRenderer
        detailLevel="narrative"
        runs={composeTimelineRuns(timelineNodes)}
      />
    );

    openNarrativeSegments(container);
    const call = container.querySelector(
      '[data-timeline-call-id="report-call"]'
    ) as HTMLElement;
    fireEvent.click(
      call.querySelector('[data-timeline-call-trigger]') as HTMLElement
    );

    expect(container.querySelector('[data-narrative-notice-id]')).toBeNull();
    const metadata = call.querySelector(
      '[data-timeline-call-metadata]'
    ) as HTMLElement;
    const details = call.querySelector(
      '[data-tool-details-scroll]'
    ) as HTMLElement;
    const input = call.querySelector('[data-tool-input]') as HTMLElement;
    const output = call.querySelector('[data-tool-output]') as HTMLElement;
    const description = call.querySelector(
      '[data-tool-description]'
    ) as HTMLElement;
    const content = call.querySelector(
      '[data-timeline-call-content]'
    ) as HTMLElement;
    const indent = call.querySelector(
      '[data-timeline-call-indent]'
    ) as HTMLElement;
    const trigger = call.querySelector(
      '[data-timeline-call-trigger]'
    ) as HTMLElement;

    expect(metadata).toHaveClass('gap-ds-8', '!text-ds-text-meta');
    expect(within(metadata).getByText('Report completed')).toBeInTheDocument();
    expect(
      within(metadata).getByText('Completed in 25 ms')
    ).toBeInTheDocument();
    const separator = metadata.querySelector(
      '[data-timeline-call-separator]'
    ) as HTMLElement;
    expect(separator.parentElement).toHaveClass('gap-ds-8');
    expect(metadata).not.toHaveTextContent('The markdown report is ready.');
    expect(description).toHaveTextContent('The markdown report is ready.');
    expect(description).toHaveClass('!text-ds-text-meta');
    expect(content.parentElement).toHaveClass(
      'grid-cols-[auto_minmax(0,1fr)]',
      'gap-x-ds-6'
    );
    expect(indent).toHaveClass('w-ds-icon-main');
    expect(details).toHaveClass(
      'scrollbar-always-visible',
      'max-h-[300px]',
      'overflow-y-auto'
    );
    expect(within(input).getByText('Request')).not.toHaveClass('uppercase');
    expect(within(output).getByText('Response')).not.toHaveClass('uppercase');
    expect(within(input).getByText('Write report.md')).toHaveClass(
      'font-code',
      '!text-ds-text-meta'
    );
    expect(within(output).getByText('Saved report.md')).toHaveClass(
      'font-code',
      '!text-ds-text-meta'
    );
    expect(details.children[0]).toBe(description);
    expect(details.children[1]).toBe(input);
    expect(details.children[2]).toBe(output);
    expect(trigger.children[0]).toHaveAttribute(
      'data-timeline-action-icon',
      'write'
    );
    expect(trigger.children[1]).toHaveClass('!text-ds-text-base');
    expect(trigger.children[2]).toHaveAttribute('data-timeline-call-chevron');
  });

  it('uses a count-only group header instead of repeating a single child title', () => {
    const { container } = render(
      <TimelineModeRenderer
        detailLevel="narrative"
        runs={composeTimelineRuns(nodes('running'))}
      />
    );
    const groupTrigger = container.querySelector(
      '[data-narrative-segment-trigger]'
    ) as HTMLElement;
    const groupChevron = groupTrigger.querySelector(
      '[data-narrative-segment-chevron]'
    ) as HTMLElement;

    expect(groupTrigger).toHaveAttribute(
      'data-narrative-segment-call-count',
      '1'
    );
    expect(groupTrigger).toHaveTextContent('1 action');
    expect(groupTrigger).not.toHaveTextContent('read_file');
    expect(groupTrigger).toHaveClass(
      'group',
      'text-ds-ink-muted-default',
      'hover:text-ds-ink-default-default',
      'focus-visible:text-ds-ink-default-default'
    );
    expect(groupChevron).toBeInTheDocument();
    expect(groupChevron).toHaveClass(
      'opacity-0',
      'group-hover:opacity-100',
      'group-focus-visible:opacity-100'
    );

    fireEvent.click(groupTrigger);

    expect(groupChevron).toHaveClass('rotate-90', 'opacity-100');

    const childTriggers = container.querySelectorAll(
      '[data-timeline-call-trigger]'
    );
    expect(childTriggers).toHaveLength(1);
    expect(childTriggers[0]).toHaveTextContent('read_file');
    expect(
      childTriggers[0]!.querySelector('[data-timeline-call-chevron]')
    ).not.toHaveClass('opacity-0');
  });

  it('derives the group count from the rendered children and keeps their order', () => {
    const calls = [
      normalToolActivity({
        id: 'count-first',
        runSequence: 1,
        status: 'completed',
        title: 'Inspect first file',
      }),
      normalToolActivity({
        id: 'count-second',
        runSequence: 2,
        status: 'completed',
        title: 'Inspect second file',
      }),
      normalToolActivity({
        id: 'count-third',
        runSequence: 3,
        status: 'completed',
        title: 'Inspect third file',
      }),
      runningRunStatus(9),
    ];
    const { container } = render(
      <TimelineModeRenderer
        detailLevel="narrative"
        runs={composeTimelineRuns(calls)}
      />
    );
    const timeline = container.querySelector(
      '[data-narrative-timeline]'
    ) as HTMLElement;
    const groupTrigger = container.querySelector(
      '[data-narrative-segment-trigger]'
    ) as HTMLElement;

    expect(timeline).toHaveClass('gap-ds-stack-related', 'py-ds-8');
    expect(groupTrigger).toHaveAttribute(
      'data-narrative-segment-call-count',
      '3'
    );
    expect(groupTrigger).toHaveTextContent('3 actions');
    expect(groupTrigger).not.toHaveTextContent('Inspect first file');

    fireEvent.click(groupTrigger);

    const children = container.querySelector(
      '[data-narrative-segment-calls]'
    ) as HTMLElement;
    const childTriggers = [
      ...children.querySelectorAll('[data-timeline-call-trigger]'),
    ];
    expect(children).toHaveClass('gap-ds-4', 'pt-ds-4');
    expect(childTriggers).toHaveLength(3);
    expect(childTriggers.map((trigger) => trigger.textContent?.trim())).toEqual(
      ['Inspect first file', 'Inspect second file', 'Inspect third file']
    );
  });

  it('summarizes each projected action kind once before the group count', () => {
    const calls = [
      normalToolActivity({
        id: 'icon-write-first',
        runSequence: 1,
        status: 'completed',
        title: 'Write first file',
        methodName: 'write_file',
      }),
      normalToolActivity({
        id: 'icon-write-second',
        runSequence: 2,
        status: 'completed',
        title: 'Save second file',
        methodName: 'save_file',
      }),
      normalToolActivity({
        id: 'icon-write-third',
        runSequence: 3,
        status: 'completed',
        title: 'Draft third file',
        methodName: 'draft_file',
      }),
      normalToolActivity({
        id: 'icon-generic',
        runSequence: 4,
        status: 'completed',
        title: 'Deploy html content',
        methodName: 'deploy_html_content',
      }),
      normalToolActivity({
        id: 'icon-search',
        runSequence: 5,
        status: 'completed',
        title: 'Search examples',
        methodName: 'google_search',
      }),
      runningRunStatus(9),
    ];
    const { container } = render(
      <TimelineModeRenderer
        detailLevel="narrative"
        runs={composeTimelineRuns(calls)}
      />
    );
    const groupTrigger = container.querySelector(
      '[data-narrative-segment-trigger]'
    ) as HTMLElement;
    const iconKinds = [
      ...groupTrigger.querySelectorAll('[data-narrative-segment-action-icon]'),
    ].map((icon) => icon.getAttribute('data-narrative-segment-action-icon'));

    expect(groupTrigger).toHaveTextContent('5 actions');
    expect(iconKinds).toEqual(['write', 'generic', 'search']);
    expect(groupTrigger).toHaveClass('gap-ds-6', 'py-ds-2');
    expect(
      groupTrigger.querySelector('[data-narrative-segment-action-icons]')
    ).toHaveClass('gap-ds-6');
    groupTrigger
      .querySelectorAll('[data-narrative-segment-action-icon]')
      .forEach((icon) => expect(icon).toHaveClass('size-ds-icon-md'));

    fireEvent.click(groupTrigger);
    const childTrigger = container.querySelector(
      '[data-timeline-call-trigger]'
    ) as HTMLElement;
    expect(childTrigger).toHaveClass('gap-ds-6', 'py-ds-2');
  });

  it('renders one live-status disclosure for each explicitly delegated agent', () => {
    const delegatedCall = (
      id: string,
      runSequence: number,
      status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled',
      subagentName: string
    ) =>
      normalToolActivity({
        id,
        runSequence,
        status,
        title: `Delegate to ${subagentName}`,
        toolkitName: 'Agent Toolkit',
        methodName: 'agent_run_subagent',
        subagentInvocation: true,
        subagentType: subagentName.toLowerCase().split(' ')[0],
        subagentName,
        subagentStatus: status,
        subagentAgentId: `${id}-agent`,
        agentProvider: 'gemini_agents',
        agentModel: 'gemini-2.5-pro',
        input: `Brief for ${subagentName}`,
        output: status === 'completed' ? `${subagentName} result` : undefined,
      });
    const timelineNodes = [
      delegatedCall('subagent-created', 1, 'pending', 'Research Agent'),
      normalToolActivity({
        id: 'ordinary-agent-named-tool',
        runSequence: 2,
        status: 'completed',
        title: 'agent_run_subagent health check',
        toolkitName: 'Agent Toolkit',
        methodName: 'agent_run_subagent',
      }),
      delegatedCall('subagent-working', 3, 'running', 'Browser Agent'),
      delegatedCall('subagent-finished', 4, 'completed', 'Document Agent'),
      delegatedCall('subagent-failed', 5, 'failed', 'Reviewer Agent'),
      delegatedCall('subagent-cancelled', 6, 'cancelled', 'Builder Agent'),
      runningRunStatus(9),
    ];
    const { container } = render(
      <TimelineModeRenderer
        detailLevel="narrative"
        runs={composeTimelineRuns(timelineNodes)}
      />
    );
    const rows = [
      ...container.querySelectorAll('[data-narrative-subagent-row]'),
    ] as HTMLElement[];
    const ordinaryGroup = container.querySelector(
      '[data-narrative-segment-trigger]'
    ) as HTMLElement;

    expect(rows).toHaveLength(5);
    expect(
      rows.map((row) =>
        row
          .querySelector('[data-narrative-subagent-status-label]')
          ?.textContent?.trim()
      )
    ).toEqual(['Created', 'Working on it', 'Finished', 'Failed', 'Cancelled']);
    const triggers = rows.map(
      (row) =>
        row.querySelector('[data-narrative-subagent-trigger]') as HTMLElement
    );
    expect(
      triggers.map((trigger) => trigger.getAttribute('aria-label'))
    ).toEqual([
      'Research Agent · Created',
      'Browser Agent · Working on it',
      'Document Agent · Finished',
      'Reviewer Agent · Failed',
      'Builder Agent · Cancelled',
    ]);
    rows.forEach((row) => {
      const avatar = row.querySelector('[data-agent-avatar]');
      const name = row.querySelector('[data-narrative-subagent-name]');
      const trigger = row.querySelector('[data-narrative-subagent-trigger]');
      expect(row).toHaveClass('flex', 'w-full', 'items-start');
      expect(avatar).toBeInTheDocument();
      expect(avatar).toHaveClass('rounded-sm');
      expect(name).not.toHaveClass('flex-1');
      expect(trigger).toHaveAttribute('aria-expanded');
      expect(trigger).toHaveClass('gap-ds-6', 'py-ds-4');
    });
    expect(
      rows[0]!.querySelector('[data-agent-avatar="gemini"]')
    ).toBeInTheDocument();

    // Classification is explicit: a similarly named ordinary tool remains in
    // the generic action accordion, between its projected neighbours.
    expect(ordinaryGroup).toHaveAttribute(
      'data-narrative-segment-call-count',
      '1'
    );
    expect(ordinaryGroup).toHaveTextContent('1 action');
    expect(
      rows[0]!.compareDocumentPosition(ordinaryGroup) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      ordinaryGroup.compareDocumentPosition(rows[1]!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    const finishedTrigger = rows[2]!.querySelector(
      '[data-narrative-subagent-trigger]'
    ) as HTMLElement;
    expect(finishedTrigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(finishedTrigger);
    expect(finishedTrigger).toHaveAttribute('aria-expanded', 'true');
    expect(
      within(rows[2]!).getByText('Brief for Document Agent')
    ).toBeInTheDocument();
    expect(
      within(rows[2]!).getByText('Document Agent result')
    ).toBeInTheDocument();

    const failedTrigger = rows[3]!.querySelector(
      '[data-narrative-subagent-trigger]'
    ) as HTMLElement;
    expect(failedTrigger).toHaveAttribute('aria-expanded', 'true');
    expect(
      within(rows[3]!).getByText('No failure details were recorded.')
    ).toBeInTheDocument();

    fireEvent.click(ordinaryGroup);
    expect(
      screen.getByText('agent_run_subagent health check')
    ).toBeInTheDocument();
    expect(
      container.querySelector(
        '[data-timeline-call-id="ordinary-agent-named-tool"]'
      )
    ).toHaveAttribute('data-timeline-action-kind', 'generic');
  });

  it('keeps the event subagent identity aligned with the Session summary identity', () => {
    const timelineNodes: ChatProjectionNode[] = [
      {
        ...base,
        kind: 'step',
        id: 'delegated-step',
        eventId: 'delegated-step',
        eventType: 'step.started',
        runSequence: 1,
        createdAt: '2026-08-19T00:00:01Z',
        stepId: 'delegated-step-1',
        title: 'Research personal-training UX patterns',
        status: 'running',
        phase: 'started',
        source: 'authored',
      },
      normalToolActivity({
        id: 'subagent-identity',
        runSequence: 2,
        title: 'Start delegated research',
        toolCallId: 'a',
        stepId: 'delegated-step-1',
        subagentInvocation: true,
        subagentType: 'fitness_researcher',
        subagentName: 'Fitness UX Researcher',
        subagentStatus: 'running',
        subagentAgentId: 'b',
      }),
      runningRunStatus(3),
    ];
    const { container } = render(
      <TimelineModeRenderer
        detailLevel="narrative"
        runs={composeTimelineRuns(timelineNodes)}
      />
    );
    const row = container.querySelector(
      '[data-narrative-subagent-row]'
    ) as HTMLElement;

    expect(
      within(row).getByRole('button', {
        name: 'Fitness UX Researcher · Working on it',
      })
    ).toBeInTheDocument();
    expect(row.querySelector('[data-agent-avatar="subagent-dog"]')).toHaveClass(
      'rounded-sm'
    );
    expect(
      within(row).getByText('Research personal-training UX patterns')
    ).toBeInTheDocument();
  });

  it('keeps one transient activity marker after running timeline content', () => {
    const runningRuns = composeTimelineRuns(nodes('running'));
    const { container, rerender } = render(
      <TimelineModeRenderer detailLevel="narrative" runs={runningRuns} />
    );

    expect(
      container.querySelector('[data-run-activity-indicator]')
    ).toHaveTextContent('Eigent is working…');

    rerender(
      <TimelineModeRenderer detailLevel="trajectory" runs={runningRuns} />
    );
    expect(
      container.querySelector('[data-run-activity-indicator]')
    ).toHaveTextContent('Eigent is working…');
  });

  it('keeps Preparing visible until the narrative work band can render', () => {
    const { container, rerender } = render(
      <TimelineModeRenderer
        detailLevel="narrative"
        runs={composeTimelineRuns([runningRunStatus(1)])}
      />
    );

    expect(screen.getByText('Preparing to start tasks')).toBeInTheDocument();
    expect(container.querySelector('[data-narrative-run-work-log]')).toBeNull();

    rerender(
      <TimelineModeRenderer
        detailLevel="narrative"
        runs={composeTimelineRuns([
          normalToolActivity({ id: 'first-work', runSequence: 2 }),
          runningRunStatus(3),
        ])}
      />
    );

    expect(screen.queryByText('Preparing to start tasks')).toBeNull();
    expect(
      container.querySelector('[data-narrative-run-work-log]')
    ).toBeInTheDocument();
  });

  it('highlights only the latest running tool and hands off when it completes', () => {
    const firstTool = normalToolActivity({
      id: 'concurrent-read-start',
      runSequence: 1,
      methodName: 'read_file',
      title: 'Read the repository index',
      toolCallId: 'concurrent-read',
    });
    const secondTool = normalToolActivity({
      id: 'concurrent-write-start',
      runSequence: 2,
      methodName: 'write_file',
      title: 'Write the audit notes',
      toolCallId: 'concurrent-write',
    });
    const activeNodes = [firstTool, secondTool, runningRunStatus(9)];
    const { container, rerender } = render(
      <TimelineModeRenderer
        detailLevel="narrative"
        runs={composeTimelineRuns(activeNodes)}
        sessionMode={SessionMode.SINGLE_AGENT}
      />
    );

    openNarrativeSegments(container);

    const first = container.querySelector(
      '[data-timeline-call-id="concurrent-read"]'
    ) as HTMLElement;
    const second = container.querySelector(
      '[data-timeline-call-id="concurrent-write"]'
    ) as HTMLElement;

    expect(first).toHaveAttribute('data-timeline-call-status', 'running');
    expect(second).toHaveAttribute('data-timeline-call-status', 'running');
    expect(first).not.toHaveAttribute('data-timeline-call-highlighted');
    expect(second).toHaveAttribute('data-timeline-call-highlighted', 'true');
    expect(container.querySelectorAll('.shiny-text')).toHaveLength(1);
    expect(
      within(second).getByText('Waiting for a response.')
    ).toBeInTheDocument();

    fireEvent.click(
      first.querySelector('[data-timeline-call-trigger]') as HTMLElement
    );
    expect(
      within(first).getByText('Waiting for a response.')
    ).toBeInTheDocument();

    rerender(
      <TimelineModeRenderer
        detailLevel="narrative"
        runs={composeTimelineRuns([
          firstTool,
          secondTool,
          normalToolActivity({
            id: 'concurrent-write-complete',
            runSequence: 3,
            status: 'completed',
            methodName: 'write_file',
            title: 'Write the audit notes',
            toolCallId: 'concurrent-write',
          }),
          runningRunStatus(9),
        ])}
        sessionMode={SessionMode.SINGLE_AGENT}
      />
    );

    const updatedFirst = container.querySelector(
      '[data-timeline-call-id="concurrent-read"]'
    ) as HTMLElement;
    const updatedSecond = container.querySelector(
      '[data-timeline-call-id="concurrent-write"]'
    ) as HTMLElement;
    expect(updatedFirst).toHaveAttribute(
      'data-timeline-call-highlighted',
      'true'
    );
    expect(updatedSecond).not.toHaveAttribute('data-timeline-call-highlighted');
    expect(updatedSecond).toHaveAttribute(
      'data-timeline-call-status',
      'completed'
    );
    expect(container.querySelectorAll('.shiny-text')).toHaveLength(1);
  });

  it('renders running reasoning activity in the default text color without shimmer', () => {
    const reasoningNode: ChatProjectionNode = {
      ...base,
      kind: 'activity',
      id: 'readme-reasoning',
      eventId: 'readme-reasoning',
      eventType: 'work_log.progress',
      runSequence: 1,
      createdAt: '2026-08-19T00:00:00Z',
      activityType: 'work_log',
      phase: 'progress',
      status: 'running',
      title: 'Searching for README files in the project',
    };
    const { container } = render(
      <TimelineModeRenderer
        detailLevel="narrative"
        runs={composeTimelineRuns([reasoningNode, runningRunStatus(9)])}
        sessionMode={SessionMode.SINGLE_AGENT}
      />
    );

    const reasoning = screen.getByText(
      'Searching for README files in the project'
    );
    expect(reasoning).toHaveClass('text-ds-ink-default-default');
    expect(reasoning).not.toHaveClass(
      'text-ds-ink-subtle-default',
      'shiny-text'
    );
    expect(container.querySelector('.shiny-text')).toBeNull();
  });

  it('moves the only repeated-tool shimmer from the closed group to the latest child', () => {
    const repeatedTools = [
      normalToolActivity({
        id: 'repeat-one',
        runSequence: 1,
        title: 'Search the first README',
        toolCallId: 'repeat-one',
      }),
      normalToolActivity({
        id: 'repeat-two',
        runSequence: 2,
        title: 'Search the second README',
        toolCallId: 'repeat-two',
      }),
      runningRunStatus(9),
    ];
    const { container } = render(
      <TimelineModeRenderer
        detailLevel="narrative"
        runs={composeTimelineRuns(repeatedTools)}
        sessionMode={SessionMode.SINGLE_AGENT}
      />
    );

    // Two identical consecutive calls form one segment. While it is folded the
    // shimmer sits on the segment label; opening it hands the shimmer to the
    // call that actually owns it, so exactly one indicator shows either way.
    const segmentTrigger = container.querySelector(
      '[data-narrative-segment-trigger]'
    ) as HTMLElement;
    expect(segmentTrigger.querySelector('.shiny-text')).toBeInTheDocument();
    expect(container.querySelectorAll('.shiny-text')).toHaveLength(1);

    fireEvent.click(segmentTrigger);

    const latest = container.querySelector(
      '[data-timeline-call-id="repeat-two"]'
    ) as HTMLElement;
    expect(segmentTrigger.querySelector('.shiny-text')).toBeNull();
    expect(latest).toHaveAttribute('data-timeline-call-highlighted', 'true');
    expect(latest.querySelector('.shiny-text')).toBeInTheDocument();
    expect(container.querySelectorAll('.shiny-text')).toHaveLength(1);
  });

  it('animates the work-log lifecycle when the first live event arrives', () => {
    const { container, rerender } = render(
      <TimelineModeRenderer
        detailLevel="narrative"
        runs={composeTimelineRuns([runningRunStatus(9)])}
        sessionMode={SessionMode.SINGLE_AGENT}
      />
    );
    expect(container.querySelector('[data-narrative-run-motion]')).toBeNull();

    const liveRuns = composeTimelineRuns([
      normalToolActivity({ id: 'first-live-event', runSequence: 1 }),
      runningRunStatus(9),
    ]);
    rerender(
      <TimelineModeRenderer
        detailLevel="narrative"
        runs={liveRuns}
        sessionMode={SessionMode.SINGLE_AGENT}
      />
    );

    const workLogMotion = container.querySelector(
      '[data-narrative-run-motion="standard"]'
    ) as HTMLElement;
    expect(workLogMotion).toHaveAttribute('data-narrative-run-work-log');
    expect(workLogMotion).toHaveAttribute(
      'data-narrative-run-motion-id',
      liveRuns[0]!.id
    );
    expect(workLogMotion).toHaveStyle({ opacity: '0' });
    expect(workLogMotion.style.transform).toBe('');
    expect(
      workLogMotion.querySelector('[data-narrative-segment-id]')
    ).toBeInTheDocument();
    expect(
      workLogMotion.querySelector('[data-narrative-event-motion]')
    ).toBeInTheDocument();
  });

  it('marks event entries as reduced when reduced motion is requested', () => {
    motionPreference.reduced = true;
    const { container } = render(
      <TimelineModeRenderer
        detailLevel="narrative"
        runs={composeTimelineRuns([
          normalToolActivity({ id: 'reduced-motion', runSequence: 1 }),
          runningRunStatus(9),
        ])}
        sessionMode={SessionMode.SINGLE_AGENT}
      />
    );

    expect(
      container.querySelector('[data-narrative-run-motion="reduced"]')
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-narrative-run-motion="standard"]')
    ).toBeNull();
  });

  it('renders tool calls as status-free accordions and colors failures as errors', () => {
    const toolNodes: ChatProjectionNode[] = [
      {
        ...base,
        kind: 'activity',
        id: 'success-tool',
        eventId: 'success-tool',
        eventType: 'tool.completed',
        runSequence: 1,
        createdAt: '2026-08-19T00:00:00Z',
        activityType: 'tool',
        phase: 'completed',
        status: 'completed',
        title: 'Success Toolkit · Read',
        output: 'Safe response value',
        toolCallId: 'success-tool',
        toolkitName: 'Success Toolkit',
        methodName: 'Read',
      },
      {
        ...base,
        kind: 'activity',
        id: 'failed-tool',
        eventId: 'failed-tool',
        eventType: 'tool.failed',
        runSequence: 2,
        createdAt: '2026-08-19T00:00:01Z',
        activityType: 'tool',
        phase: 'completed',
        status: 'failed',
        title: 'Failure Toolkit · Write',
        toolCallId: 'failed-tool',
        toolkitName: 'Failure Toolkit',
        methodName: 'Write',
      },
      {
        ...base,
        kind: 'activity',
        id: 'timed-out-tool',
        eventId: 'timed-out-tool',
        eventType: 'tool.timed_out',
        runSequence: 3,
        createdAt: '2026-08-19T00:00:02Z',
        activityType: 'tool',
        phase: 'completed',
        status: 'timed_out',
        title: 'Timeout Toolkit · Fetch',
        toolCallId: 'timed-out-tool',
        toolkitName: 'Timeout Toolkit',
        methodName: 'Fetch',
      },
      {
        ...base,
        kind: 'activity',
        id: 'unknown-tool',
        eventId: 'unknown-tool',
        eventType: 'tool.outcome_unknown',
        runSequence: 4,
        createdAt: '2026-08-19T00:00:03Z',
        activityType: 'tool',
        phase: 'completed',
        status: 'outcome_unknown',
        title: 'Unknown Toolkit · Execute',
        toolCallId: 'unknown-tool',
        toolkitName: 'Unknown Toolkit',
        methodName: 'Execute',
      },
      {
        ...base,
        kind: 'run_status',
        id: 'tool-status-run',
        eventId: 'tool-status-run',
        eventType: 'run.running',
        runSequence: 5,
        createdAt: '2026-08-19T00:00:04Z',
        status: 'running',
      },
    ];

    const { container } = render(
      <TimelineModeRenderer
        detailLevel="narrative"
        runs={composeTimelineRuns(toolNodes)}
        sessionMode={SessionMode.SINGLE_AGENT}
      />
    );

    openNarrativeSegments(container);

    const success = container.querySelector(
      '[data-timeline-call-id="success-tool"]'
    ) as HTMLElement;
    const successTrigger = success.querySelector(
      '[data-timeline-call-trigger]'
    ) as HTMLElement;
    expect(successTrigger).not.toHaveClass(
      'text-ds-text-status-error-default-default'
    );
    expect(successTrigger.querySelectorAll('svg')).toHaveLength(2);
    fireEvent.click(successTrigger);
    expect(within(success).queryByText('Request')).not.toBeInTheDocument();
    expect(
      within(success).queryByText('No request was recorded for this event.')
    ).not.toBeInTheDocument();
    expect(within(success).getByText('Response')).toBeInTheDocument();
    expect(
      within(success).getByText('Safe response value')
    ).toBeInTheDocument();

    for (const status of ['failed', 'timed_out', 'outcome_unknown']) {
      const tool = container.querySelector(
        '[data-timeline-call-status="' + status + '"]'
      ) as HTMLElement;
      const trigger = tool.querySelector(
        '[data-timeline-call-trigger]'
      ) as HTMLElement;
      expect(trigger).toHaveClass('text-ds-text-status-error-default-default');
      expect(trigger.querySelectorAll('svg')).toHaveLength(2);
    }
  });

  it('renders single-agent Normal as one flat chronological event list', () => {
    const chronologicalNodes: ChatProjectionNode[] = [
      {
        ...base,
        kind: 'plan',
        id: 'plan-1',
        eventId: 'plan-1',
        eventType: 'plan.created',
        runSequence: 1,
        createdAt: '2026-08-19T00:00:00Z',
        status: 'active',
        title: 'Plan',
        tasks: [],
      },
      {
        ...base,
        kind: 'message',
        id: 'reasoning-before',
        eventId: 'reasoning-before',
        eventType: 'message.completed',
        runSequence: 2,
        createdAt: '2026-08-19T00:00:01Z',
        role: 'assistant',
        purpose: 'narration',
        status: 'complete',
        content: 'I will search two indexes first.',
        agentName: 'single_agent',
      },
      ...['first', 'second'].map((suffix, index): ChatProjectionNode => ({
        ...base,
        kind: 'activity',
        id: `search-${suffix}`,
        eventId: `search-${suffix}`,
        eventType: 'tool.completed',
        runSequence: index + 3,
        createdAt: `2026-08-19T00:00:0${index + 2}Z`,
        activityType: 'tool',
        phase: 'completed',
        status: 'completed',
        title: 'WebFetchToolkit · Search',
        toolCallId: `search-${suffix}`,
        toolkitName: 'WebFetchToolkit',
        methodName: 'Search',
      })),
      {
        ...base,
        kind: 'message',
        id: 'reasoning-between',
        eventId: 'reasoning-between',
        eventType: 'message.completed',
        runSequence: 5,
        createdAt: '2026-08-19T00:00:04Z',
        role: 'assistant',
        purpose: 'narration',
        status: 'complete',
        content: 'The first indexes disagree, so I need your input.',
      },
      {
        ...base,
        kind: 'interaction',
        id: 'permission-request',
        eventId: 'permission-request',
        eventType: 'approval.requested',
        runSequence: 6,
        createdAt: '2026-08-19T00:00:05Z',
        interactionId: 'approval:search-third',
        interactionType: 'approval',
        status: 'requested',
        prompt: 'Allow another search?',
      },
      {
        ...base,
        kind: 'activity',
        id: 'search-third',
        eventId: 'search-third',
        eventType: 'tool.completed',
        runSequence: 7,
        createdAt: '2026-08-19T00:00:06Z',
        activityType: 'tool',
        phase: 'completed',
        status: 'completed',
        title: 'WebFetchToolkit · Search',
        toolCallId: 'search-third',
        toolkitName: 'WebFetchToolkit',
        methodName: 'Search',
      },
      {
        ...base,
        kind: 'activity',
        id: 'system-event',
        eventId: 'system-event',
        eventType: 'agent.completed',
        runSequence: 8,
        createdAt: '2026-08-19T00:00:07Z',
        activityType: 'agent',
        phase: 'completed',
        status: 'completed',
        title: 'Agent finished',
      },
    ];

    const { container } = render(
      <TimelineModeRenderer
        detailLevel="narrative"
        runs={composeTimelineRuns(chronologicalNodes)}
        sessionMode={SessionMode.SINGLE_AGENT}
      />
    );

    expect(
      container.querySelector('[data-narrative-timeline]')
    ).toBeInTheDocument();

    // Reasoning, then the interrupt it triggered, then the work that followed.
    // Narrative keeps source order; it only changes how each item is drawn.
    const reasoning = screen.getByText(
      'The first indexes disagree, so I need your input.'
    );
    const permission = container.querySelector(
      '[data-timeline-call-executor="human"]'
    ) as HTMLElement;
    const laterSegments = [
      ...container.querySelectorAll('[data-narrative-segment-id]'),
    ];
    const thirdTool = laterSegments.at(-1) as HTMLElement;

    expect(permission).toBeInTheDocument();
    expect(
      reasoning.compareDocumentPosition(permission) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      permission.compareDocumentPosition(thirdTool) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // Agent lifecycle frames supply identity metadata, never timeline rows.
    expect(screen.queryByText('Agent finished')).toBeNull();
  });

  it('nests each workforce agent in its own accordion', () => {
    const workforceNodes: ChatProjectionNode[] = [
      {
        ...base,
        kind: 'message',
        id: 'alpha-narration',
        eventId: 'alpha-narration',
        eventType: 'message.completed',
        runSequence: 1,
        createdAt: '2026-08-19T00:00:01Z',
        role: 'assistant',
        purpose: 'narration',
        status: 'complete',
        content: 'Alpha will search first.',
        agentId: 'alpha',
        agentName: 'Alpha Agent',
      },
      {
        ...base,
        kind: 'activity',
        id: 'alpha-search',
        eventId: 'alpha-search',
        eventType: 'tool.completed',
        runSequence: 2,
        createdAt: '2026-08-19T00:00:02Z',
        activityType: 'tool',
        phase: 'completed',
        status: 'completed',
        title: 'WebFetchToolkit · Search',
        toolCallId: 'alpha-search',
        toolkitName: 'WebFetchToolkit',
        methodName: 'Search',
        agentId: 'alpha',
        agentName: 'Alpha Agent',
      },
      {
        ...base,
        kind: 'message',
        id: 'beta-narration',
        eventId: 'beta-narration',
        eventType: 'message.completed',
        runSequence: 3,
        createdAt: '2026-08-19T00:00:03Z',
        role: 'assistant',
        purpose: 'narration',
        status: 'complete',
        content: 'Beta will write the notes.',
        agentId: 'beta',
        agentName: 'Beta Agent',
      },
      {
        ...base,
        kind: 'run_status',
        id: 'run-running',
        eventId: 'run-running',
        eventType: 'run.running',
        runSequence: 4,
        createdAt: '2026-08-19T00:00:04Z',
        status: 'running',
      },
    ];

    const { container, rerender } = render(
      <TimelineModeRenderer
        detailLevel="narrative"
        runs={composeTimelineRuns(workforceNodes)}
        sessionMode={SessionMode.WORKFORCE}
      />
    );

    const groups = [
      ...container.querySelectorAll('[data-narrative-agent-group]'),
    ].map((element) => element.getAttribute('data-narrative-agent-group'));
    expect(groups).toEqual(['Alpha Agent', 'Beta Agent']);
    expect(
      screen.queryByText('Alpha will search first.')
    ).not.toBeInTheDocument();
    expect(screen.getByText('Beta will write the notes.')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Alpha Agent' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(screen.getByRole('button', { name: 'Beta Agent' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    rerender(
      <TimelineModeRenderer
        detailLevel="narrative"
        paused
        runs={composeTimelineRuns(workforceNodes)}
        sessionMode={SessionMode.WORKFORCE}
      />
    );
    expect(screen.getByRole('button', { name: 'Alpha Agent' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(screen.getByRole('button', { name: 'Beta Agent' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    rerender(
      <TimelineModeRenderer
        detailLevel="narrative"
        runs={composeTimelineRuns(workforceNodes)}
        sessionMode={SessionMode.WORKFORCE}
      />
    );
    expect(screen.getByRole('button', { name: 'Alpha Agent' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Alpha Agent' }));
    expect(screen.getByText('Alpha will search first.')).toBeInTheDocument();
  });

  it.each(['completed', 'failed', 'cancelled', 'interrupted'] as const)(
    'shows terminal %s Run artifacts without a final assistant response',
    (status) => {
      const artifact = nodes('completed').find(
        (node) => node.kind === 'artifact'
      )!;
      const terminalStatus: ChatProjectionNode = {
        ...base,
        kind: 'run_status',
        id: `run-${status}`,
        eventId: `run-${status}`,
        eventType: `run.${status}`,
        runSequence: 6,
        createdAt: '2026-08-19T00:00:05Z',
        status,
      };

      render(
        <TimelineModeRenderer
          detailLevel="narrative"
          runs={composeTimelineRuns([artifact, terminalStatus])}
        />
      );

      expect(screen.getByText('Edited 1 file')).toBeInTheDocument();
    }
  );

  it('keeps approvals at their chronological position after a repeated event group', () => {
    const approvalNodes: ChatProjectionNode[] = [
      {
        ...base,
        kind: 'activity',
        id: 'mcp-call-1-start',
        eventId: 'mcp-call-1-start',
        eventType: 'tool.started',
        runSequence: 1,
        createdAt: '2026-08-19T00:00:00Z',
        activityType: 'tool',
        phase: 'started',
        status: 'running',
        title: 'MCPToolkit · Execute_action one',
        toolCallId: 'mcp-call-1',
        toolkitName: 'MCPToolkit',
        methodName: 'Execute_action',
      },
      {
        ...base,
        kind: 'activity',
        id: 'mcp-call-2-start',
        eventId: 'mcp-call-2-start',
        eventType: 'tool.started',
        runSequence: 2,
        createdAt: '2026-08-19T00:00:01Z',
        activityType: 'tool',
        phase: 'started',
        status: 'running',
        title: 'MCPToolkit · Execute_action two',
        toolCallId: 'mcp-call-2',
        toolkitName: 'MCPToolkit',
        methodName: 'Execute_action',
      },
      {
        ...base,
        kind: 'interaction',
        id: 'approval-call-1',
        eventId: 'approval-call-1',
        eventType: 'approval.decided',
        runSequence: 3,
        createdAt: '2026-08-19T00:00:02Z',
        interactionId: 'approval:mcp-call-1',
        interactionType: 'approval',
        status: 'responded',
        prompt: 'Allow the first MCP action?',
        response: 'approved',
      },
      {
        ...base,
        kind: 'interaction',
        id: 'approval-call-2',
        eventId: 'approval-call-2',
        eventType: 'approval.decided',
        runSequence: 4,
        createdAt: '2026-08-19T00:00:03Z',
        interactionId: 'approval:mcp-call-2',
        interactionType: 'approval',
        status: 'responded',
        prompt: 'Allow the second MCP action?',
        response: 'rejected',
      },
      {
        ...base,
        kind: 'activity',
        id: 'mcp-call-1-end',
        eventId: 'mcp-call-1-end',
        eventType: 'tool.completed',
        runSequence: 5,
        createdAt: '2026-08-19T00:00:04Z',
        activityType: 'tool',
        phase: 'completed',
        status: 'completed',
        title: 'MCPToolkit · Execute_action one',
        toolCallId: 'mcp-call-1',
        toolkitName: 'MCPToolkit',
        methodName: 'Execute_action',
      },
      {
        ...base,
        kind: 'activity',
        id: 'mcp-call-2-end',
        eventId: 'mcp-call-2-end',
        eventType: 'tool.completed',
        runSequence: 6,
        createdAt: '2026-08-19T00:00:05Z',
        activityType: 'tool',
        phase: 'completed',
        status: 'completed',
        title: 'MCPToolkit · Execute_action two',
        toolCallId: 'mcp-call-2',
        toolkitName: 'MCPToolkit',
        methodName: 'Execute_action',
      },
      {
        ...base,
        kind: 'run_status',
        id: 'approval-run-running',
        eventId: 'approval-run-running',
        eventType: 'run.running',
        runSequence: 7,
        createdAt: '2026-08-19T00:00:06Z',
        status: 'running',
      },
    ];

    const { container } = render(
      <TimelineModeRenderer
        detailLevel="narrative"
        runs={composeTimelineRuns(approvalNodes)}
        sessionMode={SessionMode.SINGLE_AGENT}
      />
    );

    const toolSegment = container.querySelector(
      '[data-narrative-segment-id]'
    ) as HTMLElement;
    const receipts = container.querySelectorAll(
      '[data-timeline-call-executor="human"]'
    );

    // Both decisions are recorded like tool calls, with the human as the
    // executor, and neither is folded into the toolkit segment before them.
    expect(receipts).toHaveLength(2);
    expect(
      within(receipts[0] as HTMLElement).getByText('You · Allowed')
    ).toBeInTheDocument();
    expect(
      within(receipts[1] as HTMLElement).getByText('You · Rejected')
    ).toBeInTheDocument();
    expect(
      toolSegment.compareDocumentPosition(receipts[0]!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      receipts[0]!.compareDocumentPosition(receipts[1]!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    openNarrativeSegments(container);
    expect(
      container.querySelector('[data-timeline-call-id="mcp-call-1"]')
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-timeline-call-id="mcp-call-2"]')
    ).toBeInTheDocument();
  });

  it('keeps a human question after its triggering tool in the same agent block', () => {
    const humanToolNodes: ChatProjectionNode[] = [
      {
        ...base,
        kind: 'activity',
        id: 'human-tool-start',
        eventId: 'human-tool-start',
        eventType: 'legacy.activate_toolkit',
        legacyStep: 'activate_toolkit',
        runSequence: 1,
        createdAt: '2026-08-19T00:00:00Z',
        activityType: 'tool',
        phase: 'started',
        status: 'running',
        title: 'Human Toolkit · Ask human via gui',
        input: 'Which mesh should be the reference?',
        agentName: 'single_agent',
        taskId: 'task-1',
        toolkitName: 'Human Toolkit',
        methodName: 'Ask human via gui',
      },
      {
        ...base,
        kind: 'interaction',
        id: 'mesh-choice',
        eventId: 'mesh-choice',
        eventType: 'interaction.resolved',
        runSequence: 2,
        createdAt: '2026-08-19T00:00:01Z',
        interactionId: 'mesh-choice',
        interactionType: 'question',
        status: 'responded',
        prompt: 'Which mesh should be the reference?',
        response: 'Use the right hemisphere',
      },
      {
        ...base,
        kind: 'activity',
        id: 'human-tool-end',
        eventId: 'human-tool-end',
        eventType: 'legacy.deactivate_toolkit',
        legacyStep: 'deactivate_toolkit',
        runSequence: 3,
        createdAt: '2026-08-19T00:00:02Z',
        activityType: 'tool',
        phase: 'completed',
        status: 'completed',
        title: 'Human Toolkit · Ask human via gui',
        output: 'Use the right hemisphere',
        agentName: 'single_agent',
        taskId: 'task-1',
        toolkitName: 'Human Toolkit',
        methodName: 'Ask human via gui',
      },
      {
        ...base,
        kind: 'run_status',
        id: 'human-run-running',
        eventId: 'human-run-running',
        eventType: 'run.running',
        runSequence: 4,
        createdAt: '2026-08-19T00:00:03Z',
        status: 'running',
      },
    ];

    const { container } = render(
      <TimelineModeRenderer
        detailLevel="narrative"
        runs={composeTimelineRuns(humanToolNodes)}
        sessionMode={SessionMode.SINGLE_AGENT}
      />
    );
    const timeline = container.querySelector(
      '[data-narrative-timeline]'
    ) as HTMLElement;
    const tool = timeline.querySelector(
      '[data-narrative-segment-id]'
    ) as HTMLElement;
    const receipt = timeline.querySelector(
      '[data-timeline-call-executor="human"]'
    ) as HTMLElement;

    expect(tool).toBeInTheDocument();
    expect(receipt).toBeInTheDocument();
    expect(within(receipt).getByText('You · Answered')).toBeInTheDocument();

    // The answer is the response half of a human-executed call, so it reads
    // through the same Request/Response disclosure a tool call uses.
    fireEvent.click(
      receipt.querySelector('[data-timeline-call-trigger]') as HTMLElement
    );
    expect(within(receipt).getByText('Question')).toBeInTheDocument();
    expect(within(receipt).getByText('Answer')).toBeInTheDocument();
    expect(
      within(receipt).getByText('Use the right hemisphere')
    ).toBeInTheDocument();
    expect(
      tool.compareDocumentPosition(receipt) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('advances elapsed time from the authoritative attempt anchor', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-19T00:00:10Z'));
    const composed = composeTimelineRuns(nodes('running'))[0]!;
    const run = reconcileTimelineRun(composed, {
      runId: 'run-1',
      status: 'running',
      lastSequence: 3,
      runVersion: 1,
      updatedAt: '2026-08-19T00:00:05Z',
      totalAttemptElapsedMs: 3_000,
    });

    render(<TimelineModeRenderer detailLevel="narrative" runs={[run]} />);
    const workLogTrigger = screen.getByRole('button', {
      name: 'Working on tasks for 8s',
    });
    expect(workLogTrigger).not.toHaveTextContent('<elapsed>');
    expect(workLogTrigger).not.toHaveTextContent('{{time}}');
    expect(screen.getByText('8s')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByText('10s')).toBeInTheDocument();
  });

  it('renders the completed work-log duration without translation markup', () => {
    render(
      <TimelineModeRenderer
        detailLevel="narrative"
        runs={composeTimelineRuns(nodes('completed'))}
      />
    );

    const workLogTrigger = screen.getByRole('button', {
      name: 'Worked for 5s',
    });
    expect(workLogTrigger).not.toHaveTextContent('<elapsed>');
    expect(workLogTrigger).not.toHaveTextContent('{{time}}');
  });

  it('holds elapsed time and the shimmer while the user has taken control', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-19T00:00:10Z'));
    const composed = composeTimelineRuns(nodes('running'))[0]!;
    const run = reconcileTimelineRun(composed, {
      runId: 'run-1',
      status: 'running',
      lastSequence: 3,
      runVersion: 1,
      updatedAt: '2026-08-19T00:00:05Z',
      totalAttemptElapsedMs: 3_000,
    });

    const { container, rerender } = render(
      <TimelineModeRenderer detailLevel="narrative" runs={[run]} />
    );
    expect(screen.getByText('8s')).toBeInTheDocument();
    expect(container.querySelectorAll('.shiny-text')).toHaveLength(1);

    // Pause: the timer freezes and the running shimmer stops.
    rerender(
      <TimelineModeRenderer detailLevel="narrative" paused runs={[run]} />
    );
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByText('8s')).toBeInTheDocument();
    expect(container.querySelectorAll('.shiny-text')).toHaveLength(0);
    expect(screen.getByText(/Paused after/)).toBeInTheDocument();
    // A pause is not an ending, so the work log stays open.
    expect(
      container.querySelector('[data-narrative-timeline]')
    ).toBeInTheDocument();

    // Resume: counting continues from where it stopped, not from wall clock.
    rerender(<TimelineModeRenderer detailLevel="narrative" runs={[run]} />);
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByText('10s')).toBeInTheDocument();
    expect(container.querySelectorAll('.shiny-text')).toHaveLength(1);
    expect(screen.getByText(/Working on tasks for/)).toBeInTheDocument();
  });
});
