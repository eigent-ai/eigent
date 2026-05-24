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

import { normalizeTaskToQueryGroups } from '@/components/ChatBox/renderSession/queryGroups';
import type { RenderGroupMeta, WorkLogCursor } from '@/store/chatStore';
import { AgentStep, type AgentStepType } from '@/types/constants';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _id = 0;
function nextId() {
  return `msg-${++_id}`;
}

function userMsg(content = 'user prompt'): Message {
  return { id: nextId(), role: 'user', content };
}

function agentMsg(step?: AgentStepType, content = 'agent output'): Message {
  return { id: nextId(), role: 'agent', content, step };
}

function askMsg(): Message {
  return agentMsg(AgentStep.ASK, 'Should I continue?');
}

function toSubTasksMsg(): Message {
  return agentMsg(AgentStep.TO_SUB_TASKS, 'splitting');
}

function meta(
  id: string,
  kind: RenderGroupMeta['kind'],
  userMessageId: string | null,
  startCursor: WorkLogCursor,
  endCursor?: WorkLogCursor,
  startElapsedMs = 0,
  endElapsedMs?: number
): RenderGroupMeta {
  return {
    id,
    kind,
    userMessageId,
    startCursor,
    endCursor,
    startElapsedMs,
    endElapsedMs,
  };
}

const TASK_ID = 'task-1';

// ---------------------------------------------------------------------------
// New-path: renderGroups present
// ---------------------------------------------------------------------------

describe('normalizeTaskToQueryGroups — new path (renderGroups)', () => {
  it('single initial query — no workLog endCursor (active group)', () => {
    const u1 = userMsg();
    const a1 = agentMsg();
    const groups = normalizeTaskToQueryGroups(
      {
        messages: [u1, a1],
        renderGroups: [meta(u1.id, 'initial_query', u1.id, {})],
      },
      TASK_ID
    );

    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g.id).toBe(u1.id);
    expect(g.kind).toBe('initial_query');
    expect(g.userMessage?.id).toBe(u1.id);
    expect(g.outputMessages).toHaveLength(1);
    expect(g.workLog?.startCursor).toEqual({});
    expect(g.workLog?.endCursor).toBeUndefined();
  });

  it('two groups — first gets endCursor, second is active', () => {
    const u1 = userMsg();
    const a1 = agentMsg();
    const u2 = userMsg('follow up');
    const a2 = agentMsg();

    const cursor: WorkLogCursor = { 'agent-a': 3 };

    const groups = normalizeTaskToQueryGroups(
      {
        messages: [u1, a1, u2, a2],
        renderGroups: [
          meta(u1.id, 'initial_query', u1.id, {}, cursor),
          meta(u2.id, 'follow_up', u2.id, cursor),
        ],
      },
      TASK_ID
    );

    expect(groups).toHaveLength(2);

    expect(groups[0].kind).toBe('initial_query');
    expect(groups[0].outputMessages.map((m) => m.id)).toEqual([a1.id]);
    expect(groups[0].workLog?.endCursor).toEqual(cursor);

    expect(groups[1].kind).toBe('follow_up');
    expect(groups[1].outputMessages.map((m) => m.id)).toEqual([a2.id]);
    expect(groups[1].workLog?.startCursor).toEqual(cursor);
    expect(groups[1].workLog?.endCursor).toBeUndefined();
  });

  it('human_reply kind is preserved from renderGroups metadata', () => {
    const u1 = userMsg();
    const ask = askMsg();
    const u2 = userMsg('my answer');

    const groups = normalizeTaskToQueryGroups(
      {
        messages: [u1, ask, u2],
        renderGroups: [
          meta(u1.id, 'initial_query', u1.id, {}, {}),
          meta(u2.id, 'human_reply', u2.id, {}),
        ],
      },
      TASK_ID
    );

    expect(groups[1].kind).toBe('human_reply');
    expect(groups[1].userMessage?.id).toBe(u2.id);
  });

  it('TO_SUB_TASKS message goes into taskMessage, not outputMessages', () => {
    const u1 = userMsg();
    const sub = toSubTasksMsg();
    const a1 = agentMsg();

    const groups = normalizeTaskToQueryGroups(
      {
        messages: [u1, sub, a1],
        renderGroups: [meta(u1.id, 'initial_query', u1.id, {})],
      },
      TASK_ID
    );

    expect(groups[0].taskMessage?.id).toBe(sub.id);
    expect(groups[0].outputMessages.map((m) => m.id)).toEqual([a1.id]);
  });

  it('group with null userMessageId (orphan) has null userMessage', () => {
    const a1 = agentMsg();

    const groups = normalizeTaskToQueryGroups(
      {
        messages: [a1],
        renderGroups: [meta('orphan-1', 'orphan', null, {})],
      },
      TASK_ID
    );

    expect(groups[0].userMessage).toBeNull();
    expect(groups[0].outputMessages.map((m) => m.id)).toEqual([a1.id]);
  });
});

