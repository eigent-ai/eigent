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

import { RunEventIngress, runProjectionStore } from '@/lib/runEvents';
import { unverifiedTaskFailureFacts } from '@/service/runUsageReconciliation';
import type { VanillaChatStore } from '@/store/chatStore';
import { useSpaceStore } from '@/store/spaceStore';
import { AgentStep, ChatTaskStatus, SessionMode } from '@/types/constants';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { groupMessagesByQuery } from '@/components/ChatBox/ProjectSection';
import { UserQueryGroup } from '@/components/ChatBox/UserQueryGroup';

const navigation = vi.hoisted(() => ({
  setActiveProject: vi.fn(),
  setActiveWorkspaceTab: vi.fn(),
  ensureProjectRuntimeLoaded: vi.fn(async () => undefined),
}));

vi.mock('@/store/pageTabStore', () => ({
  WorkspaceTab: { Project: 'project' },
  usePageTabStore: Object.assign(
    (selector: (state: any) => unknown) =>
      selector({ openFilePreview: vi.fn() }),
    {
      getState: () => ({
        setActiveWorkspaceTab: navigation.setActiveWorkspaceTab,
      }),
    }
  ),
}));

vi.mock('@/store/projectRuntimeStore', () => ({
  useProjectRuntimeStore: Object.assign(
    (selector: (state: any) => unknown) =>
      selector({ activeProjectId: 'session-waiting' }),
    { getState: () => ({ setActiveProject: navigation.setActiveProject }) }
  ),
}));

vi.mock('@/lib/projectRuntimeHydration', () => ({
  ensureProjectRuntimeLoaded: navigation.ensureProjectRuntimeLoaded,
}));

vi.mock('@/components/ChatBox/MessageItem/TaskWorkLogAccordion', () => ({
  getTaskRunDisplayStatus: () => undefined,
  TaskWorkLogAccordion: ({ taskId }: { taskId: string }) => (
    <div data-testid="task-work-log" data-task-id={taskId} />
  ),
}));

