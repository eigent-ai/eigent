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

import {
  TaskWorkLogAccordion,
  buildAgentBlocks,
  getBlockHeaderParts,
  getSingleAgentActiveForm,
  getTaskRunDisplayStatus,
  groupBlocksByAgent,
  groupConsecutiveToolItems,
  injectHumanInputReceipts,
  terminalWorkLogI18nKey,
  type AgentBlock,
  type AgentGroup,
  type RepeatedToolItem,
  type TimelineItem,
  type ToolItem,
} from '@/components/ChatBox/MessageItem/TaskWorkLogAccordion';
import type { VanillaChatStore } from '@/store/chatStore';
import {
  AgentStep,
  ChatTaskStatus,
  SessionMode,
  TaskStatus,
  type AgentStepType,
} from '@/types/constants';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn(),
  },
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
  useTranslation: () => ({
    t: (key: string, options: Record<string, unknown> = {}) =>
      key === 'chat.repeated-tool-events'
        ? `${options.tool} · ${options.count} events`
        : String(options.defaultValue ?? key),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

type TaggedLog = Parameters<typeof buildAgentBlocks>[0][number];

function tag(
  agentId: string,
  agentType: string,
  agentName: string,
  entry: AgentMessage
): TaggedLog {
  return { agentId, agentType, agentName, entry };
}

function mk(
  step: AgentStepType,
  data: AgentMessage['data'] = {}
): AgentMessage {
  return { step, data };
}

function findTool(items: TimelineItem[], idx: number) {
  const tools = items.filter((i) => i.kind === 'tool');
  return tools[idx];
}

function findMessage(items: TimelineItem[], idx: number) {
  const messages = items.filter((i) => i.kind === 'message');
  return messages[idx];
}

function makeToolItem(
  id: string,
  overrides: Partial<Omit<ToolItem, 'kind' | 'id'>> = {}
): ToolItem {
  return {
    kind: 'tool',
    id,
    rowTitle: 'Browser Toolkit · Browser visit page',
    toolkitName: 'Browser Toolkit',
    method: 'Browser visit page',
    detail: '',
    input: '',
    output: '',
    status: 'done',
    ...overrides,
  };
}

describe('groupConsecutiveToolItems', () => {
  it('keeps a single tool call on the existing row path', () => {
    const call = makeToolItem('call-1');
    const result = groupConsecutiveToolItems([call]);

    expect(result).toEqual([call]);
    expect(result[0]).toBe(call);
  });

  it('groups adjacent matching toolkit and method calls', () => {
    const first = makeToolItem('call-1');
    const second = makeToolItem('call-2', { status: 'running' });
    const result = groupConsecutiveToolItems([first, second]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: 'repeated-tool',
      id: 'repeated-tool:call-1',
      rowTitle: 'Browser Toolkit · Browser visit page',
      status: 'running',
    });
    expect((result[0] as RepeatedToolItem).calls).toEqual([first, second]);
  });

  it('normalizes cosmetic toolkit and method separators', () => {
    const first = makeToolItem('call-1');
    const second = makeToolItem('call-2', {
      toolkitName: 'browser_toolkit',
      method: 'browser-visit-page',
      rowTitle: 'browser_toolkit · Browser-visit-page',
    });

    expect(groupConsecutiveToolItems([first, second])).toHaveLength(1);
    expect(groupConsecutiveToolItems([first, second])[0]!.kind).toBe(
      'repeated-tool'
    );
  });

  it('groups Querit and Google calls under the unified Search row', () => {
    const querit = makeToolItem('call-1', {
      toolkitName: 'Search Toolkit',
      method: 'search querit',
      rowTitle: 'Search Toolkit · Search',
    });
    const google = makeToolItem('call-2', {
      toolkitName: 'Search Toolkit',
      method: 'search google',
      rowTitle: 'Search Toolkit · Search',
    });

    const [result] = groupConsecutiveToolItems([querit, google]);

    expect(result?.kind).toBe('repeated-tool');
    expect((result as RepeatedToolItem).calls).toEqual([querit, google]);
  });

  it('treats messages and Human Toolkit receipts as chronology boundaries', () => {
    const message: TimelineItem = {
      kind: 'message',
      id: 'message-1',
      text: 'Opening the next result',
      source: 'reasoning',
      running: false,
      pairKey: null,
    };
    const first = makeToolItem('call-1');
    const second = makeToolItem('call-2');

    expect(groupConsecutiveToolItems([first, message, second])).toEqual([
      first,
      message,
      second,
    ]);

    const humanTool = makeToolItem('human-call', {
      humanInput: {
        kind: 'human-input',
        id: 'human-input-1',
        question: 'Which output tone?',
        response: null,
      },
    });
    expect(groupConsecutiveToolItems([humanTool, second])).toEqual([
      humanTool,
      second,
    ]);
  });

  it('does not group a different toolkit or method', () => {
    const first = makeToolItem('call-1');
    const differentMethod = makeToolItem('call-2', {
      method: 'Browser open',
      rowTitle: 'Browser Toolkit · Browser open',
    });
    const differentToolkit = makeToolItem('call-3', {
      toolkitName: 'Search Toolkit',
      rowTitle: 'Search Toolkit · Browser visit page',
    });

    expect(
      groupConsecutiveToolItems([first, differentMethod, differentToolkit])
    ).toEqual([first, differentMethod, differentToolkit]);
  });

  it('keeps the first-call group identity when another live call arrives', () => {
    const calls = [
      makeToolItem('call-1'),
      makeToolItem('call-2'),
      makeToolItem('call-3'),
    ];

    const firstGroup = groupConsecutiveToolItems(calls.slice(0, 2))[0];
    const updatedGroup = groupConsecutiveToolItems(calls)[0];

    expect(firstGroup?.id).toBe('repeated-tool:call-1');
    expect(updatedGroup?.id).toBe(firstGroup?.id);
  });

  it('does not mutate the source timeline', () => {
    const source = [makeToolItem('call-1'), makeToolItem('call-2')];
    const snapshot = structuredClone(source);

    groupConsecutiveToolItems(source);

    expect(source).toEqual(snapshot);
  });
});

describe('TaskWorkLogAccordion repeated tool-call rendering', () => {
  function completedCall(
    toolkitName: string,
    method: string,
    request: string,
    response: string
  ): AgentMessage[] {
    return [
      mk(AgentStep.ACTIVATE_TOOLKIT, {
        toolkit_name: toolkitName,
        method_name: method,
        message: request,
      }),
      mk(AgentStep.DEACTIVATE_TOOLKIT, {
        toolkit_name: toolkitName,
        method_name: method,
        message: response,
      }),
    ];
  }

  function createWorkLogStore(log: AgentMessage[]): VanillaChatStore {
    const state = {
      tasks: {
        'task-1': {
          status: ChatTaskStatus.RUNNING,
          sessionMode: SessionMode.WORKFORCE,
          taskTime: 0,
          elapsed: 0,
          messages: [],
          askList: [],
          taskAssigning: [
            {
              agent_id: 'agent-1',
              type: 'browser',
              name: 'Researcher',
              tasks: [],
              log,
            },
          ],
        },
      },
    };

    return {
      getState: () => state,
      subscribe: () => () => undefined,
    } as unknown as VanillaChatStore;
  }

  it('renders duplicate Browser and Todo calls as expandable count rows', () => {
    const log = [
      mk(AgentStep.ACTIVATE_AGENT),
      ...completedCall(
        'Browser Toolkit',
        'Browser visit page',
        '{"url":"https://example.com/one"}',
        'First page'
      ),
      ...completedCall(
        'Browser Toolkit',
        'Browser visit page',
        '{"url":"https://example.com/two"}',
        'Second page'
      ),
      ...completedCall(
        'TodoToolkit',
        'Todo_write',
        '{"todo":"one"}',
        'Saved first todo'
      ),
      ...completedCall(
        'TodoToolkit',
        'Todo_write',
        '{"todo":"two"}',
        'Saved second todo'
      ),
    ];

    render(
      <TaskWorkLogAccordion
        chatStore={createWorkLogStore(log)}
        taskId="task-1"
      />
    );

    const browserGroup = screen.getByRole('button', {
      name: 'Browser Toolkit · Browser visit page · 2 events',
    });
    const todoGroup = screen.getByRole('button', {
      name: 'TodoToolkit · Todo_write · 2 events',
    });

    expect(browserGroup).toHaveAttribute('aria-expanded', 'false');
    expect(todoGroup).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.getAllByRole('button', {
        name: 'Browser Toolkit · Browser visit page · 2 events',
      })
    ).toHaveLength(1);

    fireEvent.click(browserGroup);

    expect(browserGroup).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getAllByRole('button', {
        name: 'Browser Toolkit · Browser visit page',
      })
    ).toHaveLength(2);
  });

  it('keeps Search unified and shows providers only in expanded details', () => {
    const log = [
      mk(AgentStep.ACTIVATE_AGENT),
      ...completedCall(
        'Search Toolkit',
        'search querit',
        "query='OpenAI updates'",
        '{"results":[]}'
      ),
      ...completedCall(
        'Search Toolkit',
        'search google',
        "query='OpenAI updates'",
        '[]'
      ),
    ];

    render(
      <TaskWorkLogAccordion
        chatStore={createWorkLogStore(log)}
        taskId="task-1"
      />
    );

    const searchGroup = screen.getByRole('button', {
      name: 'Search Toolkit · Search · 2 events',
    });
    expect(screen.queryByText('Querit')).not.toBeInTheDocument();
    expect(screen.queryByText('Google')).not.toBeInTheDocument();

    fireEvent.click(searchGroup);
    const calls = screen.getAllByRole('button', {
      name: 'Search Toolkit · Search',
    });
    fireEvent.click(calls[0]!);
    fireEvent.click(calls[1]!);

    expect(screen.getByText('Querit')).toHaveAttribute(
      'data-search-provider',
      'querit'
    );
    expect(screen.getByText('Google')).toHaveAttribute(
      'data-search-provider',
      'google'
    );
  });
});

