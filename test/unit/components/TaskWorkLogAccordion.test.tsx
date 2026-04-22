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
  buildActionGroups,
  getGroupTitle,
} from '@/components/ChatBox/MessageItem/TaskWorkLogAccordion';
import { AgentStep, type AgentStepType } from '@/types/constants';
import { describe, expect, it } from 'vitest';

type TaggedLog = Parameters<typeof buildActionGroups>[0][number];

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

describe('buildActionGroups', () => {
  it('starts a new group on ACTIVATE_AGENT and captures reasoning', () => {
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
    const groups = buildActionGroups(logs);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.reasoning).toBe('I will open the page.');
    expect(groups[0]?.tools).toHaveLength(1);
    expect(groups[0]?.tools[0]?.rowTitle).toBe('Browser Toolkit · Open');
  });

  it('pairs DEACTIVATE_TOOLKIT with the matching running tool in the group', () => {
    const logs = [
      tag(
        'a1',
        'browser_agent',
        'Browser',
        mk(AgentStep.ACTIVATE_AGENT, { message: 'Step one' })
      ),
      tag(
        'a1',
        'browser_agent',
        'Browser',
        mk(AgentStep.ACTIVATE_TOOLKIT, {
          toolkit_name: 'Search Toolkit',
          method_name: 'query',
          message: 'tennis',
        })
      ),
      tag(
        'a1',
        'browser_agent',
        'Browser',
        mk(AgentStep.DEACTIVATE_TOOLKIT, {
          toolkit_name: 'Search Toolkit',
          method_name: 'query',
          message: '12 results',
        })
      ),
    ];
    const groups = buildActionGroups(logs);
    expect(groups[0]?.tools[0]?.status).toBe('done');
    expect(groups[0]?.tools[0]?.detail).toContain('tennis');
    expect(groups[0]?.tools[0]?.detail).toContain('12 results');
  });

  it('opens a new group on agent-id change without requiring ACTIVATE_AGENT', () => {
    const logs = [
      tag(
        'a1',
        'browser_agent',
        'Browser',
        mk(AgentStep.ACTIVATE_TOOLKIT, {
          toolkit_name: 'Browser Toolkit',
          method_name: 'open',
          message: 'x',
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
    const groups = buildActionGroups(logs);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.agentId).toBe('a1');
    expect(groups[1]?.agentId).toBe('a2');
    expect(groups[0]?.reasoning).toBeNull();
  });

  it('marks every non-last group as done', () => {
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
    const groups = buildActionGroups(logs);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.status).toBe('done');
    expect(groups[1]?.status).toBe('running');
  });

  it('flips status to done on DEACTIVATE_AGENT for the current group', () => {
    const logs = [
      tag('a1', 'x', 'X', mk(AgentStep.ACTIVATE_AGENT, { message: 'r' })),
      tag('a1', 'x', 'X', mk(AgentStep.DEACTIVATE_AGENT, {})),
    ];
    const groups = buildActionGroups(logs);
    expect(groups[0]?.status).toBe('done');
  });

  it('drops NOTICE tool events into notices, not tools', () => {
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
    const groups = buildActionGroups(logs);
    expect(groups[0]?.tools).toHaveLength(0);
    expect(groups[0]?.notices).toEqual(['heads-up']);
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
    const groups = buildActionGroups(logs);
    expect(groups[0]?.tools).toHaveLength(0);
  });
});

describe('buildActionGroups — preparation phase', () => {
  it('collapses the leading run of `register agent` events into one Preparing group', () => {
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
    const [prep, ...rest] = buildActionGroups(logs);
    expect(rest).toHaveLength(0);
    expect(prep?.kind).toBe('preparation');
    expect(prep?.agentName).toBe('Preparing agents');
    expect(prep?.tools).toHaveLength(3);
    expect(prep?.tools[0]?.rowTitle).toBe('Browser Agent · Browser Toolkit');
    expect(prep?.tools[0]?.status).toBe('done');
    expect(prep?.tools[1]?.status).toBe('running');
  });

  it('ends the Preparing group when a non-register event arrives', () => {
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
    const groups = buildActionGroups(logs);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.kind).toBe('preparation');
    expect(groups[0]?.status).toBe('done');
    expect(groups[1]?.kind).toBe('action');
    expect(groups[1]?.reasoning).toBe('let me open the page');
    expect(groups[1]?.tools[0]?.rowTitle).toBe('Browser Toolkit · Open');
  });

  it('routes mid-run register events to the Preparing group without interrupting the active agent', () => {
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
      // A specialist registered lazily after the browser agent already
      // started acting. It must still land in the Preparing group, not
      // inside the browser agent's action group.
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
    const groups = buildActionGroups(logs);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.kind).toBe('preparation');
    expect(groups[0]?.tools).toHaveLength(3);
    expect(groups[0]?.tools.map((t) => t.rowTitle)).toEqual([
      'Developer Agent · Terminal Toolkit',
      'Browser Agent · Browser Toolkit',
      'Multi Modal Agent · Open Ai Image Toolkit',
    ]);
    expect(groups[1]?.kind).toBe('action');
    expect(groups[1]?.agentId).toBe('a-browser');
    expect(groups[1]?.tools).toHaveLength(1);
    expect(groups[1]?.tools[0]?.rowTitle).toBe('Browser Toolkit · Open');
  });

  it('creates a Preparing group even when the first event is an action (for late registrations)', () => {
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
    const groups = buildActionGroups(logs);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.kind).toBe('preparation');
    expect(groups[0]?.tools).toHaveLength(1);
    expect(groups[1]?.kind).toBe('action');
    expect(groups[1]?.tools).toHaveLength(0);
  });
});

describe('getGroupTitle', () => {
  it('prefers reasoning text', () => {
    const [group] = buildActionGroups([
      tag(
        'a1',
        'x',
        'X',
        mk(AgentStep.ACTIVATE_AGENT, { message: 'Reading the spec.' })
      ),
    ]);
    expect(getGroupTitle(group!)).toBe('Reading the spec.');
  });

  it('falls back to the most recent tool title', () => {
    const [group] = buildActionGroups([
      tag(
        'a1',
        'x',
        'X',
        mk(AgentStep.ACTIVATE_TOOLKIT, {
          toolkit_name: 'Terminal Toolkit',
          method_name: 'shell_exec',
          message: 'ls',
        })
      ),
    ]);
    expect(getGroupTitle(group!)).toBe('Terminal Toolkit · Shell_exec');
  });

  it('shows a placeholder when a group has neither', () => {
    const [group] = buildActionGroups([
      tag('a1', 'x', 'X', mk(AgentStep.ACTIVATE_AGENT, {})),
    ]);
    expect(getGroupTitle(group!)).toBe('Thinking…');
  });
});