vi.mock('@/components/ChatBox/MessageItem/UserMessageCard', () => ({
  UserMessageCard: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock('@/components/ChatBox/MessageItem/AgentMessageCard', () => ({
  AgentMessageCard: ({
    id,
    content,
    feedbackRunId,
    feedbackMessageId,
    messageStep,
  }: {
    id: string;
    content: string;
    feedbackRunId?: string;
    feedbackMessageId?: string;
    messageStep?: string;
  }) => (
    <div
      data-feedback-run-id={feedbackRunId}
      data-feedback-message-id={feedbackMessageId}
      data-message-step={messageStep}
      data-testid={`agent-message-card-${id}`}
    >
      {content}
    </div>
  ),
}));

vi.mock('@/components/ChatBox/MessageItem/PreparingToExecuteTasks', () => ({
  PreparingToExecuteTasks: () => <div data-testid="preparing" />,
}));

vi.mock('@/components/ChatBox/MessageItem/NoticeCard', () => ({
  NoticeCard: () => <div data-testid="notice" />,
}));

vi.mock('@/components/ChatBox/TaskBox/TaskCard', () => ({
  TaskCard: () => <div data-testid="task-card" />,
}));

vi.mock('@/components/ChatBox/TaskBox/PlanTaskBox', () => ({
  PlanTaskBox: () => <div data-testid="plan-task-box" />,
}));

function createStore(messages: any[], overrides: any = {}): VanillaChatStore {
  const state: any = {
    activeTaskId: 'run-1',
    tasks: {
      'run-1': {
        sessionMode: SessionMode.SINGLE_AGENT,
        status: ChatTaskStatus.RUNNING,
        messages,
        streamingDecomposeText: '',
        hasWaitComfirm: false,
        isPending: false,
        taskInfo: [],
        taskAssigning: [],
        taskRunning: [],
        progressValue: 0,
        summaryTask: '',
        cotList: [],
        activeAsk: 'single_agent',
        askList: [],
        ...overrides,
      },
    },
    observeTaskFailureFacts:
      overrides.observeTaskFailureFacts ?? vi.fn(() => () => {}),
    addTaskInfo: vi.fn(),
    updateTaskInfo: vi.fn(),
    saveTaskInfo: vi.fn(),
    deleteTaskInfo: vi.fn(),
    setActiveAskList: vi.fn(),
    setActiveAsk: vi.fn(),
    setIsPending: vi.fn(),
    addMessages: vi.fn(),
  };
  return {
    getState: () => state,
    subscribe: () => () => undefined,
  } as VanillaChatStore;
}

function renderGroups(messages: any[], overrides: any = {}) {
  const store = createStore(messages, overrides);
  const groups = groupMessagesByQuery(messages);
  const rendered = render(
    <>
      {groups.map((group, index) => (
        <UserQueryGroup
          key={group.queryId}
          chatId="chat-1"
          chatStore={store}
          queryGroup={group}
          isActive={false}
          onQueryActive={() => undefined}
          index={index}
          taskId="run-1"
        />
      ))}
    </>
  );
  return { ...rendered, store };
}

describe('UserQueryGroup Run work-log ownership', () => {
  it('keeps exactly one work log while a structured ASK is pending and after its reply', () => {
    const prompt = { id: 'user-1', role: 'user', content: 'Build a report' };
    const ask = {
      id: 'ask-1',
      role: 'agent',
      step: AgentStep.ASK,
      content: 'Which region?',
      interaction: {
        interaction_id: 'interaction-1',
        interaction_type: 'question',
        run_id: 'run-1',
        question: 'Which region?',
      },
    };
    const reply = { id: 'reply-1', role: 'user', content: 'Europe' };

    const pending = renderGroups([prompt, ask]);
    expect(screen.getAllByTestId('task-work-log')).toHaveLength(1);

    pending.unmount();
    renderGroups([prompt, ask, reply]);

    expect(screen.getAllByTestId('task-work-log')).toHaveLength(1);
    expect(screen.queryByText('Which region?')).not.toBeInTheDocument();
    expect(screen.queryByText('Europe')).not.toBeInTheDocument();
  });

  it('forwards message lifecycle and Run identity to every feedback card path', () => {
    const messages = [
      { id: 'user-1', role: 'user', content: 'Build a report' },
      {
        id: 'end-1',
        feedbackMessageId: 'source-end-1',
        role: 'agent',
        step: AgentStep.END,
        content: 'Final response',
      },
      {
        id: 'agent-end-1',
        feedbackMessageId: 'source-agent-end-1',
        role: 'agent',
        step: AgentStep.AGENT_END,
        content: 'Delegated result',
      },
      {
        id: 'generic-1',
        feedbackMessageId: 'source-generic-1',
        role: 'agent',
        step: AgentStep.ACTIVATE_AGENT,
        content: 'Working update',
      },
      {
        id: 'skip-1',
        feedbackMessageId: 'source-skip-1',
        role: 'agent',
        step: AgentStep.AGENT_END,
        content: 'skip',
      },
    ];

    renderGroups(messages);

    const expectedSteps = {
      'end-1': AgentStep.END,
      'agent-end-1': AgentStep.AGENT_END,
      'generic-1': AgentStep.ACTIVATE_AGENT,
      'skip-1': AgentStep.AGENT_END,
    };
    for (const [messageId, messageStep] of Object.entries(expectedSteps)) {
      const card = screen.getByTestId(`agent-message-card-${messageId}`);
      expect(card).toHaveAttribute('data-message-step', messageStep);
      expect(card).toHaveAttribute('data-feedback-run-id', 'run-1');
      expect(card).toHaveAttribute(
        'data-feedback-message-id',
        `source-${messageId}`
      );
    }
  });

  it('does not give a transient ordinary follow-up a second copy of the old Run log', () => {
    const messages = [
      { id: 'user-1', role: 'user', content: 'Build a report' },
      {
        id: 'agent-1',
        role: 'agent',
        step: AgentStep.END,
        content: 'Done',
      },
      { id: 'user-2', role: 'user', content: 'Add a chart' },
    ];

    renderGroups(messages);

    expect(screen.getAllByTestId('task-work-log')).toHaveLength(1);
  });

  it('moves a structured choice out of the chat flow and into the work log', () => {
    const messages = [
      { id: 'user-1', role: 'user', content: 'Build a report' },
      {
        id: 'ask-1',
        role: 'agent',
        step: AgentStep.ASK,
        content: 'Which format?',
        interaction: {
          interaction_id: 'interaction-1',
          interaction_type: 'choice',
          run_id: 'run-1',
          question: 'Which format?',
        },
      },
    ];
    renderGroups(messages);

    expect(screen.queryByText('Which format?')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('task-work-log')).toHaveLength(1);
  });
});

describe('Task failure summary ownership', () => {
  it.each([AgentStep.ERROR, AgentStep.ACTIVATE_AGENT, AgentStep.AGENT_END])(
    'preserves %s output and renders one read-only Task summary',
    async (step) => {
      const facts = {
        terminalReason: 'error',
        finalResponse: 'absent',
        actionsVerified: true,
        actions: [
          {
            id: 'send',
            title: 'send_email',
            outcome: 'outcome_unknown',
            output: 'Recorded safe detail',
          },
        ],
      };
      const dispose = vi.fn();
      const observeTaskFailureFacts = vi.fn((_id, onFacts) => {
        onFacts(facts);
        return dispose;
      });
      const { container, store, unmount } = renderGroups(
        [
          { id: 'user', role: 'user', content: 'First request' },
          { id: 'partial', role: 'agent', step, content: 'Existing evidence' },
          {
            id: 'next-user',
            role: 'user',
            content: 'Another message in the same Task',
          },
        ],
        {
          status: ChatTaskStatus.FINISHED,
          durableRunStatus: 'failed',
          observeTaskFailureFacts,
        }
      );
      const before = JSON.stringify(store.getState().tasks);
      await screen.findByText('No final reply was recorded.');
      expect(
        container.querySelectorAll('[data-task-failure-summary]')
      ).toHaveLength(1);
      expect(screen.getByText('Existing evidence')).toBeInTheDocument();
      expect(
        screen.getByText(
          'An external action may have occurred; its outcome is unknown.'
        )
      ).toBeInTheDocument();
      fireEvent.click(
        screen.getByRole('button', { name: 'View recorded actions' })
      );
      expect(screen.getByText('Outcome unknown')).toBeInTheDocument();
      expect(screen.getByText('Recorded safe detail')).toBeInTheDocument();
      fireEvent.click(
        screen.getByRole('button', { name: 'Hide recorded actions' })
      );
      expect(observeTaskFailureFacts).toHaveBeenCalledOnce();
      expect(JSON.stringify(store.getState().tasks)).toBe(before);
      unmount();
      expect(dispose).toHaveBeenCalledOnce();
    }
  );

  it('renders nothing while the read is pending', () => {
    const { container } = renderGroups(
      [{ id: 'user', role: 'user', content: 'Request' }],
      { status: ChatTaskStatus.FINISHED, durableRunStatus: 'failed' }
    );
    expect(container.querySelector('[data-task-failure-summary]')).toBeNull();
  });

  it('leaves an incomplete read explicitly unverified', async () => {
    const observeTaskFailureFacts = vi.fn((_id, onFacts) => {
      onFacts(unverifiedTaskFailureFacts());
      return () => {};
    });
    renderGroups([{ id: 'user', role: 'user', content: 'Request' }], {
      status: ChatTaskStatus.FINISHED,
      durableRunStatus: 'failed',
      observeTaskFailureFacts,
    });
    expect(await screen.findByText('Task failed.')).toBeInTheDocument();
    expect(
      screen.getByText('Action outcomes could not be verified.')
    ).toBeInTheDocument();
    expect(
      screen.queryByText('No final reply was recorded.')
    ).not.toBeInTheDocument();
  });

  it.each([
    ['failed', 'error', 'No final reply was recorded.'],
    [
      'timed_out',
      'deadline_exceeded',
      'Task timed out before a final reply was recorded.',
    ],
    // The status says the Task timed out; an earlier cause only says why.
    [
      'timed_out',
      'approval_expired',
      'Task timed out before a final reply was recorded.',
    ],
    [
      'timed_out',
      'brain_restart',
      'Task timed out before a final reply was recorded.',
    ],
  ])(
    'states that no actions were recorded for a %s Run (%s) without tools',
    async (durableRunStatus, terminalReason, title) => {
      const observeTaskFailureFacts = vi.fn((_id, onFacts) => {
        onFacts({
          terminalReason,
          finalResponse: 'absent',
          actionsVerified: true,
          actions: [],
        });
        return () => {};
      });
      renderGroups([{ id: 'user', role: 'user', content: 'Request' }], {
        status: ChatTaskStatus.FINISHED,
        durableRunStatus,
        observeTaskFailureFacts,
      });
      expect(await screen.findByText(title)).toBeInTheDocument();
      expect(screen.getByText('No actions were recorded.')).toBeInTheDocument();
      expect(
        screen.queryByText('Action outcomes could not be verified.')
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'View recorded actions' })
      ).not.toBeInTheDocument();
    }
  );

  it('renders the first actions in order, counts the rest, and warns from every action', async () => {
    const observeTaskFailureFacts = vi.fn((_id, onFacts) => {
      onFacts({
        terminalReason: 'error',
        finalResponse: 'absent',
        actionsVerified: true,
        actions: [
          ...Array.from({ length: 120 }, (_, index) => ({
            id: String(index),
            title: `read_${index}`,
            outcome: 'completed',
          })),
          { id: 'send', title: 'send_email', outcome: 'outcome_unknown' },
        ],
      });
      return () => {};
    });
    const { container } = renderGroups(
      [{ id: 'user', role: 'user', content: 'Request' }],
      {
        status: ChatTaskStatus.FINISHED,
        durableRunStatus: 'failed',
        observeTaskFailureFacts,
      }
    );
    expect(
      await screen.findByText(
        'An external action may have occurred; its outcome is unknown.'
      )
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'View recorded actions' })
    );
    const rendered = container.querySelectorAll('[data-action-outcome] h3');
    expect(rendered).toHaveLength(100);
    expect(rendered[0]).toHaveTextContent('read_0');
    expect(rendered[99]).toHaveTextContent('read_99');
    expect(screen.getByText('21 more actions not shown.')).toBeInTheDocument();
  });

  it('does not add the summary when a final response is durably recorded', async () => {
    const observeTaskFailureFacts = vi.fn((_id, onFacts) => {
      onFacts({
        terminalReason: 'error',
        finalResponse: 'present',
        actionsVerified: true,
        actions: [],
      });
      return () => {};
    });
    const { container } = renderGroups(
      [{ id: 'user', role: 'user', content: 'Request' }],
      {
        status: ChatTaskStatus.FINISHED,
        durableRunStatus: 'failed',
        observeTaskFailureFacts,
      }
    );
    await waitFor(() =>
      expect(container.querySelector('[data-task-failure-summary]')).toBeNull()
    );
  });
});