describe('TaskWorkLogAccordion human-tool detail', () => {
  function createHumanQuestionStore(answer?: string): VanillaChatStore {
    const interactionId = 'interaction-human-1';
    const messages: Message[] = [
      {
        id: 'ask-1',
        role: 'agent',
        content: 'Which output tone should I use: concise or detailed?',
        step: AgentStep.ASK,
        agent_name: 'Researcher',
        interaction: {
          interaction_id: interactionId,
          interaction_type: 'question',
          run_id: 'task-1',
          question: 'Which output tone should I use: concise or detailed?',
        },
      },
    ];
    if (answer) {
      messages.push({
        id: 'answer-1',
        role: 'user',
        content: answer,
        interactionResponseTo: interactionId,
      });
    }

    const state = {
      tasks: {
        'task-1': {
          status: ChatTaskStatus.RUNNING,
          sessionMode: SessionMode.WORKFORCE,
          taskTime: 0,
          elapsed: 0,
          messages,
          askList: [],
          taskAssigning: [
            {
              agent_id: 'agent-1',
              type: 'browser',
              name: 'Researcher',
              tasks: [],
              log: [
                mk(AgentStep.ACTIVATE_AGENT),
                mk(AgentStep.ACTIVATE_TOOLKIT, {
                  toolkit_name: 'Human Toolkit',
                  method_name: 'Ask human via gui',
                  message: '{"question":"Which output tone?"}',
                }),
                mk(AgentStep.DEACTIVATE_TOOLKIT, {
                  toolkit_name: 'Human Toolkit',
                  method_name: 'Ask human via gui',
                  message: 'null',
                }),
              ],
            },
          ],
        },
      },
    };

    return {
      getState: () => state,
      subscribe: () => () => undefined,
    } as unknown as VanillaChatStore;
  }

  it('owns the question inside the Human Toolkit accordion and folds after answer', async () => {
    const scrollTo = vi
      .spyOn(window, 'scrollTo')
      .mockImplementation(() => undefined);
    const { rerender } = render(
      <TaskWorkLogAccordion
        chatStore={createHumanQuestionStore()}
        taskId="task-1"
      />
    );

    const pendingTool = screen.getByRole('button', {
      name: 'Human Toolkit · Ask human via gui',
    });
    expect(pendingTool).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByText('Which output tone should I use: concise or detailed?')
    ).toBeInTheDocument();
    expect(screen.getByText('Input required')).toHaveClass(
      '!text-ds-text-meta'
    );
    expect(screen.getByText('Question')).toHaveClass('!text-ds-text-meta');

    rerender(
      <TaskWorkLogAccordion
        chatStore={createHumanQuestionStore('detailed')}
        taskId="task-1"
      />
    );

    const completedTool = screen.getByRole('button', {
      name: 'Human Toolkit · Ask human via gui',
    });
    expect(completedTool).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() =>
      expect(screen.queryByText('detailed')).not.toBeInTheDocument()
    );

    fireEvent.click(completedTool);
    expect(screen.getByText('Answer')).toHaveClass('!text-ds-text-meta');
    expect(screen.getByText('detailed')).toHaveClass('!text-ds-text-meta');
    scrollTo.mockRestore();
  });
});

