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

import type { VanillaChatStore } from '@/store/chatStore';
import { AgentStep, ChatTaskStatus, SessionMode } from '@/types/constants';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { groupMessagesByQuery } from '@/components/ChatBox/ProjectSection';
import { UserQueryGroup } from '@/components/ChatBox/UserQueryGroup';

vi.mock('@/store/pageTabStore', () => ({
  usePageTabStore: (selector: (state: any) => unknown) =>
    selector({ openFilePreview: vi.fn() }),
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
      await screen.findByText('Task failed before a final reply was recorded.');
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

  it('leaves an incomplete read explicitly unverified', () => {
    renderGroups([{ id: 'user', role: 'user', content: 'Request' }], {
      status: ChatTaskStatus.FINISHED,
      durableRunStatus: 'failed',
    });
    expect(screen.getByText('Task failed.')).toBeInTheDocument();
    expect(
      screen.getByText('Action outcomes could not be verified.')
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Task failed before a final reply was recorded.')
    ).not.toBeInTheDocument();
  });

  it('does not add the summary when a final response is durably recorded', async () => {
    const observeTaskFailureFacts = vi.fn((_id, onFacts) => {
      onFacts({ finalResponse: 'present', actionsVerified: true, actions: [] });
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
