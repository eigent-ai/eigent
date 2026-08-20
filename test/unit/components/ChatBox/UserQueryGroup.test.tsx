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
import { render, screen } from '@testing-library/react';
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
  AgentMessageCard: ({ content }: { content: string }) => <div>{content}</div>,
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

function createStore(messages: any[]): VanillaChatStore {
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
      },
    },
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

function renderGroups(messages: any[]) {
  const store = createStore(messages);
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