describe('injectHumanInputReceipts permission approvals', () => {
  it('does not stack canonical permission approvals onto an unrelated legacy agent group', () => {
    const tools = [
      makeToolItem('todo-write', {
        rowTitle: 'TodoToolkit · Todo_write',
        toolkitName: 'TodoToolkit',
        method: 'Todo_write',
      }),
      makeToolItem('skill-list', {
        rowTitle: 'SkillToolkit · List_skills',
        toolkitName: 'SkillToolkit',
        method: 'List_skills',
      }),
      makeToolItem('memory-search', {
        rowTitle: 'Memory Toolkit · Search',
        toolkitName: 'Memory Toolkit',
        method: 'Search',
      }),
    ];
    const group: AgentGroup = {
      kind: 'agent-group',
      id: 'group-single-agent',
      agentId: 'single-agent',
      agentType: 'single_agent',
      agentName: 'single_agent',
      items: tools,
      status: 'running',
      doneToolCount: tools.length,
      totalToolCount: tools.length,
    };
    const approval = (id: string, title: string): Message => ({
      id: `ask-${id}`,
      role: 'agent',
      content: '',
      step: AgentStep.ASK,
      agent_name: 'single_agent',
      interaction: {
        interaction_id: `approval:${id}`,
        interaction_type: 'approval',
        run_id: 'task-1',
        title,
        question: `The agent wants to run ${title}.`,
      },
    });

    const result = injectHumanInputReceipts(
      [group],
      [
        approval('mcp-call-1', 'execute_action'),
        approval('mcp-call-2', 'execute_action'),
      ]
    );

    expect(result[0]?.items).toEqual(tools);
    expect(
      result
        .flatMap((entry) => entry.items)
        .filter((item) => {
          if (item.kind === 'human-input') return true;
          return item.kind === 'tool' && Boolean(item.humanInput);
        })
    ).toHaveLength(0);
  });
});

describe('terminal Run presentation', () => {
  it('lets a recorded error override a compatibility interrupted status', () => {
    expect(
      getTaskRunDisplayStatus({
        durableRunStatus: 'interrupted',
        messages: [
          {
            step: AgentStep.ERROR,
            content: '❌ **Error**: Client Closed Request',
          },
        ],
      })
    ).toBe('failed');
    expect(terminalWorkLogI18nKey('failed')).toBe('chat.failed-after');
  });

  it('uses explicit labels for interrupted and stopped Runs', () => {
    expect(terminalWorkLogI18nKey('interrupted')).toBe(
      'chat.interrupted-after'
    );
    expect(terminalWorkLogI18nKey('stopped')).toBe('chat.stopped-after');
  });
});

describe('getSingleAgentActiveForm', () => {
  function taskWithAgents(
    agents: Array<{
      type: string;
      tasks: Array<{ id: string; content: string; status: string }>;
    }>
  ): Parameters<typeof getSingleAgentActiveForm>[0] {
    return {
      taskAssigning: agents.map((agent, index) => ({
        agent_id: `agent-${index}`,
        name: agent.type,
        type: agent.type,
        tasks: agent.tasks,
        log: [],
      })) as Agent[],
    };
  }

  it('uses the running single-agent todo content', () => {
    const task = taskWithAgents([
      {
        type: 'single_agent',
        tasks: [
          {
            id: 'todo-1',
            content: 'Read the docs',
            status: TaskStatus.COMPLETED,
          },
          {
            id: 'todo-2',
            content: 'Search for examples',
            status: TaskStatus.RUNNING,
          },
        ],
      },
    ]);

    expect(getSingleAgentActiveForm(task)).toBe('Search for examples');
  });

  it('falls back to the most recent completed single-agent todo', () => {
    const task = taskWithAgents([
      {
        type: 'single_agent',
        tasks: [
          {
            id: 'todo-1',
            content: 'Read the docs',
            status: TaskStatus.COMPLETED,
          },
          {
            id: 'todo-2',
            content: 'Summarize findings',
            status: TaskStatus.COMPLETED,
          },
        ],
      },
    ]);

    expect(getSingleAgentActiveForm(task)).toBe('Summarize findings');
  });

  it('ignores non single-agent groups', () => {
    const task = taskWithAgents([
      {
        type: 'browser_agent',
        tasks: [
          {
            id: 'task-1',
            content: 'Browse',
            status: TaskStatus.RUNNING,
          },
        ],
      },
    ]);

    expect(getSingleAgentActiveForm(task)).toBe('');
  });
});

