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

import { CallRow } from '@/components/ChatBox/TimelineModes/CallRow';
import {
  timelineCallTitle,
  type TimelineCall,
} from '@/lib/projector/chat/presentation';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

function humanCall(status: TimelineCall['status']): TimelineCall {
  return {
    id: 'question-1',
    runId: 'run-1',
    executor: 'human',
    title: 'You · Answer',
    actionKind: 'message',
    status,
    input: 'Which format should the report use?',
    inputLabel: 'Question',
    outputLabel: 'Answer',
    interactionId: 'interaction-1',
  } as TimelineCall;
}

describe('CallRow', () => {
  it('folds an answered question even after the user toggled it', () => {
    const { rerender } = render(
      <CallRow call={humanCall('pending')} runActive reducedMotion />
    );
    const trigger = screen.getByRole('button', { name: /You · Answer/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    rerender(<CallRow call={humanCall('completed')} runActive reducedMotion />);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps a manual choice on a call that was never pending', () => {
    const toolCall = {
      ...humanCall('running'),
      executor: 'toolkit',
      title: 'Search Toolkit · search',
      actionKind: 'search',
    } as TimelineCall;
    const { rerender } = render(
      <CallRow call={toolCall} runActive reducedMotion />
    );
    const trigger = screen.getByRole('button', { name: /Search Toolkit/ });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    rerender(
      <CallRow
        call={{ ...toolCall, status: 'completed' }}
        runActive
        reducedMotion
      />
    );
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  function toolCall(
    status: TimelineCall['status'],
    extra: Partial<TimelineCall> = {}
  ): TimelineCall {
    return {
      id: 'tool-1',
      runId: 'run-1',
      executor: 'toolkit',
      title: 'File Toolkit · read_file',
      actionKind: 'inspect',
      status,
      inputLabel: 'Request',
      outputLabel: 'Response',
      toolCallId: 'tool-1',
      ...extra,
    } as TimelineCall;
  }

  it('renders a plain line when a running call has nothing to reveal', () => {
    const { container } = render(
      <CallRow call={toolCall('running')} runActive reducedMotion />
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(
      container.querySelector('[data-timeline-call-line]')
    ).toHaveTextContent('File Toolkit · read_file');
  });

  it('becomes a trigger once the call has detail', () => {
    render(
      <CallRow
        call={toolCall('running', { input: 'src/index.ts' })}
        runActive
        reducedMotion
      />
    );
    expect(
      screen.getByRole('button', { name: /File Toolkit/ })
    ).toHaveAttribute('aria-expanded', 'false');
  });

  it('states a stopped outcome in words at rest', () => {
    const { rerender } = render(
      <CallRow call={toolCall('cancelled')} runActive={false} reducedMotion />
    );
    expect(screen.getByText('Cancelled')).toHaveAttribute(
      'data-timeline-call-resting-description'
    );

    rerender(
      <CallRow call={toolCall('failed')} runActive={false} reducedMotion />
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('keeps lifecycle-only completed calls as plain lines', () => {
    render(
      <CallRow
        call={toolCall('completed', {
          durationMs: 2_100,
          detail: 'Completed in 2.1 s',
        })}
        runActive={false}
        reducedMotion
      />
    );
    expect(screen.queryByText(/2\.1 s|Completed in/)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('opens request and response without a lifecycle duration header', () => {
    render(
      <CallRow
        call={toolCall('completed', {
          input: 'Query: Eigent AI',
          output: 'Sources: https://www.eigent.ai/',
          detail: 'Completed in 465 ms',
          durationMs: 465,
        })}
        runActive={false}
        reducedMotion
      />
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Query: Eigent AI')).toBeInTheDocument();
    expect(
      screen.getByText('Sources: https://www.eigent.ai/')
    ).toBeInTheDocument();
    expect(screen.queryByText(/Completed in|465 ms/)).toBeNull();
  });

  it('titles a fallback-named call in the tense of its outcome', () => {
    const command = (status: TimelineCall['status']) =>
      toolCall(status, {
        toolkitName: 'Terminal Toolkit',
        methodName: 'shell_exec',
        title: 'Terminal Toolkit · shell_exec',
        actionKind: 'command',
        input: 'npm test',
      });
    const subject = (status: TimelineCall['status']) =>
      timelineCallTitle(command(status), { subject: 'npm test' });
    const { rerender } = render(
      <CallRow
        call={command('running')}
        title={subject('running')}
        runActive
        reducedMotion
      />
    );
    expect(screen.getByRole('button')).toHaveTextContent('Running npm test');

    rerender(
      <CallRow
        call={command('completed')}
        title={subject('completed')}
        runActive={false}
        reducedMotion
      />
    );
    expect(screen.getByRole('button')).toHaveTextContent('Ran npm test');

    rerender(
      <CallRow
        call={command('failed')}
        title={subject('failed')}
        runActive={false}
        reducedMotion
      />
    );
    // The title says it failed, so no status word repeats after it.
    expect(screen.getByRole('button')).toHaveTextContent(
      /^Failed to run npm test$/
    );

    rerender(
      <CallRow
        call={command('cancelled')}
        title={subject('cancelled')}
        runActive={false}
        reducedMotion
      />
    );
    expect(screen.getByRole('button')).toHaveTextContent('Stopped npm test');
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('keeps authored titles and descriptions in their own words', () => {
    const authored = toolCall('completed', {
      toolkitName: 'File Toolkit',
      methodName: 'read_file',
      title: 'Read the repository index',
    });
    expect(timelineCallTitle(authored, { subject: 'README.md' }).text).toBe(
      'Read the repository index · README.md'
    );

    const described = toolCall('completed', {
      toolkitName: 'Terminal Toolkit',
      methodName: 'shell_exec',
      title: 'Terminal Toolkit · shell_exec',
      actionKind: 'command',
    });
    expect(
      timelineCallTitle(described, {
        subject: 'python3 fetch.py',
        description: 'Fetching Anthropic news page',
      })
    ).toEqual({
      text: 'Fetching Anthropic news page',
      statesStatus: false,
      outcomeTense: false,
    });
  });

  it('does not claim an outcome it does not know', () => {
    const unknown = toolCall('outcome_unknown', {
      toolkitName: 'File Toolkit',
      methodName: 'read_file',
      title: 'File Toolkit · read_file',
    });
    expect(timelineCallTitle(unknown).text).toBe('File Toolkit · read_file');
  });
});
