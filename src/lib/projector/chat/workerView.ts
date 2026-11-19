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

/**
 * Worker views over a Session's projected timeline.
 *
 * A Workforce Session stores every worker's activity in one timeline. These
 * selectors find the workers and filter the timeline to one of them, without
 * new records.
 *
 * Identity: an agent id is a process instance and changes on every Run, so a
 * worker is keyed by its normalized name across Runs. Agent ids are only used
 * to link nodes that carry an id but no name.
 */

import type {
  ChatActivityStatus,
  ChatProjectionNode,
  ChatStepStatus,
} from './types';

export type SessionWorkerStatus =
  'idle' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';

export interface SessionWorker {
  /** Stable across Runs: the normalized worker name. */
  key: string;
  name: string;
  status: SessionWorkerStatus;
  /** Latest task given to the worker, or its latest turn's prompt. */
  currentTask?: string;
  /** Runs the worker took part in, in timeline order. */
  runIds: string[];
  /** Run sequence of the worker's first node in its first Run. */
  firstRunSequence: number;
  lastCreatedAt: string | null;
  pendingRequests: number;
}

export function workerKeyForName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function nodeAgentId(node: ChatProjectionNode): string | undefined {
  switch (node.kind) {
    case 'message':
    case 'step':
    case 'activity':
    case 'artifact':
      return node.agentId || undefined;
    default:
      return undefined;
  }
}

function nodeAgentName(node: ChatProjectionNode): string | undefined {
  switch (node.kind) {
    case 'message':
    case 'step':
    case 'activity':
    case 'interaction':
      return node.agentName?.trim() || undefined;
    default:
      return undefined;
  }
}

function nodeTaskId(node: ChatProjectionNode): string | undefined {
  if (node.kind === 'activity' || node.kind === 'artifact') {
    return node.taskId || undefined;
  }
  return undefined;
}

function nodeStepId(node: ChatProjectionNode): string | undefined {
  switch (node.kind) {
    case 'activity':
    case 'interaction':
    case 'notice':
    case 'step':
    case 'artifact':
      return node.stepId || undefined;
    default:
      return undefined;
  }
}

function activityStatus(
  status: ChatActivityStatus | ChatStepStatus
): SessionWorkerStatus | null {
  switch (status) {
    case 'pending':
    case 'running':
      return 'running';
    case 'completed':
      return 'completed';
    case 'failed':
    case 'timed_out':
      return 'failed';
    case 'cancelled':
    case 'interrupted':
      return 'cancelled';
    case 'blocked':
      return 'waiting';
    default:
      return null;
  }
}

/** Links nodes to worker keys: by name, by agent id, by task and by step. */
class WorkerIndex {
  readonly names = new Map<string, string>();
  private readonly keyByAgentId = new Map<string, string>();
  private readonly keysByTaskId = new Map<string, Set<string>>();
  private readonly keysByStepId = new Map<string, Set<string>>();
  private readonly keysByInteractionId = new Map<string, Set<string>>();

  constructor(nodes: readonly ChatProjectionNode[]) {
    for (const node of nodes) {
      const name = nodeAgentName(node);
      const agentId = nodeAgentId(node);
      if (name) {
        const key = workerKeyForName(name);
        if (!this.names.has(key)) this.names.set(key, name);
        if (agentId) this.keyByAgentId.set(agentId, key);
      }
    }
    for (const node of nodes) {
      if (node.kind === 'plan') {
        // A plan names the worker each task was given to.
        for (const task of node.tasks) {
          const key = task.agentName
            ? workerKeyForName(task.agentName)
            : task.agentId
              ? this.keyByAgentId.get(task.agentId)
              : undefined;
          if (key) this.link(this.keysByTaskId, task.id, key);
        }
      }
    }
    for (const node of nodes) {
      const key = this.directKey(node);
      if (key) {
        const taskId = nodeTaskId(node);
        if (taskId) this.link(this.keysByTaskId, taskId, key);
        const stepId = nodeStepId(node);
        if (stepId) this.link(this.keysByStepId, stepId, key);
        if (node.kind === 'activity' && node.toolCallId) {
          this.link(this.keysByStepId, node.toolCallId, key);
        }
      }
      // An answer to an approval carries the request's id, not its step, so
      // remember who each request belonged to (requests follow their tool).
      if (node.kind === 'interaction' && node.interactionId) {
        for (const owner of this.owners(node)) {
          this.link(this.keysByInteractionId, node.interactionId, owner);
        }
      }
    }
  }