describe('UserQueryGroup Space writer wait', () => {
  const prompt = [{ id: 'user-1', role: 'user', content: 'Update the docs' }];
  const pending = { status: ChatTaskStatus.PENDING, isPending: true };
  const queueWriter = (payload: Record<string, unknown>) =>
    new RunEventIngress('session-waiting', 'run-1').ingest({
      event_id: 'writer-queued',
      project_id: 'session-waiting',
      run_id: 'run-1',
      run_sequence: 1,
      run_version: 1,
      event_type: 'workspace.writer.queued',
      legacy_step: null,
      created_at: '2026-10-07T10:00:00Z',
      payload,
    });

  afterEach(() => {
    cleanup();
    runProjectionStore.clear();
    useSpaceStore.setState({ projectIdIndex: {}, projectsBySpaceId: {} });
    vi.clearAllMocks();
  });

  it('keeps Preparing until the Run waits for its Space', () => {
    renderGroups(prompt, pending);

    expect(screen.getByTestId('preparing')).toBeInTheDocument();
  });

  it('waits plainly while another task is writing to the Space', () => {
    queueWriter({ reason: 'task.mutating_default' });
    renderGroups(prompt, pending);

    expect(screen.queryByTestId('preparing')).toBeNull();
    expect(screen.getByText('Waiting for Space')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open session' })).toBeNull();
  });

  it('names a stopped writer and opens its Session', () => {
    useSpaceStore.setState({
      projectIdIndex: { 'session-blocker': 'space-1' },
      projectsBySpaceId: {
        'space-1': { 'session-blocker': { id: 'session-blocker' } as never },
      },
    });
    queueWriter({
      reason: 'holder_requires_attention',
      semantic: {
        correlation: {
          blocker_run_id: 'run-blocker',
          blocker_project_id: 'session-blocker',
          blocker_reason: 'unknown_tool_outcome',
        },
      },
    });
    renderGroups(prompt, pending);

    expect(screen.queryByTestId('preparing')).toBeNull();
    expect(
      screen.getByText(
        'Another task in this Space stopped while it was changing files and needs your attention. This task will start after that task is resolved.'
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open session' }));
    expect(navigation.setActiveProject).toHaveBeenCalledWith('session-blocker');
    expect(navigation.setActiveWorkspaceTab).toHaveBeenCalledWith('project');
    expect(navigation.ensureProjectRuntimeLoaded).toHaveBeenCalledWith(
      expect.anything(),
      'session-blocker',
      { requireActiveSelection: true }
    );
  });

  it('does not offer to open the Session that is already open', () => {
    useSpaceStore.setState({
      projectIdIndex: { 'session-waiting': 'space-1' },
      projectsBySpaceId: {
        'space-1': { 'session-waiting': { id: 'session-waiting' } as never },
      },
    });
    queueWriter({
      reason: 'holder_requires_attention',
      semantic: { correlation: { blocker_project_id: 'session-waiting' } },
    });
    renderGroups(prompt, pending);

    expect(
      screen.getByText(/stopped while it was changing files/)
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open session' })).toBeNull();
  });
});
