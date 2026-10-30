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
import { TERMINAL_RUN_STATUSES } from '@/lib/projector/runSummary';
import { runProjectionStore } from '@/lib/runEvents/projectionStore';
import {
  getProjectEventStore,
  type ProjectEventStoreSnapshot,
} from '@/store/projectEventStore';
import {
  ControlOutcomeUnknown,
  controlOwner,
  controlRequest,
} from './controlRequest';
import { completeProjectHumanInteraction } from './humanInteractionCompletion';
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
  // A canonical decision can precede cleanup of its inactive legacy ask.
  completionPending?: boolean;
  retryAllowed: boolean;
  generation: number;
};

// Renderer-lifetime ownership: navigation must not create a second intent.
const operations = new Map<string, ControlOperation>();
export const TERMINAL_CONTROL_LIMIT = 128;
const terminalOperations = new Map<string, ControlOperation>();
let registryOwner: string | undefined;
function maintainOwner() {
  const owner = controlOwner();
  if (owner !== registryOwner) {
    for (const op of [...operations.values(), ...terminalOperations.values()])
      op.generation++;
    operations.clear();
    terminalOperations.clear();
    flights.clear();
    registryOwner = owner;
  }
}
function compactTerminal(op: ControlOperation) {
  if (op.owner !== registryOwner) return;
  // No terminal operation can be retried. Retain a bounded, minimal tombstone
  // for stale mounted controls; the backend's CAS still protects older evictions.
  op.body = Object.freeze({});
  op.path = '';
  op.retryAllowed = false;
  if (op.receipt) {
    const { run_id, interaction_id, version, status, action_digest, response } =
      op.receipt;
    op.receipt = {
      run_id,
      interaction_id,
      version,
      status,
      action_digest,
      response,
    };
  }
  terminalOperations.delete(op.key);
  op.completionPending ??= op.kind === 'interaction' && Boolean(op.projectId);
  if (op.completionPending) {
    // Drop the request payload, but never evict unfinished local completion.
    operations.set(op.key, op);
    return;
  }
  operations.delete(op.key);
  terminalOperations.set(op.key, op);
  while (terminalOperations.size > TERMINAL_CONTROL_LIMIT)
    terminalOperations.delete(terminalOperations.keys().next().value!);
}
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
  maintainOwner();
  return [...operations.values(), ...terminalOperations.values()].filter(
    (op) => op.owner === owner
  );
}
function isRegistered(op: ControlOperation) {
  return operations.get(op.key) === op || terminalOperations.get(op.key) === op;
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
    | 'key'
    | 'owner'
    | 'phase'
    | 'retryAllowed'
    | 'generation'
    | 'receipt'
    | 'completionPending'
  >
): ControlOperation {
  maintainOwner();
  const owner = controlOwner();
  // Group interaction versions together too: a changed card cannot override
  // an unresolved intent. Its original version/digest remain in the envelope.
  const key = JSON.stringify([
    owner,
    input.kind,
    input.runId,
    input.interactionId,
  ]);
  const existing = operations.get(key) ?? terminalOperations.get(key);
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
      if (
        !['approved', 'rejected'].includes(String(response.decision)) ||
        (response.scope !== undefined &&
          !['once', 'run', 'space'].includes(String(response.scope)))
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
  maintainOwner();
  if (controlOwner() !== op.owner || !isRegistered(op))
    return Promise.reject(new ControlOutcomeUnknown());
  const current = flights.get(op.key);
  if (current) return current;
  const generation = ++op.generation;
  const terminalReceipt = op.phase === 'resolved' ? op.receipt : undefined;
  op.phase = checking ? 'checking' : 'pending';
  // Reserve synchronously before publishing to React or beginning async lookup.
  const work = controlRequest(async (bounded) => {
    const guard = () => {
      bounded.beforeRequest?.();
      if (op.generation !== generation) throw new ControlOutcomeUnknown();
    };
    const options = { ...bounded, beforeRequest: guard, assertCurrent: guard };
    const submitted = !checking
      ? await fetchPost(op.path, op.body, undefined, options)
      : undefined;
    if (op.kind === 'interaction') {
      let receipt = submitted;
      if (checking) {
        const result = await fetchGet(
          `/runs/${encodeURIComponent(op.runId)}/interactions`,
          { status: 'all' },
          undefined,
          options
        );
        options.beforeRequest?.();
        if (result?.run_id !== op.runId || !Array.isArray(result.interactions))
          throw new ControlOutcomeUnknown();
        receipt = result.interactions.find(
          (item: ControlReceipt) => item.interaction_id === op.interactionId
        );
      }
      // Validate identity and the canonical decision before replay can advance
      // the legacy ask queue. Keep registry mutation after the bounded request.
      try {
        readReceipt({ ...op }, receipt);
      } catch (error) {
        op.retryAllowed = false;
        throw error;
      }
      if (
        (checking || generation > 1) &&
        op.projectId &&
        ['resolved', 'expired', 'cancelled'].includes(receipt?.status)
      ) {
        // Replay only advances the legacy ask; it cannot veto the receipt.
        const replayed = await reconcileHumanInteractionEvents(
          {
            projectId: op.projectId,
            runId: op.runId,
            interactionId: op.interactionId!,
            afterSequence: 0,
          },
          options
        ).then(
          () => true,
          () => false
        );
        options.beforeRequest?.();
        op.completionPending = !(
          replayed &&
          completeProjectHumanInteraction(
            op.projectId,
            op.runId,
            op.interactionId!
          )
        );
      }
      return receipt;
    }
    if (!checking) return submitted;
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
      if (terminalReceipt) {
        const candidate = { ...op };
        readReceipt(candidate, result);
        if (
          candidate.phase !== 'resolved' ||
          (typeof terminalReceipt.version === 'number' &&
            Number(candidate.receipt?.version) < terminalReceipt.version)
        )
          throw new ControlOutcomeUnknown();
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
        op.phase = terminalReceipt ? 'resolved' : 'unknown';
        if (terminalReceipt) op.receipt = terminalReceipt;
        if ((error as { status?: number })?.status === 409)
          op.retryAllowed = false;
      }
      throw error;
    })
    .finally(() => {
      if (op.generation === generation) {
        flights.delete(op.key);
        if (op.phase === 'resolved') compactTerminal(op);
        publish();
      }
    });
  flights.set(op.key, work);
  publish();
  return work;
}

/** Canonical events can complete an abandoned HTTP wait without inventing a decision. */
export function reconcileControlOperations(
  snapshot: ProjectEventStoreSnapshot
) {
  maintainOwner();
  let changed = false;
  for (const op of [...operations.values()]) {
    if (op.projectId !== snapshot.view.projectId) continue;
    const interaction = op.interactionId
      ? snapshot.control.interactionById[op.interactionId]
      : undefined;
    const run = snapshot.view.runs[op.runId];
    const status =
      op.kind === 'interaction' ? interaction?.status : run?.status;
    if (
      op.kind === 'interaction'
        ? !interaction ||
          interaction.runId !== op.runId ||
          !['resolved', 'expired', 'cancelled'].includes(String(status))
        : !run || !TERMINAL_RUN_STATUSES.has(run.status)
    )
      continue;
    if (
      op.kind === 'interaction' &&
      interaction?.actionDigest &&
      interaction.actionDigest !== op.digest
    )
      continue;
    if (
      interaction?.version !== undefined &&
      interaction.version < (op.version ?? 0)
    )
      continue;
    const alreadyResolved = op.phase === 'resolved';
    const completionPending = op.completionPending;
    if (op.interactionId)
      op.completionPending = !completeProjectHumanInteraction(
        op.projectId!,
        op.runId,
        op.interactionId
      );
    if (alreadyResolved && op.completionPending === completionPending) continue;
    op.receipt = {
      ...op.receipt,
      run_id: op.runId,
      interaction_id: op.interactionId,
      status,
      version: interaction?.version ?? op.version,
    };
    op.phase = 'resolved';
    op.generation++;
    flights.delete(op.key);
    compactTerminal(op);
    changed = true;
  }
  if (changed) publish();
}

export function submitControlOperation(op: ControlOperation, retry = false) {
  maintainOwner();
  if (controlOwner() !== op.owner || !isRegistered(op))
    return Promise.reject(new ControlOutcomeUnknown());
  if (
    op.kind === 'interaction' &&
    listControlOperations(op.owner).some(
      (other) => other.kind !== 'interaction' && other.runId === op.runId
    )
  ) {
    // Never record an intent that was not sent as an uncertain outcome.
    if (op.generation === 0) {
      operations.delete(op.key);
      publish();
    } else op.retryAllowed = false;
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
