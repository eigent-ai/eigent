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

import type { ChatProjectionNode } from '@/lib/projector/chat';
import {
  filterChatNodesForWorker,
  selectSessionWorkers,
  workerKeyForName,
} from '@/lib/projector/chat/workerView';
import { describe, expect, it } from 'vitest';

type Node<K extends ChatProjectionNode['kind']> = Extract<
  ChatProjectionNode,
  { kind: K }
>;

let sequence = 0;
function base(runId: string) {
  sequence += 1;
  return {
    id: `node-${sequence}`,
    eventId: `event-${sequence}`,
    projectId: 'project-1',
    runId,
    createdAt: `2026-11-18T00:00:${String(sequence).padStart(2, '0')}Z`,
    runSequence: sequence,
    cloudCursor: null,
    eventType: 'test',
    legacyStep: null,
  };
}

function userMessage(runId: string, content: string): Node<'message'> {
  return {
    ...base(runId),
    kind: 'message',
    role: 'user',
    content,
    status: 'complete',
  };
}

function agentTurn(
  runId: string,
  agentId: string,
  agentName: string,
  status: Node<'activity'>['status'],
  input?: string
): Node<'activity'> {
  return {
    ...base(runId),
    kind: 'activity',
    activityType: 'agent',
    status,
    title: agentName,
    agentId,
    agentName,
    input,
  };
}

function tool(
  runId: string,
  overrides: Partial<Node<'activity'>>
): Node<'activity'> {
  return {
    ...base(runId),
    kind: 'activity',
    activityType: 'tool',
    status: 'completed',
    title: 'Terminal.shell_exec',
    ...overrides,
  };
}

function plan(runId: string, tasks: Node<'plan'>['tasks']): Node<'plan'> {
  return { ...base(runId), kind: 'plan', tasks };
}

function approval(
  runId: string,
  interactionId: string,
  status: Node<'interaction'>['status'],
  stepId?: string
): Node<'interaction'> {
  return {
    ...base(runId),
    kind: 'interaction',
    interactionId,
    interactionType: 'approval',
    status,
    stepId,
  };
}

/** Two Runs; agent ids change between Runs, names stay the same. */
function session() {
  sequence = 0;
  const nodes = {
    ask1: userMessage('run-1', 'Launch the pricing page'),
    plan1: plan('run-1', [
      { id: 't1', title: 'Research', status: 'completed', agentId: 'r-1' },
      { id: 't2', title: 'Build', status: 'running', agentId: 'd-1' },
    ]),
    research1: agentTurn(
      'run-1',
      'r-1',
      'Research Agent',
      'running',
      'Research competitor pricing'
    ),
    researchTool: tool('run-1', { taskId: 't1' }),
    researchDone: agentTurn('run-1', 'r-1', 'Research Agent', 'completed'),
    dev1: agentTurn('run-1', 'd-1', 'Developer Agent', 'running', 'Build'),
    devTool: tool('run-1', {
      agentName: 'Developer Agent',
      stepId: 'step-dev',
    }),
    devApproval: approval('run-1', 'approval-1', 'requested', 'step-dev'),
    ask2: userMessage('run-2', 'Also check the links'),
    dev2: agentTurn(
      'run-2',
      'd-2',
      'Developer Agent',
      'running',
      'Check the links'
    ),
  };
  return { nodes, list: Object.values(nodes) as ChatProjectionNode[] };
}

describe('selectSessionWorkers', () => {
  it('keys workers by name across Runs and puts latest-Run workers first', () => {
    const { list } = session();

    const workers = selectSessionWorkers(list);

    expect(workers.map((worker) => worker.key)).toEqual([
      'developer agent',
      'research agent',
    ]);
    const [developer, research] = workers;
    expect(developer.runIds).toEqual(['run-1', 'run-2']);
    expect(developer.status).toBe('waiting');
    expect(developer.pendingRequests).toBe(1);
    expect(developer.currentTask).toBe('Check the links');
    expect(research.status).toBe('completed');
    expect(research.currentTask).toBe('Research competitor pricing');
  });

  it('clears the waiting status once the approval is answered', () => {
    const { list } = session();
    const workers = selectSessionWorkers([
      ...list,
      approval('run-1', 'approval-1', 'responded'),
    ]);

    const developer = workers.find((w) => w.key === 'developer agent');
    expect(developer?.status).toBe('running');
    expect(developer?.pendingRequests).toBe(0);
  });

  it('returns no workers for a timeline without agents', () => {
    sequence = 0;
    expect(selectSessionWorkers([userMessage('run-1', 'Hi')])).toEqual([]);
  });
});

describe('filterChatNodesForWorker', () => {
  it('keeps the worker nodes, task-linked tools and each Run start', () => {
    const { nodes, list } = session();

    const research = filterChatNodesForWorker(list, 'research agent');

    expect(research.map((node) => node.id)).toEqual([
      nodes.ask1.id,
      nodes.research1.id,
      nodes.researchTool.id,
      nodes.researchDone.id,
    ]);
  });

  it('links approvals through the step of the tool call they block', () => {
    const { nodes, list } = session();

    const developer = filterChatNodesForWorker(
      list,
      workerKeyForName('  Developer   agent ')
    ).map((node) => node.id);

    expect(developer).toContain(nodes.devTool.id);
    expect(developer).toContain(nodes.devApproval.id);
    // A second Run section with its own start message.
    expect(developer).toContain(nodes.ask2.id);
    expect(developer).not.toContain(nodes.researchTool.id);
    expect(developer).not.toContain(nodes.plan1.id);
  });

  it('returns nothing for an unknown worker', () => {
    const { list } = session();
    expect(filterChatNodesForWorker(list, 'nobody')).toEqual([]);
  });
});
