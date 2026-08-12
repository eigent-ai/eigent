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

import { TaskWorkLogAccordion } from './TaskWorkLogAccordion';

vi.mock('react-i18next', () => ({
  Trans: ({
    i18nKey,
    values,
  }: {
    i18nKey: string;
    values?: { time?: string };
  }) => {
    const labels: Record<string, string> = {
      'chat.worked-for': 'Worked for',
      'chat.working-on-tasks-for': 'Working on tasks for',
    };
    return `${labels[i18nKey] || i18nKey} ${values?.time || ''}`;
  },
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/components/ui/ShinyText/ShinyText', () => ({
  default: ({ text }: { text: string }) => <span>{text}</span>,
}));
vi.mock('@/components/WorkFlow/agents', () => ({
  agentMap: { single_agent: { name: 'CAMEL Agent' } },
}));
vi.mock('@/components/WorkFlow/MarkDown', () => ({
  MarkDown: ({ content }: { content: string }) => <span>{content}</span>,
}));
vi.mock('./HumanInteractionCard', () => ({
  HumanInteractionCard: () => null,
}));

function createStore(overrides: Record<string, unknown>): VanillaChatStore {
  const task = {
    type: '',
    sessionMode: SessionMode.SINGLE_AGENT,
    status: ChatTaskStatus.FINISHED,
    durableRunStatus: undefined,
    taskTime: 0,
    elapsed: 0,
    taskAssigning: [],
    messages: [],
    askList: [],
    ...overrides,
  };
  const state = {
    activeTaskId: 'run-1',
    tasks: { 'run-1': task },
    addMessages: vi.fn(),
    setActiveAskList: vi.fn(),
    setActiveAsk: vi.fn(),
    setIsPending: vi.fn(),
  };

  return {
    getState: () => state,
    subscribe: () => () => undefined,
  } as unknown as VanillaChatStore;
}

describe('TaskWorkLogAccordion unavailable AgentStep fallback', () => {
  it('renders one static worked-for receipt for historical playback with no usable log', () => {
    const store = createStore({ type: 'replay', elapsed: 37_000 });

    render(<TaskWorkLogAccordion chatStore={store} taskId="run-1" />);

    const receipt = screen.getByRole('status', {
      name: 'Unavailable agent step',
    });
    expect(receipt).toHaveTextContent('Worked for 37s');
    expect(receipt).toHaveTextContent(
      'Agent step is not available at the moment.'
    );
    expect(receipt.querySelectorAll('p')).toHaveLength(1);
    expect(receipt.querySelectorAll('button')).toHaveLength(0);
    expect(receipt).not.toHaveTextContent('Waiting for tool calls');
  });

  it('uses the same receipt for an unfinished durable Run restored without steps', () => {
    const store = createStore({
      durableRunStatus: 'interrupted',
      elapsed: 65_000,
    });

    render(<TaskWorkLogAccordion chatStore={store} taskId="run-1" />);

    expect(
      screen.getByText('Agent step is not available at the moment.')
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Worked for 1m 05s');
  });

  it('uses the receipt for a paused past Run whose AgentStep was lost', () => {
    const store = createStore({
      status: ChatTaskStatus.PAUSE,
      durableRunStatus: 'interrupted',
      elapsed: 21_000,
    });

    render(<TaskWorkLogAccordion chatStore={store} taskId="run-1" />);

    const receipt = screen.getByRole('status', {
      name: 'Unavailable agent step',
    });
    expect(receipt).toHaveTextContent('Worked for 21s');
    expect(receipt).toHaveTextContent(
      'Agent step is not available at the moment.'
    );
    expect(receipt.querySelectorAll('button')).toHaveLength(0);
  });

  it('uses the receipt for an older pending legacy query with no AgentStep', () => {
    const store = createStore({
      status: ChatTaskStatus.PENDING,
      elapsed: 9_000,
    });

    render(
      <TaskWorkLogAccordion chatStore={store} historical taskId="run-1" />
    );

    const receipt = screen.getByRole('status', {
      name: 'Unavailable agent step',
    });
    expect(receipt).toHaveTextContent('Worked for 9s');
    expect(receipt).toHaveTextContent(
      'Agent step is not available at the moment.'
    );
    expect(receipt.querySelectorAll('button')).toHaveLength(0);
  });

  it('does not treat a historical ASK-only shell as an available AgentStep', () => {
    const store = createStore({
      status: ChatTaskStatus.PAUSE,
      durableRunStatus: 'waiting_for_user',
      elapsed: 14_000,
      messages: [
        {
          id: 'legacy-ask',
          role: 'agent',
          step: AgentStep.ASK,
          content: 'Approve the old action?',
          interaction: {
            interaction_id: 'legacy-approval',
            interaction_type: 'approval',
            run_id: 'run-1',
          },
        },
      ],
    });

    render(
      <TaskWorkLogAccordion chatStore={store} historical taskId="run-1" />
    );

    const receipt = screen.getByRole('status', {
      name: 'Unavailable agent step',
    });
    expect(receipt).toHaveTextContent('Worked for 14s');
    expect(receipt).toHaveTextContent(
      'Agent step is not available at the moment.'
    );
    expect(receipt.querySelectorAll('button')).toHaveLength(0);
  });

  it('does not classify a genuinely new legacy Run as a missing historical step', () => {
    const store = createStore({
      status: ChatTaskStatus.RUNNING,
      taskTime: Date.now(),
    });

    render(<TaskWorkLogAccordion chatStore={store} taskId="run-1" />);

    expect(
      screen.queryByText('Agent step is not available at the moment.')
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps current durable preparation live before its first AgentStep', () => {
    const store = createStore({
      status: ChatTaskStatus.RUNNING,
      durableRunStatus: 'running',
      taskTime: Date.now(),
    });

    render(<TaskWorkLogAccordion chatStore={store} taskId="run-1" />);

    expect(
      screen.queryByText('Agent step is not available at the moment.')
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveTextContent(
      'Working on tasks for'
    );
  });

  it('keeps a real historical AgentStep instead of replacing it', () => {
    const store = createStore({
      type: 'replay',
      elapsed: 12_000,
      taskAssigning: [
        {
          agent_id: 'single-agent',
          name: 'CAMEL Agent',
          type: 'single_agent',
          tasks: [],
          log: [
            {
              step: AgentStep.ACTIVATE_AGENT,
              data: { message: 'Reviewing the request.' },
            },
          ],
        },
      ],
    });

    render(<TaskWorkLogAccordion chatStore={store} taskId="run-1" />);

    expect(
      screen.queryByText('Agent step is not available at the moment.')
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveTextContent('Worked for 12s');
  });
});