// ---------------------------------------------------------------------------
// Legacy path: no renderGroups
// ---------------------------------------------------------------------------

describe('normalizeTaskToQueryGroups — legacy path (no renderGroups)', () => {
  it('single user message + agent response → one initial_query group', () => {
    const u = userMsg();
    const a = agentMsg();

    const groups = normalizeTaskToQueryGroups({ messages: [u, a] }, TASK_ID);

    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('initial_query');
    expect(groups[0].userMessage?.id).toBe(u.id);
    expect(groups[0].outputMessages.map((m) => m.id)).toEqual([a.id]);
  });

  it('workLog only on last group — no workLog on earlier groups', () => {
    const u1 = userMsg();
    const a1 = agentMsg();
    const u2 = userMsg('follow up');
    const a2 = agentMsg();

    const groups = normalizeTaskToQueryGroups(
      { messages: [u1, a1, u2, a2] },
      TASK_ID
    );

    expect(groups).toHaveLength(2);
    expect(groups[0].workLog).toBeUndefined();
    expect(groups[1].workLog).toBeDefined();
    expect(groups[1].workLog?.startCursor).toEqual({});
    expect(groups[1].workLog?.endCursor).toBeUndefined();
  });

  it('reply after ASK step gets kind = human_reply', () => {
    const u1 = userMsg();
    const ask = askMsg();
    const u2 = userMsg('my answer');

    const groups = normalizeTaskToQueryGroups(
      { messages: [u1, ask, u2] },
      TASK_ID
    );

    expect(groups).toHaveLength(2);
    expect(groups[1].kind).toBe('human_reply');
  });

  it('reply after non-ASK agent step gets kind = follow_up', () => {
    const u1 = userMsg();
    const a1 = agentMsg(); // not ASK
    const u2 = userMsg('follow up');

    const groups = normalizeTaskToQueryGroups(
      { messages: [u1, a1, u2] },
      TASK_ID
    );

    expect(groups[1].kind).toBe('follow_up');
  });

  it('agent messages before any user message become an orphan group', () => {
    const a1 = agentMsg();
    const u1 = userMsg();

    const groups = normalizeTaskToQueryGroups({ messages: [a1, u1] }, TASK_ID);

    expect(groups[0].kind).toBe('orphan');
    expect(groups[0].userMessage).toBeNull();
    expect(groups[0].outputMessages.map((m) => m.id)).toEqual([a1.id]);
  });

  it('TO_SUB_TASKS goes into taskMessage of current group', () => {
    const u1 = userMsg();
    const sub = toSubTasksMsg();

    const groups = normalizeTaskToQueryGroups({ messages: [u1, sub] }, TASK_ID);

    expect(groups[0].taskMessage?.id).toBe(sub.id);
    expect(groups[0].outputMessages).toHaveLength(0);
  });

  it('multiple asks and replies produce correct group sequence', () => {
    const u1 = userMsg();
    const ask1 = askMsg();
    const u2 = userMsg('answer 1');
    const ask2 = askMsg();
    const u3 = userMsg('answer 2');
    const a1 = agentMsg();

    const groups = normalizeTaskToQueryGroups(
      { messages: [u1, ask1, u2, ask2, u3, a1] },
      TASK_ID
    );

    expect(groups).toHaveLength(3);
    expect(groups[0].kind).toBe('initial_query');
    expect(groups[1].kind).toBe('human_reply');
    expect(groups[2].kind).toBe('human_reply');
    expect(groups[2].outputMessages.map((m) => m.id)).toEqual([a1.id]);
  });

  it('empty messages list returns empty array', () => {
    expect(normalizeTaskToQueryGroups({ messages: [] }, TASK_ID)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('normalizeTaskToQueryGroups — edge cases', () => {
  it('empty renderGroups falls through to legacy path', () => {
    const u1 = userMsg();
    const a1 = agentMsg();

    const groups = normalizeTaskToQueryGroups(
      { messages: [u1, a1], renderGroups: [] },
      TASK_ID
    );

    // Legacy path: single group, workLog on last
    expect(groups).toHaveLength(1);
    expect(groups[0].workLog).toBeDefined();
  });

  it('taskId is propagated to every group and workLog', () => {
    const u1 = userMsg();
    const a1 = agentMsg();

    const groups = normalizeTaskToQueryGroups(
      {
        messages: [u1, a1],
        renderGroups: [meta(u1.id, 'initial_query', u1.id, {})],
      },
      'my-task-id'
    );

    expect(groups[0].taskId).toBe('my-task-id');
    expect(groups[0].workLog?.taskId).toBe('my-task-id');
  });
});
