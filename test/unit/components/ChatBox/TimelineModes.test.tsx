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
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

describe('ChatBox timeline modes', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders Detailed as labelled rows with vertical Input then Output', () => {
    const runs = composeTimelineRuns(nodes('completed'));
    const { container } = render(
      <TimelineModeRenderer detailLevel="detailed" runs={runs} />
    );

    expect(
      container.querySelector('[data-timeline-mode="detailed"]')
    ).toBeTruthy();
    expect(screen.getByText('USER')).toBeInTheDocument();
    expect(screen.getByText('ASSISTANT')).toBeInTheDocument();
    expect(screen.getByText('TOOL')).toBeInTheDocument();

    const rows = container.querySelectorAll('[data-detailed-trace-row]');
    expect(rows.length).toBeGreaterThan(0);
    expect(container.querySelectorAll('[data-trace-chevron]')).toHaveLength(
      rows.length
    );
    rows.forEach((row) => {
      const rowButton = row.querySelector(':scope > button');
      expect(row).toHaveAttribute('data-expanded', 'false');
      expect(row).toHaveClass(
        'bg-transparent',
        'hover:bg-ds-bg-neutral-default-default'
      );
      expect(row.querySelectorAll(':scope > button')).toHaveLength(1);
      expect(rowButton).toHaveClass('flex', 'flex-row', 'items-center');
      expect(rowButton).not.toHaveClass('grid');
      expect(row.querySelector('[data-trace-summary]')).toHaveClass(
        'flex-1',
        'truncate',
        '!text-label-xs'
      );
      expect(row.querySelector('[data-trace-tag-column]')).toHaveClass(
        'w-28',
        'shrink-0',
        'justify-end'
      );
      expect(row.querySelector('[data-trace-tag]')).toHaveClass(
        'max-w-full',
        'text-right',
        '!text-label-xs'
      );
      expect(row.querySelector('[data-trace-ending]')).toHaveClass(
        'ml-auto',
        'shrink-0'
      );
    });
    expect(
      container.querySelector('[data-timeline-mode="detailed"] ol')
    ).toHaveClass('bg-transparent');

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
      '!text-label-xs'
    );
  });

  it('auto-expands a pending question and folds it after the answer arrives', () => {
    const { container, rerender } = render(
      <TimelineModeRenderer
        detailLevel="detailed"
        runs={composeTimelineRuns(interactionNodes('requested'))}
      />
    );

    const row = container.querySelector(
      '[data-trace-category="input-required"]'
    ) as HTMLElement;
    expect(row).toHaveAttribute('data-expanded', 'true');
    expect(within(row).getByText('Question')).toHaveClass('!text-label-xs');
    expect(
      within(row).getAllByText('Which output format should I use?')[1]
    ).toHaveClass('!text-label-xs');

    rerender(
      <TimelineModeRenderer
        detailLevel="detailed"
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
      '!text-label-xs'
    );
    expect(within(resolvedRow).getByText('Answer')).toHaveClass(
      '!text-label-xs'
    );
    expect(within(resolvedRow).getByText('Markdown file')).toHaveClass(
      '!text-label-xs'
    );
  });

  it('renders event-native Normal with the legacy work-log disclosure', () => {
    const runs = composeTimelineRuns(nodes('running'));
    const { container } = render(
      <TimelineModeRenderer detailLevel="normal" runs={runs} />
    );

    expect(
      container.querySelector('[data-timeline-mode="normal"]')
    ).toBeTruthy();
    expect(screen.getByText('Review the event timeline')).toBeInTheDocument();
    expect(screen.getByText('timeline-notes.md')).toBeInTheDocument();
    expect(screen.getByText(/Working on tasks for/)).toBeInTheDocument();
    expect(screen.getByText('Request')).toBeInTheDocument();
    expect(
      screen.getByText('src/components/ChatBox/index.tsx')
    ).toBeInTheDocument();
  });

  it('keeps Summarised to query, one Run row, and one terminal files row', () => {
    const runs = composeTimelineRuns(nodes('completed'));
    const { container } = render(
      <TimelineModeRenderer detailLevel="summarized" runs={runs} />
    );

    expect(
      container.querySelector('[data-timeline-mode="summarized"]')
    ).toBeTruthy();
    expect(container.querySelectorAll('[data-run-summary-card]')).toHaveLength(
      1
    );
    expect(
      container.querySelectorAll('[data-files-changed-summary]')
    ).toHaveLength(1);
    const summaryGroup = container.querySelector(
      '[data-run-summary-group]'
    ) as HTMLElement;
    expect(summaryGroup).toHaveClass(
      'overflow-hidden',
      'rounded-2xl',
      'border'
    );
    expect(
      within(summaryGroup).getByText('completed').parentElement
    ).toHaveClass('!text-label-xs', '!font-normal');
    expect(within(summaryGroup).getByText('Files changed')).toBeInTheDocument();
    expect(screen.getByText('Review the event timeline')).toBeInTheDocument();
    expect(screen.getByText('timeline-notes.md')).toBeInTheDocument();
    expect(screen.getByText('tool call')).toBeInTheDocument();
    expect(screen.getByText('agent message')).toBeInTheDocument();
    expect(screen.getByText('Files changed')).toBeInTheDocument();
    expect(screen.queryByText('src/timeline.tsx')).toBeNull();
    expect(screen.getAllByText('Files changed')).toHaveLength(1);
    expect(screen.queryByText('I will inspect the implementation.')).toBeNull();
  });

  it('advances Summarised elapsed time from the authoritative attempt anchor', () => {
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

    render(<TimelineModeRenderer detailLevel="summarized" runs={[run]} />);
    expect(screen.getByText('8s')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByText('10s')).toBeInTheDocument();
  });
});
