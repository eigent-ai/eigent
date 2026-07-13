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

import { TerminalTab } from '@/components/Session/PreviewPanel/tabs/terminal/TerminalTab';
import {
  collectTerminalSources,
  type TerminalChatEntry,
  type TerminalSource,
} from '@/components/Session/PreviewPanel/tabs/terminal/terminalSources';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// xterm needs real layout/canvas APIs jsdom lacks; the viewer is a thin
// wrapper, so stub it and assert on the stream routed into it.
vi.mock('@/components/Session/PreviewPanel/tabs/terminal/XtermViewer', () => ({
  XtermViewer: ({ sourceId, lines }: { sourceId: string; lines: string[] }) => (
    <div data-testid="xterm-viewer" data-source-id={sourceId}>
      {lines.join('\n')}
    </div>
  ),
}));

let mockSources: TerminalSource[] = [];
vi.mock(
  '@/components/Session/PreviewPanel/tabs/terminal/useSessionTerminalSources',
  () => ({
    useSessionTerminalSources: () => mockSources,
  })
);

// Radix Select relies on pointer-capture and scroll APIs jsdom lacks.
beforeEach(() => {
  mockSources = [];
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

function source(
  id: string,
  agentName: string,
  lines: string[]
): TerminalSource {
  return { id, agentName, taskLabel: `subtask for ${id}`, lines };
}

describe('TerminalTab', () => {
  it('shows the empty state while no agent has produced output', () => {
    render(<TerminalTab />);
    expect(
      screen.getByText('layout.preview-terminal-empty')
    ).toBeInTheDocument();
  });

  it('renders the newest stream by default', () => {
    mockSources = [
      source('a', 'Developer Agent', ['echo one']),
      source('b', 'Developer Agent', ['echo two']),
    ];
    render(<TerminalTab />);
    expect(screen.getByTestId('xterm-viewer')).toHaveAttribute(
      'data-source-id',
      'b'
    );
    expect(screen.getByTestId('xterm-viewer')).toHaveTextContent('echo two');
  });

  it('pins a selected stream, then resumes follow-latest when the newest is re-picked', async () => {
    const user = userEvent.setup();
    mockSources = [
      source('a', 'Developer Agent', ['echo one']),
      source('b', 'Developer Agent', ['echo two']),
    ];
    const { rerender } = render(<TerminalTab />);

    // Pin the older stream.
    await user.click(
      screen.getByRole('combobox', { name: 'layout.preview-terminal-source' })
    );
    await user.click(screen.getByRole('option', { name: /subtask for a/ }));
    expect(screen.getByTestId('xterm-viewer')).toHaveAttribute(
      'data-source-id',
      'a'
    );

    // A new stream arrives — the pin holds.
    mockSources = [...mockSources, source('c', 'Developer Agent', ['pwd'])];
    rerender(<TerminalTab />);
    expect(screen.getByTestId('xterm-viewer')).toHaveAttribute(
      'data-source-id',
      'a'
    );

    // Picking the newest stream resumes following later arrivals.
    await user.click(
      screen.getByRole('combobox', { name: 'layout.preview-terminal-source' })
    );
    await user.click(screen.getByRole('option', { name: /subtask for c/ }));
    mockSources = [...mockSources, source('d', 'Developer Agent', ['ls'])];
    rerender(<TerminalTab />);
    expect(screen.getByTestId('xterm-viewer')).toHaveAttribute(
      'data-source-id',
      'd'
    );
  });

  it('falls back to the latest stream when the pinned one disappears', async () => {
    const user = userEvent.setup();
    mockSources = [
      source('a', 'Developer Agent', ['echo one']),
      source('b', 'Developer Agent', ['echo two']),
    ];
    const { rerender } = render(<TerminalTab />);
    await user.click(
      screen.getByRole('combobox', { name: 'layout.preview-terminal-source' })
    );
    await user.click(screen.getByRole('option', { name: /subtask for a/ }));

    mockSources = [source('b', 'Developer Agent', ['echo two'])];
    rerender(<TerminalTab />);
    expect(screen.getByTestId('xterm-viewer')).toHaveAttribute(
      'data-source-id',
      'b'
    );
  });

  it('copies the visible stream to the clipboard', async () => {
    // userEvent.setup() would install its own clipboard stub over this one,
    // so drive the click with fireEvent instead.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    mockSources = [source('a', 'Developer Agent', ['echo one', 'echo two'])];
    render(<TerminalTab />);

    fireEvent.click(
      screen.getByRole('button', { name: 'layout.preview-terminal-copy' })
    );
    expect(writeText).toHaveBeenCalledWith('echo one\necho two');
  });
});

describe('collectTerminalSources', () => {
  it('flattens subtasks with output and skips the rest, preserving order', () => {
    const entries: TerminalChatEntry[] = [
      {
        chatId: 'chat-1',
        tasks: {
          'turn-1': {
            taskAssigning: [
              {
                agent_id: 'dev-1',
                name: 'Developer Agent',
                type: 'developer_agent',
                log: [],
                tasks: [
                  {
                    id: 'sub-1',
                    content: 'Install deps',
                    terminal: ['npm install'],
                  },
                  { id: 'sub-2', content: 'No commands here' },
                  { id: 'sub-3', content: 'Empty log', terminal: [] },
                ],
              } as unknown as Agent,
            ],
          },
        },
      },
      {
        chatId: 'chat-2',
        tasks: {
          'turn-2': {
            taskAssigning: [
              {
                agent_id: 'single-1',
                name: '',
                type: 'single_agent',
                log: [],
                tasks: [
                  { id: 'todo_1', content: '  Run tests  ', terminal: ['ok'] },
                ],
              } as unknown as Agent,
            ],
          },
        },
      },
    ];

    expect(collectTerminalSources(entries)).toEqual([
      {
        id: 'chat-1:turn-1:sub-1',
        agentName: 'Developer Agent',
        taskLabel: 'Install deps',
        lines: ['npm install'],
      },
      {
        // Empty agent name falls back to the humanized type.
        id: 'chat-2:turn-2:todo_1',
        agentName: 'CAMEL Agent',
        taskLabel: 'Run tests',
        lines: ['ok'],
      },
    ]);
  });

  it('handles missing taskAssigning and empty entries', () => {
    expect(
      collectTerminalSources([{ chatId: 'chat-1', tasks: { 'turn-1': {} } }])
    ).toEqual([]);
    expect(collectTerminalSources([])).toEqual([]);
  });
});