describe('buildAgentBlocks', () => {
  it('starts a new block on ACTIVATE_AGENT and captures reasoning as the first message', () => {
    const logs = [
      tag(
        'a1',
        'browser_agent',
        'Browser',
        mk(AgentStep.ACTIVATE_AGENT, { message: 'I will open the page.' })
      ),
      tag(
        'a1',
        'browser_agent',
        'Browser',
        mk(AgentStep.ACTIVATE_TOOLKIT, {
          toolkit_name: 'Browser Toolkit',
          method_name: 'open',
          message: 'https://example.com',
        })
      ),
    ];
    const blocks = buildAgentBlocks(logs);
    expect(blocks).toHaveLength(1);
    const items = blocks[0]!.items;
    const first = findMessage(items, 0);
    expect(first?.kind).toBe('message');
    expect(first?.kind === 'message' && first.source).toBe('reasoning');
    expect(first?.kind === 'message' && first.text).toBe(
      'I will open the page.'
    );
    const tool = findTool(items, 0);
    expect(tool?.kind === 'tool' && tool.rowTitle).toBe(
      'Browser Toolkit · Open'
    );
  });

  it('preserves chronological message → tool → message → tool ordering', () => {
    const logs = [
      tag('a1', 'x', 'X', mk(AgentStep.ACTIVATE_AGENT, { message: 'plan' })),
      tag(
        'a1',
        'x',
        'X',
        mk(AgentStep.ACTIVATE_TOOLKIT, {
          toolkit_name: 'T',
          method_name: 'one',
          message: 'arg=1',
        })
      ),
      tag(
        'a1',
        'x',
        'X',
        mk(AgentStep.DEACTIVATE_TOOLKIT, {
          toolkit_name: 'T',
          method_name: 'one',
          message: 'ok',
        })
      ),
      tag(
        'a1',
        'x',
        'X',
        mk(AgentStep.NOTICE, { notice: 'I found 12 results.' })
      ),
      tag(
        'a1',
        'x',
        'X',
        mk(AgentStep.ACTIVATE_TOOLKIT, {
          toolkit_name: 'T',
          method_name: 'two',
          message: 'arg=2',
        })
      ),
    ];
    const blocks = buildAgentBlocks(logs);
    const kinds = blocks[0]!.items.map((i) =>
      i.kind === 'message' ? `m:${i.source}` : `t:${i.method}`
    );
    expect(kinds).toEqual(['m:reasoning', 't:one', 'm:notice', 't:two']);
  });

  it('inserts a sibling narration message above a prose toolkit message', () => {
    const logs = [
      tag('a1', 'x', 'X', mk(AgentStep.ACTIVATE_AGENT, { message: 'plan' })),
      tag(
        'a1',
        'x',
        'X',
        mk(AgentStep.ACTIVATE_TOOLKIT, {
          toolkit_name: 'Browser Toolkit',
          method_name: 'clone',
          message:
            'Cloning session abc123 with shared user_data_dir at /tmp/foo',
        })
      ),
    ];
    const blocks = buildAgentBlocks(logs);
    const items = blocks[0]!.items;
    expect(items.map((i) => i.kind)).toEqual(['message', 'message', 'tool']);
    const narration = items[1]!;
    expect(narration.kind).toBe('message');
    expect(narration.kind === 'message' && narration.source).toBe(
      'toolkit_message'
    );
    expect(narration.kind === 'message' && narration.running).toBe(true);
  });

  it('does not add narration for kwargs-shaped toolkit messages', () => {
    const logs = [
      tag(
        'a1',
        'x',
        'X',
        mk(AgentStep.ACTIVATE_TOOLKIT, {
          toolkit_name: 'Browser Toolkit',
          method_name: 'open',
          message: "url='https://example.com'",
        })
      ),
    ];
    const blocks = buildAgentBlocks(logs);
    const items = blocks[0]!.items;
    expect(items.map((i) => i.kind)).toEqual(['tool']);
  });

  it('settles the sibling narration when DEACTIVATE_TOOLKIT pairs with the tool', () => {
    const logs = [
      tag('a1', 'x', 'X', mk(AgentStep.ACTIVATE_AGENT, { message: 'plan' })),
      tag(
        'a1',
        'x',
        'X',
        mk(AgentStep.ACTIVATE_TOOLKIT, {
          toolkit_name: 'Browser Toolkit',
          method_name: 'clone',
          message:
            'Cloning session abc123 with shared user_data_dir at /tmp/foo',
        })
      ),
      tag(
        'a1',
        'x',
        'X',
        mk(AgentStep.DEACTIVATE_TOOLKIT, {
          toolkit_name: 'Browser Toolkit',
          method_name: 'clone',
          message: 'session ready',
        })
      ),
    ];
    const blocks = buildAgentBlocks(logs);
    const items = blocks[0]!.items;
    const narration = items[1]!;
    expect(narration.kind === 'message' && narration.running).toBe(false);
    const tool = findTool(items, 0);
    expect(tool?.kind === 'tool' && tool.status).toBe('done');
    expect(tool?.kind === 'tool' && tool.detail).toContain('Cloning session');
    expect(tool?.kind === 'tool' && tool.detail).toContain('session ready');
  });

  it('opens a new block on agent-id change without requiring ACTIVATE_AGENT', () => {
    const logs = [
      tag(
        'a1',
        'browser_agent',
        'Browser',
        mk(AgentStep.ACTIVATE_TOOLKIT, {
          toolkit_name: 'Browser Toolkit',
          method_name: 'open',
          message: "url='x'",
        })
      ),
      tag(
        'a2',
        'developer_agent',
        'Developer',
        mk(AgentStep.ACTIVATE_TOOLKIT, {
          toolkit_name: 'Terminal Toolkit',
          method_name: 'shell_exec',
          message: 'ls',
        })
      ),
    ];
    const blocks = buildAgentBlocks(logs);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.agentId).toBe('a1');
    expect(blocks[1]?.agentId).toBe('a2');
  });

  it('marks every non-last block as done', () => {
    const logs = [
      tag('a1', 'x', 'X', mk(AgentStep.ACTIVATE_AGENT, { message: 'one' })),
      tag(
        'a1',
        'x',
        'X',
        mk(AgentStep.ACTIVATE_TOOLKIT, {
          toolkit_name: 'T',
          method_name: 'm',
          message: 'a',
        })
      ),
      tag('a1', 'x', 'X', mk(AgentStep.ACTIVATE_AGENT, { message: 'two' })),
    ];
    const blocks = buildAgentBlocks(logs);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.status).toBe('done');
    expect(blocks[1]?.status).toBe('running');
  });

  it('flips status to done on DEACTIVATE_AGENT for the current block', () => {
    const logs = [
      tag('a1', 'x', 'X', mk(AgentStep.ACTIVATE_AGENT, { message: 'r' })),
      tag('a1', 'x', 'X', mk(AgentStep.DEACTIVATE_AGENT, {})),
    ];
    const blocks = buildAgentBlocks(logs);
    expect(blocks[0]?.status).toBe('done');
  });

  it('drops NOTICE step into an inline notice message', () => {
    const logs = [
      tag('a1', 'x', 'X', mk(AgentStep.ACTIVATE_AGENT, { message: 'r' })),
      tag('a1', 'x', 'X', mk(AgentStep.NOTICE, { notice: 'heads-up' })),
    ];
    const blocks = buildAgentBlocks(logs);
    const items = blocks[0]!.items;
    const notice = items[1]!;
    expect(notice.kind).toBe('message');
    expect(notice.kind === 'message' && notice.source).toBe('notice');
    expect(notice.kind === 'message' && notice.text).toBe('heads-up');
  });

  it('drops `notice` toolkit messages into inline notice messages, not tools', () => {
    const logs = [
      tag('a1', 'x', 'X', mk(AgentStep.ACTIVATE_AGENT, { message: 'r' })),
      tag(
        'a1',
        'x',
        'X',
        mk(AgentStep.ACTIVATE_TOOLKIT, {
          toolkit_name: 'notice',
          message: 'heads-up',
        })
      ),
    ];
    const blocks = buildAgentBlocks(logs);
    const items = blocks[0]!.items;
    expect(items.filter((i) => i.kind === 'tool')).toHaveLength(0);
    expect(items.filter((i) => i.kind === 'message')).toHaveLength(2);
    expect(items[1]?.kind === 'message' && items[1].source).toBe('notice');
  });

  it('skips ACTIVATE_TOOLKIT events with neither method nor message', () => {
    const logs = [
      tag('a1', 'x', 'X', mk(AgentStep.ACTIVATE_AGENT, { message: 'r' })),
      tag(
        'a1',
        'x',
        'X',
        mk(AgentStep.ACTIVATE_TOOLKIT, { toolkit_name: 'T' })
      ),
    ];
    const blocks = buildAgentBlocks(logs);
    expect(blocks[0]?.items.filter((i) => i.kind === 'tool')).toHaveLength(0);
  });
});

