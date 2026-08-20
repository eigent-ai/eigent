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
import { HostProvider } from '@/host';
import { usePageTabStore, type SessionTerminalTab } from '@/store/pageTabStore';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Both xterm surfaces need real layout/canvas APIs jsdom lacks; they are thin
// wrappers, so stub them and assert on what gets routed into them.
vi.mock('@/components/Session/PreviewPanel/tabs/terminal/XtermViewer', () => ({
  XtermViewer: ({ sourceId, lines }: { sourceId: string; lines: string[] }) => (
    <div data-testid="xterm-viewer" data-source-id={sourceId}>
      {lines.join('\n')}
    </div>
  ),
}));
vi.mock(
  '@/components/Session/PreviewPanel/tabs/terminal/ShellTerminal',
  () => ({
    ShellTerminal: ({ shellId, cwd }: { shellId: string; cwd?: string }) => (
      <div
        data-testid="shell-terminal"
        data-shell-id={shellId}
        data-cwd={cwd}
      />
    ),
  })
);

let mockSources: TerminalSource[] = [];
vi.mock(
  '@/components/Session/PreviewPanel/tabs/terminal/useSessionTerminalSources',
  () => ({
    useSessionTerminalSources: () => mockSources,
  })
);

// The real auth store drags i18n (and more) into the module graph; the tab
// only reads `email`/`user_id` to resolve the project folder.
vi.mock('@/store/authStore', () => ({
  useAuthStore: (
    selector?: (state: { email: string; user_id: number | null }) => unknown
  ) => {
    const state = { email: 'test@example.com', user_id: 7 };
    return selector ? selector(state) : state;
  },
}));

// The real space store drags the API client into the module graph; the tab
// only resolves the active Space's local root folder from it.
let mockSpaceRootPath: string | null = null;
vi.mock('@/store/spaceStore', () => ({
  useSpaceStore: (selector: (state: unknown) => unknown) =>
    selector({
      activeSpaceId: 'space-1',
      spaces: { 'space-1': { rootPath: mockSpaceRootPath } },
      getProjectMeta: () => null,
    }),
}));

beforeEach(() => {
  mockSources = [];
  mockSpaceRootPath = null;
  desktopHost.electronAPI.getProjectFolderPath.mockClear();
});

const desktopHost = {
  ipcRenderer: null,
  electronAPI: {
    terminalCreate: vi.fn(),
    getProjectFolderPath: vi.fn().mockResolvedValue('/tmp/project'),
  },
};

function shellTab(): SessionTerminalTab {
  return {
    id: 'tab-1',
    type: 'terminal',
    title: 'Terminal',
    shellId: 'session-shell:project-1:tab-1',
  };
}

function agentTab(sourceId: string): SessionTerminalTab {
  return {
    id: 'tab-2',
    type: 'terminal',
    title: 'Developer Agent',
    agentSourceId: sourceId,
  };
}

function source(
  id: string,
  agentName: string,
  lines: string[],
  status: TerminalSource['status'] = 'idle'
): TerminalSource {
  return { id, agentName, taskLabel: `subtask for ${id}`, lines, status };
}

function renderTab(tab: SessionTerminalTab, host: unknown = desktopHost) {
  return render(
    <HostProvider host={host as never}>
      <TerminalTab tab={tab} />
    </HostProvider>
  );
}

describe('TerminalTab', () => {
  it('renders an interactive local shell for a plain terminal tab', async () => {
    renderTab(shellTab());
    expect(await screen.findByTestId('shell-terminal')).toHaveAttribute(
      'data-shell-id',
      'session-shell:project-1:tab-1'
    );
  });

  it('opens the shell in the Space root folder when the Space is folder-backed', async () => {
    mockSpaceRootPath = '/Users/me/my-local-folder';
    renderTab(shellTab());
    expect(await screen.findByTestId('shell-terminal')).toHaveAttribute(
      'data-cwd',
      '/Users/me/my-local-folder'
    );
    expect(desktopHost.electronAPI.getProjectFolderPath).not.toHaveBeenCalled();
  });

  it('falls back to the generated project folder for non-folder Spaces', async () => {
    usePageTabStore.setState({ sessionPreviewProjectId: 'project-1' });
    renderTab(shellTab());
    expect(await screen.findByTestId('shell-terminal')).toHaveAttribute(
      'data-cwd',
      '/tmp/project'
    );
    expect(desktopHost.electronAPI.getProjectFolderPath).toHaveBeenCalledWith(
      'test@example.com',
      'project-1',
      7
    );
  });

  it('tells web users the shell needs the desktop app', () => {
    renderTab(shellTab(), { ipcRenderer: null, electronAPI: null });
    expect(
      screen.getByText('The terminal is available in the desktop app.')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('shell-terminal')).not.toBeInTheDocument();
  });

  it('renders the read-only viewer for an agent stream tab', () => {
    mockSources = [source('a', 'Developer Agent', ['echo one', 'echo two'])];
    renderTab(agentTab('a'));
    expect(screen.getByTestId('xterm-viewer')).toHaveAttribute(
      'data-source-id',
      'a'
    );
    expect(screen.getByTestId('xterm-viewer')).toHaveTextContent('echo two');
    expect(screen.getByText(/Developer Agent/)).toBeInTheDocument();
  });

  it('shows a notice when the agent stream is gone', () => {
    mockSources = [];
    renderTab(agentTab('missing'));
    expect(
      screen.getByText('This terminal stream is no longer available.')
    ).toBeInTheDocument();
  });

  it('copies the agent stream to the clipboard', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    mockSources = [source('a', 'Developer Agent', ['echo one', 'echo two'])];
    renderTab(agentTab('a'));

    fireEvent.click(screen.getByRole('button', { name: 'Copy output' }));
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
                    status: 'running',
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
        status: 'running',
      },
      {
        // Empty agent name falls back to the humanized type.
        id: 'chat-2:turn-2:todo_1',
        agentName: 'CAMEL Agent',
        taskLabel: 'Run tests',
        lines: ['ok'],
        status: 'idle',
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
