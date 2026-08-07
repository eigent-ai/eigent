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
    ShellTerminal: ({
      shellId,
      cwd,
      allowHomeFallback,
      transport,
    }: {
      shellId: string;
      cwd?: string;
      allowHomeFallback?: boolean;
      transport: { kind: string };
    }) => (
      <div
        data-testid="shell-terminal"
        data-shell-id={shellId}
        data-cwd={cwd}
        data-home-fallback={String(Boolean(allowHomeFallback))}
        data-transport={transport.kind}
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

vi.mock('@/store/spaceStore', () => ({
  useSpaceStore: (selector: (state: unknown) => unknown) =>
    selector({
      projectIdIndex: { 'project-1': 'space-1' },
      projectsBySpaceId: {
        'space-1': {
          'project-1': { workdirMode: 'direct-write' },
        },
      },
    }),
}));

vi.mock('@/store/projectRuntimeStore', () => ({
  useProjectRuntimeStore: (selector: (state: unknown) => unknown) =>
    selector({
      projects: {
        'project-1': {
          spaceId: 'space-1',
          activeChatId: null,
          chatStores: {},
        },
      },
    }),
}));

const { fetchWorkspaceCapabilitiesMock, fetchWorkspaceEffectiveDirectoryMock } =
  vi.hoisted(() => ({
    fetchWorkspaceCapabilitiesMock: vi.fn(),
    fetchWorkspaceEffectiveDirectoryMock: vi.fn(),
  }));
vi.mock('@/service/workspaceApi', () => ({
  fetchWorkspaceCapabilities: fetchWorkspaceCapabilitiesMock,
  fetchWorkspaceEffectiveDirectory: fetchWorkspaceEffectiveDirectoryMock,
}));

beforeEach(() => {
  mockSources = [];
  fetchWorkspaceCapabilitiesMock.mockReset();
  fetchWorkspaceCapabilitiesMock.mockResolvedValue({
    terminal: true,
    deployment: 'local',
  });
  fetchWorkspaceEffectiveDirectoryMock.mockReset();
  fetchWorkspaceEffectiveDirectoryMock.mockResolvedValue({
    space_id: 'space-1',
    project_id: 'project-1',
    working_directory: '/brain/project-workdir',
    source: 'active_run',
  });
});

const desktopHost = {
  ipcRenderer: null,
  electronAPI: {
    terminalCreate: vi.fn(),
    terminalInput: vi.fn(),
    terminalResize: vi.fn(),
    terminalDispose: vi.fn(),
    onTerminalData: vi.fn(),
    onTerminalExit: vi.fn(),
  },
};

function shellTab(
  surface: 'project' | 'local' = 'project'
): SessionTerminalTab {
  return {
    id: 'tab-1',
    type: 'terminal',
    title: surface === 'project' ? 'Project terminal' : 'Local shell',
    shellId: 'session-shell:project-1:tab-1',
    surface,
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
  it('renders a Project shell through the selected transport', async () => {
    usePageTabStore.setState({ sessionPreviewProjectId: 'project-1' });
    renderTab(shellTab());
    expect(await screen.findByTestId('shell-terminal')).toHaveAttribute(
      'data-shell-id',
      'session-shell:project-1:tab-1'
    );
    expect(screen.getByTestId('shell-terminal')).toHaveAttribute(
      'data-transport',
      'electron-local'
    );
  });

  it('opens the Project shell only in the Brain-resolved effective directory', async () => {
    usePageTabStore.setState({ sessionPreviewProjectId: 'project-1' });
    renderTab(shellTab());
    expect(await screen.findByTestId('shell-terminal')).toHaveAttribute(
      'data-cwd',
      '/brain/project-workdir'
    );
    expect(screen.getByTestId('shell-terminal')).toHaveAttribute(
      'data-home-fallback',
      'false'
    );
    expect(fetchWorkspaceEffectiveDirectoryMock).toHaveBeenCalledWith(
      'space-1',
      'project-1',
      'test@example.com',
      7,
      null,
      'direct-write'
    );
  });

  it('keeps the explicit local shell independent from Project cwd resolution', async () => {
    renderTab(shellTab('local'));
    expect(await screen.findByTestId('shell-terminal')).toHaveAttribute(
      'data-home-fallback',
      'true'
    );
    expect(screen.getByTestId('shell-terminal')).not.toHaveAttribute(
      'data-cwd'
    );
    expect(fetchWorkspaceEffectiveDirectoryMock).not.toHaveBeenCalled();
  });

  it('reports a missing compatible transport without claiming terminal is desktop-only', async () => {
    renderTab(shellTab(), { ipcRenderer: null, electronAPI: null });
    expect(
      await screen.findByText('layout.terminal-brain-transport-unavailable')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('shell-terminal')).not.toBeInTheDocument();
  });

  it('does not use the Electron PTY for a Project on a remote Brain', async () => {
    fetchWorkspaceCapabilitiesMock.mockResolvedValue({
      terminal: true,
      deployment: 'remote_cluster',
    });
    renderTab(shellTab());

    expect(
      await screen.findByText('layout.terminal-brain-transport-unavailable')
    ).toBeInTheDocument();
    expect(fetchWorkspaceEffectiveDirectoryMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('shell-terminal')).not.toBeInTheDocument();
  });

  it('shows the Brain workspace error instead of falling back to a local path', async () => {
    usePageTabStore.setState({ sessionPreviewProjectId: 'project-1' });
    fetchWorkspaceEffectiveDirectoryMock.mockRejectedValue(
      new Error('effective workspace unavailable')
    );
    renderTab(shellTab());
    expect(
      await screen.findByText('effective workspace unavailable')
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
    expect(screen.getByText('layout.terminal-stream-gone')).toBeInTheDocument();
  });

  it('copies the agent stream to the clipboard', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    mockSources = [source('a', 'Developer Agent', ['echo one', 'echo two'])];
    renderTab(agentTab('a'));

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