describe('buildAgentBlocks — preparation phase', () => {
  it('collapses the leading run of `register agent` events into one Preparing block', () => {
    const logs = [
      tag(
        'a-browser',
        'browser_agent',
        'Browser Agent',
        mk(AgentStep.ACTIVATE_TOOLKIT, {
          toolkit_name: 'Browser Toolkit',
          method_name: 'register agent',
          message: 'ChatAgent(Browser Agent)',
        })
      ),
      tag(
        'a-browser',
        'browser_agent',
        'Browser Agent',
        mk(AgentStep.DEACTIVATE_TOOLKIT, {
          toolkit_name: 'Browser Toolkit',
          method_name: 'register agent',
          message: 'null',
        })
      ),
      tag(
        'a-mm',
        'multi_modal_agent',
        'Multi Modal Agent',
        mk(AgentStep.ACTIVATE_TOOLKIT, {
          toolkit_name: 'Open Ai Image Toolkit',
          method_name: 'register agent',
          message: 'ChatAgent(Multi Modal Agent)',
        })
      ),
      tag(
        'a-doc',
        'document_agent',
        'Document Agent',
        mk(AgentStep.ACTIVATE_TOOLKIT, {
          toolkit_name: 'File Toolkit',
          method_name: 'register agent',
          message: 'ChatAgent(Document Agent)',
        })
      ),
    ];
    const [prep, ...rest] = buildAgentBlocks(logs);
    expect(rest).toHaveLength(0);
    expect(prep?.kind).toBe('preparation');
    expect(prep?.agentName).toBe('Preparing agents');
    const tools = prep!.items.filter(
      (i): i is Extract<TimelineItem, { kind: 'tool' }> => i.kind === 'tool'
    );
    expect(tools).toHaveLength(3);
    expect(tools[0]?.rowTitle).toBe('Browser Agent · Browser Toolkit');
    expect(tools[0]?.status).toBe('done');
    expect(tools[1]?.status).toBe('running');
  });

  it('uses the singular "Preparing agent" label in single-agent mode', () => {
    const logs = [
      tag(
        'a-single',
        'single_agent',
        'CAMEL Agent',
        mk(AgentStep.ACTIVATE_TOOLKIT, {
          toolkit_name: 'Todo Toolkit',
          method_name: 'register agent',
          message: 'ChatAgent(CAMEL Agent)',
        })
      ),
    ];
    const [prep] = buildAgentBlocks(logs, true);
    expect(prep?.kind).toBe('preparation');
    expect(prep?.agentName).toBe('Preparing agent');
  });

  it('ends the Preparing block when a non-register event arrives', () => {
    const logs = [
      tag(
        'a-browser',
        'browser_agent',
        'Browser Agent',
        mk(AgentStep.ACTIVATE_TOOLKIT, {
          toolkit_name: 'Browser Toolkit',
          method_name: 'register agent',
          message: 'x',
        })
      ),
      tag(
        'a-browser',
        'browser_agent',
        'Browser Agent',
        mk(AgentStep.ACTIVATE_AGENT, { message: 'let me open the page' })
      ),
      tag(
        'a-browser',
        'browser_agent',
        'Browser Agent',
        mk(AgentStep.ACTIVATE_TOOLKIT, {
          toolkit_name: 'Browser Toolkit',
          method_name: 'open',
          message: 'https://example.com',
        })
      ),
    ];
    const blocks = buildAgentBlocks(logs);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.kind).toBe('preparation');
    expect(blocks[0]?.status).toBe('done');
    expect(blocks[1]?.kind).toBe('action');
    const reasoning = blocks[1]!.items[0];
    expect(reasoning?.kind === 'message' && reasoning.source).toBe('reasoning');
    expect(reasoning?.kind === 'message' && reasoning.text).toBe(
      'let me open the page'
    );
  });

  it('routes mid-run register events to the Preparing block without interrupting the active agent', () => {
    const logs = [
      tag(
        'a-dev',
        'developer_agent',
        'Developer Agent',
        mk(AgentStep.ACTIVATE_TOOLKIT, {
          toolkit_name: 'Terminal Toolkit',
          method_name: 'register agent',
          message: 'ChatAgent(Developer Agent)',
        })
      ),
      tag(
        'a-browser',
        'browser_agent',
        'Browser Agent',
        mk(AgentStep.ACTIVATE_TOOLKIT, {
          toolkit_name: 'Browser Toolkit',
          method_name: 'register agent',
          message: 'ChatAgent(Browser Agent)',
        })
      ),
      tag(
        'a-browser',
        'browser_agent',
        'Browser Agent',
        mk(AgentStep.ACTIVATE_AGENT, { message: 'let me open the page' })
      ),
      tag(
        'a-browser',
        'browser_agent',
        'Browser Agent',
        mk(AgentStep.ACTIVATE_TOOLKIT, {
          toolkit_name: 'Browser Toolkit',
          method_name: 'open',
          message: 'https://example.com',
        })
      ),
      tag(
        'a-mm',
        'multi_modal_agent',
        'Multi Modal Agent',
        mk(AgentStep.ACTIVATE_TOOLKIT, {
          toolkit_name: 'Open Ai Image Toolkit',
          method_name: 'register agent',
          message: 'ChatAgent(Multi Modal Agent)',
        })
      ),
    ];
    const blocks = buildAgentBlocks(logs);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.kind).toBe('preparation');
    const prepTools = blocks[0]!.items.filter((i) => i.kind === 'tool');
    expect(prepTools.map((t) => t.kind === 'tool' && t.rowTitle)).toEqual([
      'Developer Agent · Terminal Toolkit',
      'Browser Agent · Browser Toolkit',
      'Multi Modal Agent · Open Ai Image Toolkit',
    ]);
    expect(blocks[1]?.kind).toBe('action');
    expect(blocks[1]?.agentId).toBe('a-browser');
    const actionTools = blocks[1]!.items.filter((i) => i.kind === 'tool');
    expect(actionTools).toHaveLength(1);
    expect(actionTools[0]?.kind === 'tool' && actionTools[0].rowTitle).toBe(
      'Browser Toolkit · Open'
    );
  });

  it('routes browser `clone for new session` events to the Preparing block', () => {
    const logs = [
      tag(
        'a-browser',
        'browser_agent',
        'Browser Agent',
        mk(AgentStep.ACTIVATE_AGENT, { message: 'opening the page' })
      ),
      tag(
        'a-browser',
        'browser_agent',
        'Browser Agent',
        mk(AgentStep.ACTIVATE_TOOLKIT, {
          toolkit_name: 'Browser Toolkit',
          method_name: 'clone for new session',
          message: 'Cloning session abc123',
        })
      ),
      tag(
        'a-browser',
        'browser_agent',
        'Browser Agent',
        mk(AgentStep.DEACTIVATE_TOOLKIT, {
          toolkit_name: 'Browser Toolkit',
          method_name: 'clone for new session',
          message: 'session ready',
        })
      ),
    ];
    const blocks = buildAgentBlocks(logs);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.kind).toBe('preparation');
    const prepTools = blocks[0]!.items.filter((i) => i.kind === 'tool');
    expect(prepTools).toHaveLength(1);
    expect(prepTools[0]?.kind === 'tool' && prepTools[0].rowTitle).toBe(
      'Browser Agent · Browser Toolkit'
    );
    expect(prepTools[0]?.kind === 'tool' && prepTools[0].status).toBe('done');
    // The browser agent's action block must not contain the clone event.
    expect(blocks[1]?.kind).toBe('action');
    const actionTools = blocks[1]!.items.filter((i) => i.kind === 'tool');
    expect(actionTools).toHaveLength(0);
  });

  it('creates a Preparing block even when the first event is an action (for late registrations)', () => {
    const logs = [
      tag(
        'a1',
        'browser_agent',
        'Browser',
        mk(AgentStep.ACTIVATE_AGENT, { message: 'hi' })
      ),
      tag(
        'a1',
        'browser_agent',
        'Browser',
        mk(AgentStep.ACTIVATE_TOOLKIT, {
          toolkit_name: 'Browser Toolkit',
          method_name: 'register agent',
          message: 'late register',
        })
      ),
    ];
    const blocks = buildAgentBlocks(logs);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.kind).toBe('preparation');
    const prepTools = blocks[0]!.items.filter((i) => i.kind === 'tool');
    expect(prepTools).toHaveLength(1);
    expect(blocks[1]?.kind).toBe('action');
    const actionTools = blocks[1]!.items.filter((i) => i.kind === 'tool');
    expect(actionTools).toHaveLength(0);
  });
});

