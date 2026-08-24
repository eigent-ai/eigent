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

import { SessionActivityPanel } from '@/components/Session/SidePanel/components/ActivityPanel';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  activeProjectId: 'project-1' as string,
  chatStore: {} as any,
  hydration: {} as any,
  projectId: 'project-1' as string | null,
  projectFiles: [] as any[],
  projectOutputResolver: vi.fn(),
  spaceState: {
    projectIdIndex: {
      'project-1': 'space-1',
      'project-2': 'space-2',
    } as Record<string, string>,
    spaces: {
      'space-1': { rootPath: '/workspace/space-one' },
      'space-2': { rootPath: '/workspace/space-two' },
    } as Record<string, { rootPath: string }>,
  },
  overviews: {} as Record<string, any>,
  selectFile: vi.fn(),
  setScrollToTurnRequest: vi.fn(),
  requestTaskBoxFocus: vi.fn(),
  openFilePreview: vi.fn(),
  openBrowserPreview: vi.fn(),
}));

vi.mock('@/api/connectors', () => ({
  fetchConnectedProviders: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/client/platform', () => ({ isWeb: () => false }));

vi.mock('@/hooks/useChatStoreAdapter', () => ({
  default: () => ({ chatStore: mocks.chatStore }),
}));

vi.mock('@/hooks/useProjectEventRuntime', () => ({
  useProjectEventRuntime: () => ({
    projectId: mocks.projectId,
    snapshot: null,
    hydration: mocks.hydration,
  }),
}));

vi.mock('@/hooks/useProjectSessionOverview', () => ({
  useProjectSessionOverview: (projectId: string | null) =>
    (projectId && mocks.overviews[projectId]) || {
      currentRun: null,
      historicalRuns: [],
      runs: [],
    },
}));

vi.mock('@/host', () => ({
  useHost: () => ({ electronAPI: { selectFile: mocks.selectFile } }),
}));

vi.mock('@/store/projectRuntimeStore', () => ({
  useProjectRuntimeStore: () => ({
    activeProjectId: mocks.activeProjectId,
  }),
}));

vi.mock('@/store/skillsStore', () => ({
  useSkillsStore: (selector: (state: { skills: never[] }) => unknown) =>
    selector({ skills: [] }),
}));

vi.mock('@/store/spaceStore', () => ({
  useSpaceStore: (selector: (state: typeof mocks.spaceState) => unknown) =>
    selector(mocks.spaceState),
}));

vi.mock('@/store/pageTabStore', () => ({
  usePageTabStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      requestTaskBoxFocus: mocks.requestTaskBoxFocus,
      setScrollToTurnRequest: mocks.setScrollToTurnRequest,
      openFilePreview: mocks.openFilePreview,
      openBrowserPreview: mocks.openBrowserPreview,
    }),
}));

vi.mock(
  '@/components/Session/SidePanel/sections/useProjectOutputFiles',
  () => ({
    useProjectOutputFiles: (...args: unknown[]) => {
      mocks.projectOutputResolver(...args);
      return mocks.projectFiles;
    },
  })
);

vi.mock('@/components/ui/tooltip', () => ({
  TooltipSimple: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/components/Session/SidePanel/components/AccordionBox', () => ({
  SidePanelAccordionBox: ({
    title,
    headerAction,
    children,
  }: {
    title: string;
    headerAction?: ReactNode;
    children: ReactNode | ((state: { open: boolean }) => ReactNode);
  }) => (
    <section>
      <h2>{title}</h2>
      {headerAction}
      {typeof children === 'function' ? children({ open: true }) : children}
    </section>
  ),
}));

vi.mock('@/components/Session/SidePanel/sections/primitives', () => ({
  CountPill: ({ count }: { count: number }) => <span>{count}</span>,
  EarlierItems: ({ children }: { children: ReactNode }) => children,
  ProgressCircle: () => null,
  SidePanelListRow: ({
    children,
    onClick,
    trailing,
  }: {
    children: ReactNode;
    onClick?: () => void;
    trailing?: ReactNode;
  }) =>
    onClick ? (
      <button onClick={onClick}>
        {children}
        {trailing}
      </button>
    ) : (
      <div>
        {children}
        {trailing}
      </div>
    ),
}));

vi.mock(
  '@/components/Session/SidePanel/sections/SessionSidePanelDialogs',
  () => ({
    AgentInformationDialog: ({ agent }: { agent: any }) =>
      agent ? <div data-testid="agent-dialog">{agent.name}</div> : null,
    ToolCallsDialog: ({ item }: { item: any }) =>
      item ? <div data-testid="tool-dialog">{item.label}</div> : null,
  })
);

function chatStore(taskId: string | null) {
  return {
    activeTaskId: taskId,
    tasks: taskId ? { [taskId]: { attaches: [] } } : {},
    setAttaches: vi.fn(),
  };
}

function overview(runId: string, withAgent = false) {
  const run = {
    runId,
    taskId: runId,
    status: 'running',
    createdAt: 1_000,
    updatedAt: 1_000,
    isCurrent: true,
    nodes: withAgent
      ? [
          {
            id: 'agent-1',
            eventId: 'agent-1',
            eventType: 'agent.started',
            projectId: 'project-1',
            runId,
            runSequence: 1,
            cloudCursor: 1,
            createdAt: new Date(1_000).toISOString(),
            legacyStep: null,
            kind: 'activity',
            activityType: 'agent',
            status: 'running',
            title: 'Agent One',
            agentId: 'agent-1',
            agentName: 'Agent One',
          },
        ]
      : [],
  };
  return { currentRun: run, historicalRuns: [], runs: [run] };
}

describe('SessionActivityPanel project scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.projectId = 'project-1';
    mocks.activeProjectId = 'project-1';
    mocks.chatStore = chatStore(null);
    mocks.projectFiles = [];
    mocks.hydration = {
      status: 'ready',
      errorCode: null,
      eventsTruncated: false,
      retry: vi.fn(),
    };
    mocks.overviews = {
      'project-1': { currentRun: null, historicalRuns: [], runs: [] },
      'project-2': { currentRun: null, historicalRuns: [], runs: [] },
    };
  });

  it('keeps an empty Files section visible and fails closed without a composer target', async () => {
    render(<SessionActivityPanel scope="latest" />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });

    expect(screen.getByRole('heading', { name: 'Files' })).toBeInTheDocument();
    expect(screen.getByText('No output files yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Attach files/ })).toBeDisabled();
  });

  it('resolves SidePanel files against the Space that owns the Project', async () => {
    render(<SessionActivityPanel scope="latest" />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });

    expect(mocks.projectOutputResolver).toHaveBeenCalledWith(
      'project-1',
      undefined,
      null,
      '/workspace/space-one',
      []
    );
  });

  it('shows unsupported history as degraded and exposes manual retry', async () => {
    mocks.hydration = {
      status: 'error',
      errorCode: 'unsupported',
      eventsTruncated: false,
      retry: vi.fn(),
    };

    render(<SessionActivityPanel scope="latest" />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      "This version of Eigent can't show session history yet."
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mocks.hydration.retry).toHaveBeenCalledTimes(1);
  });

  it('keeps an artifact noninteractive until the workspace resolver matches it', async () => {
    mocks.chatStore = chatStore('run-1');
    const scopedOverview = overview('run-1');
    scopedOverview.currentRun.nodes = [
      {
        id: 'artifact-1',
        eventId: 'artifact-1',
        eventType: 'artifact.created',
        projectId: 'project-1',
        runId: 'run-1',
        runSequence: 1,
        cloudCursor: 1,
        createdAt: new Date(1_000).toISOString(),
        legacyStep: null,
        kind: 'artifact',
        operation: 'created',
        path: 'outputs/report.md',
        relativePath: 'outputs/report.md',
        name: 'report.md',
      },
    ];
    mocks.overviews['project-1'] = scopedOverview;

    const { rerender } = render(<SessionActivityPanel scope="latest" />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });

    expect(screen.getByText('Preview unavailable')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /report\.md/ })
    ).not.toBeInTheDocument();

    mocks.projectFiles = [
      {
        name: 'report.md',
        type: 'md',
        path: '/workspace/outputs/report.md',
        relativePath: 'outputs/report.md',
      },
    ];
    rerender(<SessionActivityPanel scope="latest" />);

    fireEvent.click(await screen.findByRole('button', { name: /report\.md/ }));
    expect(mocks.openFilePreview).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/workspace/outputs/report.md' })
    );
  });

  it('does not attach a delayed picker result after switching Projects', async () => {
    let resolvePicker!: (value: unknown) => void;
    mocks.chatStore = chatStore('run-1');
    const oldStore = mocks.chatStore;
    mocks.overviews['project-1'] = overview('run-1');
    mocks.selectFile.mockReturnValue(
      new Promise((resolve) => {
        resolvePicker = resolve;
      })
    );

    const { rerender } = render(<SessionActivityPanel scope="latest" />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    fireEvent.click(screen.getByRole('button', { name: /Attach files/ }));
    expect(mocks.selectFile).toHaveBeenCalledTimes(1);

    mocks.projectId = 'project-2';
    mocks.activeProjectId = 'project-2';
    mocks.chatStore = chatStore('run-2');
    const newStore = mocks.chatStore;
    mocks.overviews['project-2'] = overview('run-2');
    rerender(<SessionActivityPanel scope="latest" />);

    await act(async () => {
      resolvePicker({
        success: true,
        files: [{ fileName: 'late.txt', filePath: '/late.txt' }],
      });
      await Promise.resolve();
    });
    expect(oldStore.setAttaches).not.toHaveBeenCalled();
    expect(newStore.setAttaches).not.toHaveBeenCalled();
  });

  it('closes an Agent dialog when the Project incarnation changes', async () => {
    mocks.chatStore = chatStore('run-1');
    mocks.overviews['project-1'] = overview('run-1', true);
    const { rerender } = render(<SessionActivityPanel scope="latest" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Agent One' }));
    expect(screen.getByTestId('agent-dialog')).toHaveTextContent('Agent One');

    mocks.projectId = 'project-2';
    mocks.activeProjectId = 'project-2';
    mocks.chatStore = chatStore(null);
    rerender(<SessionActivityPanel scope="latest" />);

    await waitFor(() =>
      expect(screen.queryByTestId('agent-dialog')).not.toBeInTheDocument()
    );
  });
});
