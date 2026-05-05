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
  buildAgentBlocks,
  getBlockHeaderParts,
  type AgentBlock,
  type TimelineItem,
} from '@/components/ChatBox/MessageItem/TaskWorkLogAccordion';
import { AgentStep, type AgentStepType } from '@/types/constants';
import { describe, expect, it } from 'vitest';

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
          status: 'done',
        },
        {
          kind: 'tool',
          id: 't1',
          rowTitle: 'C · D',
          toolkitName: 'C',
          method: 'register agent',
          detail: '',
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