describe('getBlockHeaderParts', () => {
  function makeBlock(
    items: TimelineItem[],
    status: 'running' | 'done' = 'running'
  ): AgentBlock {
    return {
      id: 'b1',
      agentId: 'a1',
      agentType: 'document_agent',
      agentName: 'Document Agent',
      items,
      status,
      kind: 'action',
    };
  }

  it('shows the latest tool title with a running shimmer when the tool is in flight', () => {
    const block = makeBlock([
      {
        kind: 'tool',
        id: 't1',
        rowTitle: 'File Toolkit · Open',
        toolkitName: 'File Toolkit',
        method: 'open',
        detail: '',
        input: '',
        output: '',
        status: 'running',
      },
    ]);
    expect(getBlockHeaderParts(block)).toEqual({
      agentLabel: 'Document Agent',
      detail: 'File Toolkit · Open',
      detailRunning: true,
    });
  });

  it('updates the detail to the most recent tool as new ones arrive', () => {
    const block = makeBlock([
      {
        kind: 'tool',
        id: 't1',
        rowTitle: 'File Toolkit · Open',
        toolkitName: 'File Toolkit',
        method: 'open',
        detail: '',
        input: '',
        output: '',
        status: 'done',
      },
      {
        kind: 'message',
        id: 'm1',
        text: 'opening DuckDuckGo',
        source: 'reasoning',
        running: false,
        pairKey: null,
      },
      {
        kind: 'tool',
        id: 't2',
        rowTitle: 'File Toolkit · Write',
        toolkitName: 'File Toolkit',
        method: 'write',
        detail: '',
        input: '',
        output: '',
        status: 'running',
      },
    ]);
    const parts = getBlockHeaderParts(block);
    expect(parts.detail).toBe('File Toolkit · Write');
    expect(parts.detailRunning).toBe(true);
  });

  it('drops the shimmer once the latest tool finishes', () => {
    const block = makeBlock(
      [
        {
          kind: 'tool',
          id: 't1',
          rowTitle: 'File Toolkit · Open',
          toolkitName: 'File Toolkit',
          method: 'open',
          detail: '',
          input: '',
          output: '',
          status: 'done',
        },
      ],
      'done'
    );
    const parts = getBlockHeaderParts(block);
    expect(parts.detail).toBe('File Toolkit · Open');
    expect(parts.detailRunning).toBe(false);
  });

  it('shows "Thinking…" while a running block has no tool yet', () => {
    const block = makeBlock([
      {
        kind: 'message',
        id: 'm1',
        text: 'plan',
        source: 'reasoning',
        running: false,
        pairKey: null,
      },
    ]);
    const parts = getBlockHeaderParts(block);
    expect(parts.detail).toBe('Thinking…');
    expect(parts.detailRunning).toBe(true);
  });

  it('shows registered count for the preparation block', () => {
    const prep: AgentBlock = {
      id: 'b-prep',
      agentId: '__prep__',
      agentType: '__prep__',
      agentName: 'Preparing agents',
      items: [
        {
          kind: 'tool',
          id: 't0',
          rowTitle: 'A · B',
          toolkitName: 'A',
          method: 'register agent',
          detail: '',
          input: '',
          output: '',
          status: 'done',
        },
        {
          kind: 'tool',
          id: 't1',
          rowTitle: 'C · D',
          toolkitName: 'C',
          method: 'register agent',
          detail: '',
          input: '',
          output: '',
          status: 'running',
        },
      ],
      status: 'running',
      kind: 'preparation',
    };
    const parts = getBlockHeaderParts(prep);
    expect(parts.agentLabel).toBe('Preparing agents');
    expect(parts.detail).toBe('2 Registered');
    expect(parts.detailRunning).toBe(false);
  });
});

