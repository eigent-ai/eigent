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

import { fetchGet, fetchPost } from '@/api/http';
import { runProjectionStore } from '@/lib/runEvents/projectionStore';
import { getProjectEventStore } from '@/store/projectEventStore';
import {
  ControlOutcomeUnknown,
  controlOwner,
  controlRequest,
} from './controlRequest';
import { reconcileHumanInteractionEvents } from './humanInteractionEventReconciliation';
import { parseSummary } from './runStateReconciliation';

export type ControlReceipt = Record<string, unknown>;
export type ControlOperation = {
  key: string;
  owner: string;
  kind: 'interaction' | 'cancel' | 'stop';
  runId: string;
  projectId?: string;
  interactionId?: string;
  version?: number;
  digest?: string;
  path: string;
  body: Readonly<Record<string, unknown>>;
  phase: 'pending' | 'unknown' | 'acknowledged' | 'checking' | 'resolved';
  receipt?: ControlReceipt;
  retryAllowed: boolean;
  generation: number;
};

// Renderer-lifetime ownership: navigation must not create a second intent.
const operations = new Map<string, ControlOperation>();
const flights = new Map<string, Promise<ControlReceipt>>();
const listeners = new Set<() => void>();
let revision = 0;
export const controlOperationsRevision = () => revision;
export function subscribeControlOperations(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function publish() {
  revision++;
  for (const listener of listeners) listener();
}
export function listControlOperations(owner = controlOwner()) {
  return [...operations.values()].filter((op) => op.owner === owner);
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export function createControlOperation(
  input: Omit<
    ControlOperation,
    'key' | 'owner' | 'phase' | 'retryAllowed' | 'generation' | 'receipt'
  >
): ControlOperation {
  const owner = controlOwner();
  // Group interaction versions together too: a changed card cannot override
  // an unresolved intent. Its original version/digest remain in the envelope.
  const key = JSON.stringify([
    owner,
    input.kind,
    input.runId,
    input.interactionId,
  ]);
  const existing = operations.get(key);
  if (existing) {
    if (input.projectId && !existing.projectId)
      existing.projectId = input.projectId;
    return existing;
  }
  const operation: ControlOperation = {
    ...input,
    key,
    owner,
    body: freeze(JSON.parse(JSON.stringify(input.body))),
    phase: 'unknown',
    retryAllowed: true,
    generation: 0,
  };
  operations.set(key, operation);
  return operation;
}

function readReceipt(op: ControlOperation, value: unknown): ControlReceipt {
  if (!value || typeof value !== 'object') throw new ControlOutcomeUnknown();
  const receipt = value as ControlReceipt;
  if (receipt.run_id !== op.runId) throw new ControlOutcomeUnknown();
  if (op.kind === 'interaction') {
    op.retryAllowed = false;
    if (
      receipt.interaction_id !== op.interactionId ||
      typeof receipt.version !== 'number' ||
      receipt.version < (op.version ?? 0)
    )
      throw new ControlOutcomeUnknown();
    if (receipt.action_digest != null && receipt.action_digest !== op.digest)
      throw new ControlOutcomeUnknown();
    const terminal = ['resolved', 'expired', 'cancelled'].includes(
      String(receipt.status)
    );
    if (
      !terminal &&
      !['requested', 'presented'].includes(String(receipt.status))
    )
      throw new ControlOutcomeUnknown();
    op.retryAllowed =
      !terminal &&
      receipt.version === op.version &&
      (op.digest === undefined || receipt.action_digest === op.digest);
    if (receipt.status === 'resolved') {
      const response = receipt.response as Record<string, unknown> | undefined;
      if (!response || typeof response !== 'object' || Array.isArray(response))
        throw new ControlOutcomeUnknown();
      const submitted = op.body.decision as Record<string, unknown>;
      if (
        ['approved', 'rejected'].includes(String(submitted.decision)) &&
        (!['approved', 'rejected'].includes(String(response.decision)) ||
          (response.scope !== undefined &&
            !['once', 'run', 'space'].includes(String(response.scope))))
      )
        throw new ControlOutcomeUnknown();
    }
    op.phase = terminal ? 'resolved' : 'unknown';
  } else {
    if (
      ![
        'pending',
        'running',
        'waiting_for_user',
        'cancelling',
        'interrupted',
        'completed',
        'cancelled',
        'failed',
        'timed_out',
      ].includes(String(receipt.status))
    )
      throw new ControlOutcomeUnknown();
    op.phase = ['completed', 'cancelled', 'failed', 'timed_out'].includes(
      String(receipt.status)
    )
      ? 'resolved'
      : 'acknowledged';
    op.retryAllowed = op.phase !== 'resolved';
  }
  op.receipt = receipt;
  return receipt;
}

function execute(
  op: ControlOperation,
  checking: boolean
): Promise<ControlReceipt> {
  if (controlOwner() !== op.owner)
    return Promise.reject(new ControlOutcomeUnknown());
  const current = flights.get(op.key);
  if (current) return current;
  const generation = ++op.generation;
  op.phase = checking ? 'checking' : 'pending';
  // Reserve synchronously before publishing to React or beginning async lookup.
  const work = controlRequest(async (options) => {
    if (!checking) return fetchPost(op.path, op.body, undefined, options);
    if (op.kind === 'interaction') {
      const result = await fetchGet(
        `/runs/${encodeURIComponent(op.runId)}/interactions`,
        { status: 'all' },
        undefined,
        options
      );
      options.beforeRequest?.();
      if (result?.run_id !== op.runId || !Array.isArray(result.interactions))
        throw new ControlOutcomeUnknown();
      const receipt = result.interactions.find(
        (item: ControlReceipt) => item.interaction_id === op.interactionId
      );
      if (
        op.projectId &&
        ['resolved', 'expired', 'cancelled'].includes(receipt?.status)
      ) {
        await reconcileHumanInteractionEvents(
          {
            projectId: op.projectId,
            runId: op.runId,
            interactionId: op.interactionId!,
            afterSequence: 0,
          },
          options
        );
      }
      return receipt;
    }
    return fetchGet(
      `/runs/${encodeURIComponent(op.runId)}`,
      undefined,
      undefined,
      options
    );
  }, op.owner)
    .then((result) => {
      if (controlOwner() !== op.owner || op.generation !== generation)
        throw new ControlOutcomeUnknown();
      if (op.kind === 'stop' && !checking) {
        // 201 means queued, never stopped. Only a canonical Run read/event can
        // establish completion. Keep the original target available for recovery.
        op.phase = 'acknowledged';
        return {};
      }
      const receipt = readReceipt(op, result);
      if (op.kind !== 'interaction' && op.projectId) {
        const summary = parseSummary(receipt, op.projectId, op.runId);
        const store = getProjectEventStore(op.projectId);
        store.reconcileRunSummary(summary, store.getIncarnation());
        runProjectionStore.upsertRunSummaries(op.projectId, [summary]);
      }
      return receipt;
    })
    .catch((error) => {
      if (op.generation === generation) {
        op.phase = 'unknown';
        if ((error as { status?: number })?.status === 409)
          op.retryAllowed = false;
      }
      throw error;
    })
    .finally(() => {
      if (op.generation === generation) {
        flights.delete(op.key);
        publish();
      }
    });
  flights.set(op.key, work);
  publish();
  return work;
}

export function submitControlOperation(op: ControlOperation, retry = false) {
  if (
    op.kind === 'interaction' &&
    listControlOperations(op.owner).some(
      (other) => other.kind !== 'interaction' && other.runId === op.runId
    )
  ) {
    op.retryAllowed = false;
    return Promise.reject(new ControlOutcomeUnknown());
  }
  if (flights.has(op.key)) return flights.get(op.key)!;
  if (op.phase === 'resolved' && op.receipt) return Promise.resolve(op.receipt);
  if (op.generation > 0 && (!retry || !op.retryAllowed))
    return Promise.reject(new ControlOutcomeUnknown());
  return execute(op, false);
}
export function checkControlOperation(op: ControlOperation) {
  return execute(op, true);
}

export function stopProjectTask(projectId: string, taskId: string) {
  const op = createControlOperation({
    kind: 'stop',
    projectId,
    runId: taskId,
    path: `/chat/${encodeURIComponent(projectId)}/skip-task?expected_task_id=${encodeURIComponent(taskId)}`,
    body: { project_id: projectId },
  });
  return submitControlOperation(op);
}