  private link(map: Map<string, Set<string>>, id: string, key: string) {
    let keys = map.get(id);
    if (!keys) {
      keys = new Set();
      map.set(id, keys);
    }
    keys.add(key);
  }

  private directKey(node: ChatProjectionNode): string | undefined {
    const name = nodeAgentName(node);
    if (name) return workerKeyForName(name);
    const agentId = nodeAgentId(node);
    return agentId ? this.keyByAgentId.get(agentId) : undefined;
  }

  /** Worker keys a node belongs to; empty for coordinator and user nodes. */
  owners(node: ChatProjectionNode): Set<string> {
    const direct = this.directKey(node);
    if (direct) return new Set([direct]);
    const taskId = nodeTaskId(node);
    const byTask = taskId ? this.keysByTaskId.get(taskId) : undefined;
    if (byTask?.size) return byTask;
    const stepId = nodeStepId(node);
    const byStep = stepId ? this.keysByStepId.get(stepId) : undefined;
    if (byStep?.size) return byStep;
    if (node.kind === 'interaction' && node.interactionId) {
      const byRequest = this.keysByInteractionId.get(node.interactionId);
      if (byRequest?.size) return byRequest;
    }
    return new Set();
  }
}

function runOrder(nodes: readonly ChatProjectionNode[]): Map<string, number> {
  const order = new Map<string, number>();
  for (const node of nodes) {
    if (!order.has(node.runId)) order.set(node.runId, order.size);
  }
  return order;
}

/**
 * Workers of a Session, in the order they were first given work. A worker
 * that did nothing in the latest Run sorts after the ones that did.
 */
export function selectSessionWorkers(
  nodes: readonly ChatProjectionNode[]
): SessionWorker[] {
  const index = new WorkerIndex(nodes);
  const runs = runOrder(nodes);
  const workers = new Map<
    string,
    SessionWorker & { order: number; openRequests: Set<string> }
  >();

  nodes.forEach((node, position) => {
    for (const key of index.owners(node)) {
      let worker = workers.get(key);
      if (!worker) {
        worker = {
          key,
          name: index.names.get(key) ?? key,
          status: 'idle',
          runIds: [],
          firstRunSequence: node.runSequence,
          lastCreatedAt: null,
          pendingRequests: 0,
          order: position,
          openRequests: new Set(),
        };
        workers.set(key, worker);
      }
      if (!worker.runIds.includes(node.runId)) worker.runIds.push(node.runId);
      worker.lastCreatedAt = node.createdAt ?? worker.lastCreatedAt;

      if (node.kind === 'activity' && node.activityType === 'agent') {
        worker.status = activityStatus(node.status) ?? worker.status;
        if (node.input) worker.currentTask = node.input;
      } else if (node.kind === 'step') {
        worker.status = activityStatus(node.status) ?? worker.status;
        worker.currentTask = node.title || worker.currentTask;
      } else if (node.kind === 'interaction' && node.interactionId) {
        if (node.status === 'requested') {
          worker.openRequests.add(node.interactionId);
        } else {
          worker.openRequests.delete(node.interactionId);
        }
      }
    }
  });

  const latestRun = Math.max(-1, ...runs.values());
  return [...workers.values()]
    .map(({ order, openRequests, ...worker }) => ({
      worker: {
        ...worker,
        status: openRequests.size ? ('waiting' as const) : worker.status,
        pendingRequests: openRequests.size,
      },
      order,
      inLatestRun: worker.runIds.some((runId) => runs.get(runId) === latestRun),
    }))
    .sort(
      (a, b) =>
        Number(b.inLatestRun) - Number(a.inLatestRun) || a.order - b.order
    )
    .map(({ worker }) => worker);
}

/**
 * The timeline of one worker: its own nodes, the nodes linked to it through
 * its tasks and steps, and the user message that started each of its Runs.
 */
export function filterChatNodesForWorker(
  nodes: readonly ChatProjectionNode[],
  workerKey: string
): ChatProjectionNode[] {
  const index = new WorkerIndex(nodes);
  const owned = nodes.filter((node) => index.owners(node).has(workerKey));
  if (!owned.length) return [];
  const runIds = new Set(owned.map((node) => node.runId));
  return nodes.filter(
    (node) =>
      index.owners(node).has(workerKey) ||
      (runIds.has(node.runId) &&
        node.kind === 'message' &&
        node.role === 'user')
  );
}