describe('groupBlocksByAgent', () => {
  function makeBlock(
    agentId: string,
    agentType: string,
    agentName: string,
    items: TimelineItem[],
    status: 'running' | 'done' = 'running',
    kind: 'preparation' | 'action' = 'action'
  ): AgentBlock {
    return {
      id: `b-${agentId}-${Math.random().toString(36).slice(2, 6)}`,
      agentId,
      agentType,
      agentName,
      items,
      status,
      kind,
    };
  }

  function makeTool(
    id: string,
    status: 'running' | 'done' = 'done'
  ): TimelineItem {
    return {
      kind: 'tool',
      id,
      rowTitle: `Toolkit · Method`,
      toolkitName: 'Toolkit',
      method: 'Method',
      detail: '',
      input: '',
      output: '',
      status,
    };
  }

  function makeMessage(id: string): TimelineItem {
    return {
      kind: 'message',
      id,
      text: 'some narration',
      source: 'reasoning',
      running: false,
      pairKey: null,
    };
  }

  it('produces a single AgentGroup for a single agent with one block', () => {
    const blocks: AgentBlock[] = [
      makeBlock('a1', 'dev', 'Dev', [makeTool('t1'), makeTool('t2')]),
    ];
    const result = groupBlocksByAgent(blocks);
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('agent-group');
    const group = result[0] as AgentGroup;
    expect(group.agentId).toBe('a1');
    expect(group.items).toHaveLength(2);
    expect(group.totalToolCount).toBe(2);
    expect(group.doneToolCount).toBe(2);
  });

  it('preserves alternating blocks from the same agent as A, B, A', () => {
    const blocks: AgentBlock[] = [
      makeBlock('a1', 'dev', 'Dev', [makeTool('t1')], 'done'),
      makeBlock('a2', 'browser', 'Browser', [makeTool('t2')], 'done'),
      makeBlock('a1', 'dev', 'Dev', [makeTool('t3')], 'running'),
    ];
    const result = groupBlocksByAgent(blocks);
    expect(result).toHaveLength(3);

    const g1 = result[0] as AgentGroup;
    expect(g1.kind).toBe('agent-group');
    expect(g1.agentId).toBe('a1');
    expect(g1.items.map((i) => i.id)).toEqual(['t1']);
    expect(g1.status).toBe('done');

    const g2 = result[1] as AgentGroup;
    expect(g2.kind).toBe('agent-group');
    expect(g2.agentId).toBe('a2');
    expect(g2.items).toHaveLength(1);
    expect(g2.status).toBe('done');

    const g3 = result[2] as AgentGroup;
    expect(g3.agentId).toBe('a1');
    expect(g3.items.map((i) => i.id)).toEqual(['t3']);
    expect(g3.status).toBe('running');
  });

  it('preserves the preparation block at its original position', () => {
    const prep: AgentBlock = {
      id: 'b-prep',
      agentId: '__prep__',
      agentType: '__prep__',
      agentName: 'Preparing agents',
      items: [makeTool('tp1')],
      status: 'done',
      kind: 'preparation',
    };
    const blocks: AgentBlock[] = [
      prep,
      makeBlock('a1', 'dev', 'Dev', [makeTool('t1')]),
    ];
    const result = groupBlocksByAgent(blocks);
    expect(result).toHaveLength(2);
    expect(result[0]!.kind).toBe('preparation');
    expect(result[1]!.kind).toBe('agent-group');
  });

  it('propagates running status when any block is running', () => {
    const blocks: AgentBlock[] = [
      makeBlock('a1', 'dev', 'Dev', [makeTool('t1')], 'done'),
      makeBlock('a1', 'dev', 'Dev', [makeTool('t2', 'running')], 'running'),
    ];
    const result = groupBlocksByAgent(blocks);
    const group = result[0] as AgentGroup;
    expect(group.status).toBe('running');
  });

  it('computes tool counts correctly across merged blocks', () => {
    const blocks: AgentBlock[] = [
      makeBlock(
        'a1',
        'dev',
        'Dev',
        [makeTool('t1', 'done'), makeMessage('m1'), makeTool('t2', 'done')],
        'done'
      ),
      makeBlock('a1', 'dev', 'Dev', [makeTool('t3', 'running')], 'running'),
    ];
    const result = groupBlocksByAgent(blocks);
    const group = result[0] as AgentGroup;
    expect(group.totalToolCount).toBe(3);
    expect(group.doneToolCount).toBe(2);
    expect(group.items).toHaveLength(4);
  });

  it('handles an empty block merged into a group', () => {
    const blocks: AgentBlock[] = [makeBlock('a1', 'dev', 'Dev', [], 'done')];
    const result = groupBlocksByAgent(blocks);
    const group = result[0] as AgentGroup;
    expect(group.items).toHaveLength(0);
    expect(group.totalToolCount).toBe(0);
    expect(group.doneToolCount).toBe(0);
  });

  it('preserves chronological group order', () => {
    const blocks: AgentBlock[] = [
      makeBlock('a2', 'browser', 'Browser', [makeTool('t1')], 'done'),
      makeBlock('a1', 'dev', 'Dev', [makeTool('t2')], 'done'),
      makeBlock('a3', 'doc', 'Doc', [makeTool('t3')], 'done'),
      makeBlock('a2', 'browser', 'Browser', [makeTool('t4')], 'running'),
    ];
    const result = groupBlocksByAgent(blocks);
    expect(result).toHaveLength(4);
    expect((result[0] as AgentGroup).agentId).toBe('a2');
    expect((result[1] as AgentGroup).agentId).toBe('a1');
    expect((result[2] as AgentGroup).agentId).toBe('a3');
    expect((result[3] as AgentGroup).agentId).toBe('a2');
  });

  it('integrates with buildAgentBlocks for interleaved multi-agent logs', () => {
    const logs = [
      tag(
        'a1',
        'dev',
        'Dev',
        mk(AgentStep.ACTIVATE_AGENT, { message: 'plan' })
      ),
      tag(
        'a1',
        'dev',
        'Dev',
        mk(AgentStep.ACTIVATE_TOOLKIT, {
          toolkit_name: 'T',
          method_name: 'one',
          message: 'x',
        })
      ),
      tag(
        'a2',
        'browser',
        'Browser',
        mk(AgentStep.ACTIVATE_AGENT, { message: 'browse' })
      ),
      tag(
        'a2',
        'browser',
        'Browser',
        mk(AgentStep.ACTIVATE_TOOLKIT, {
          toolkit_name: 'B',
          method_name: 'open',
          message: 'y',
        })
      ),
      tag(
        'a1',
        'dev',
        'Dev',
        mk(AgentStep.ACTIVATE_AGENT, { message: 'continue' })
      ),
      tag(
        'a1',
        'dev',
        'Dev',
        mk(AgentStep.ACTIVATE_TOOLKIT, {
          toolkit_name: 'T',
          method_name: 'two',
          message: 'z',
        })
      ),
    ];
    const blocks = buildAgentBlocks(logs);
    expect(blocks.length).toBeGreaterThanOrEqual(3);

    const grouped = groupBlocksByAgent(blocks);
    const agentGroups = grouped.filter(
      (e): e is AgentGroup => e.kind === 'agent-group'
    );
    expect(agentGroups).toHaveLength(3);
    expect(agentGroups[0]!.agentId).toBe('a1');
    expect(agentGroups[1]!.agentId).toBe('a2');
    expect(agentGroups[2]!.agentId).toBe('a1');

    const devTools = agentGroups
      .filter((group) => group.agentId === 'a1')
      .flatMap((group) => group.items)
      .filter((i) => i.kind === 'tool');
    expect(devTools).toHaveLength(2);
  });
});
