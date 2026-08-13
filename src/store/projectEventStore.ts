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

import type {
  CanonicalProjectEvent,
  ProjectorEffect,
  ProjectorMode,
  ProjectSnapshotInput,
  ProjectViewState,
} from '@/lib/projector';
import {
  createProjectViewState,
  normalizeEvent,
  projectRawEvents,
  projectSnapshot,
} from '@/lib/projector';
import {
  createChatProjectionState,
  projectChatEvents,
  type ChatProjectionState,
} from '@/lib/projector/chat';
import {
  createHumanControlProjectionState,
  projectHumanControlEvents,
  type HumanControlProjectionState,
} from '@/lib/projector/control';

const DEFAULT_MAX_QUEUE_EVENTS = 1_000;
const DEFAULT_MAX_QUEUE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_EVENT_BYTES = 256 * 1024;
const DEFAULT_MAX_BATCH_EVENTS = 100;
const DEFAULT_MAX_SLICE_MS = 8;
const DEFAULT_MAX_SEEN_EVENT_IDS = 5_000;
const DEFAULT_MAX_UNKNOWN_EVENTS = 200;
const DEFAULT_MAX_LEGACY_STEPS = 2_000;
const DEFAULT_MAX_LEGACY_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_CHAT_NODES = 2_000;
const DEFAULT_MAX_CHAT_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_RESOLVED_CONTROLS = 200;
const DEFAULT_MAX_CONTROL_SEEN_EVENT_IDS = 5_000;
const DEFAULT_MAX_PENDING_CONTROLS = 128;
const DEFAULT_MAX_PENDING_CONTROL_BYTES = 2 * 1024 * 1024;

// Approximate array references, lookup values, and object-entry bookkeeping
// that JSON serialization does not represent. Lookup keys are accounted for
// separately because every node ID appears in both chat indexes.
const CHAT_NODE_INDEX_OVERHEAD_BYTES = 64;
const LEGACY_STEP_ARRAY_OVERHEAD_BYTES = 16;
const PENDING_CONTROL_INDEX_OVERHEAD_BYTES = 64;

type CancelScheduledFlush = () => void;
type ScheduleFlush = (callback: () => void) => CancelScheduledFlush;

export type ProjectEventStoreSnapshot = {
  view: ProjectViewState;
  chat: ChatProjectionState;
  /** Pending actions are non-evictable; completed receipts are bounded separately. */
  control: HumanControlProjectionState;
  revision: number;
  /** True only after an authoritative GET/snapshot replacement has committed. */
  hasHydratedSnapshot: boolean;
  overflowed: boolean;
  lastEffects: readonly ProjectorEffect[];
};

/**
 * Opaque ownership token for one atomic snapshot rebuild. While a token is
 * active, live events stay in the store's bounded queue instead of being
 * projected into state that the snapshot would replace.
 */
export type ProjectEventStoreSnapshotReplacement = Readonly<{
  projectId: string;
  generation: number;
}>;

export type ProjectEventStoreOptions = {
  mode?: ProjectorMode;
  maxQueueEvents?: number;
  maxQueueBytes?: number;
  maxEventBytes?: number;
  maxBatchEvents?: number;
  maxSliceMs?: number;
  maxSeenEventIds?: number;
  maxUnknownEvents?: number;
  maxLegacySteps?: number;
  /** Approximate UTF-16 heap budget for retained legacy compatibility steps. */
  maxLegacyBytes?: number;
  maxChatNodes?: number;
  /** Approximate UTF-16 heap budget for semantic nodes and their indexes. */
  maxChatBytes?: number;
  maxResolvedControls?: number;
  maxControlSeenEventIds?: number;
  /** Hard count ceiling for unresolved BottomBox requests. Never used for eviction. */
  maxPendingControls?: number;
  /** Approximate UTF-16 heap ceiling for unresolved BottomBox requests. */
  maxPendingControlBytes?: number;
  scheduleFlush?: ScheduleFlush;
  now?: () => number;
  onEffects?: (effects: readonly ProjectorEffect[]) => void;
  onOverflow?: (projectId: string) => void;
};

type QueuedEvent = {
  event: CanonicalProjectEvent;
  bytes: number;
};

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function defaultScheduleFlush(callback: () => void): CancelScheduledFlush {
  if (typeof MessageChannel === 'function') {
    const channel = new MessageChannel();
    let cancelled = false;
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      if (!cancelled) callback();
    };
    channel.port2.postMessage(undefined);
    return () => {
      cancelled = true;
      channel.port1.close();
      channel.port2.close();
    };
  }
  const handle = setTimeout(callback, 0);
  return () => clearTimeout(handle);
}

function estimateEventBytes(event: CanonicalProjectEvent): number {
  try {
    // UTF-16 is a conservative approximation for the renderer heap.
    return (
      JSON.stringify({
        eventId: event.eventId,
        projectId: event.projectId,
        runId: event.runId,
        eventType: event.eventType,
        payload: event.payload,
      }).length * 2
    );
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

const chatNodeByteEstimates = new WeakMap<object, number>();
const legacyStepByteEstimates = new WeakMap<object, number>();
const pendingControlByteEstimates = new WeakMap<object, number>();

function estimateLegacyStepBytes(
  step: ProjectViewState['legacySteps'][number]
): number {
  const cached = legacyStepByteEstimates.get(step);
  if (cached !== undefined) return cached;

  let bytes = Number.POSITIVE_INFINITY;
  try {
    const serialized = JSON.stringify(step);
    if (typeof serialized === 'string') {
      bytes = serialized.length * 2 + LEGACY_STEP_ARRAY_OVERHEAD_BYTES;
    }
  } catch {
    // A malformed or future non-serializable compatibility step is evicted.
  }
  legacyStepByteEstimates.set(step, bytes);
  return bytes;
}

function compactLegacySteps(
  steps: ProjectViewState['legacySteps'],
  maxLegacySteps: number,
  maxLegacyBytes: number
): ProjectViewState['legacySteps'] {
  const estimatedBytes = steps.reduce(
    (total, step) => total + estimateLegacyStepBytes(step),
    0
  );
  if (steps.length <= maxLegacySteps && estimatedBytes <= maxLegacyBytes) {
    return steps;
  }

  const retainedReversed: ProjectViewState['legacySteps'] = [];
  let retainedBytes = 0;
  for (
    let index = steps.length - 1;
    index >= 0 && retainedReversed.length < maxLegacySteps;
    index -= 1
  ) {
    const step = steps[index];
    const stepBytes = estimateLegacyStepBytes(step);
    if (stepBytes > maxLegacyBytes - retainedBytes) continue;
    retainedBytes += stepBytes;
    retainedReversed.push(step);
  }
  return retainedReversed.reverse();
}

function estimateChatNodeBytes(
  node: ChatProjectionState['nodes'][number]
): number {
  const cached = chatNodeByteEstimates.get(node);
  if (cached !== undefined) return cached;

  let bytes = Number.POSITIVE_INFINITY;
  try {
    const serialized = JSON.stringify(node);
    if (typeof serialized === 'string') {
      // Count the node once (the maps reference it rather than cloning it),
      // plus the two UTF-16 lookup keys and conservative entry overhead.
      bytes =
        serialized.length * 2 +
        node.id.length * 4 +
        CHAT_NODE_INDEX_OVERHEAD_BYTES;
    }
  } catch {
    // A future non-serializable projector node must not bypass the hard cap.
  }
  chatNodeByteEstimates.set(node, bytes);
  return bytes;
}

/**
 * Retain the newest `max` dedupe ids.
 *
 * This relies on `Object.keys` returning plain string keys in insertion order,
 * which holds for every id the system currently mints (uuid4, `chat_step_v1:…`,
 * `assistant-final:…`). It would NOT hold for an integer-like id such as
 * `"1042"`: V8 emits those first in ascending numeric order regardless of
 * insertion, so eviction would drop arbitrary ids and weaken dedupe rather than
 * dropping the oldest. Guard the invariant in dev so a future id scheme cannot
 * regress this silently.
 */
function retainNewestEventIds(
  seenEventIds: Record<string, true>,
  max: number
): string[] {
  const eventIds = Object.keys(seenEventIds);
  if (import.meta.env.DEV && eventIds.length > max) {
    const integerLike = eventIds.find((eventId) =>
      /^(0|[1-9]\d*)$/.test(eventId)
    );
    if (integerLike !== undefined) {
      console.warn(
        '[ProjectEventStore] Integer-like event id breaks insertion-order ' +
          'eviction; dedupe may drop the wrong ids',
        { eventId: integerLike }
      );
    }
  }
  return eventIds.length > max
    ? eventIds.slice(eventIds.length - max)
    : eventIds;
}

function compactView(
  view: ProjectViewState,
  maxSeenEventIds: number,
  maxUnknownEvents: number,
  maxLegacySteps: number,
  maxLegacyBytes: number
): ProjectViewState {
  const eventIds = Object.keys(view.seenEventIds);
  const retainedEventIds = retainNewestEventIds(
    view.seenEventIds,
    maxSeenEventIds
  );
  const seenEventIds =
    retainedEventIds.length === eventIds.length
      ? view.seenEventIds
      : Object.fromEntries(retainedEventIds.map((eventId) => [eventId, true]));

  const retainedUnknownEvents = view.unknownEvents
    .slice(-maxUnknownEvents)
    .map((event) =>
      event.raw === null && Object.keys(event.payload).length === 0
        ? event
        : { ...event, payload: {}, raw: null }
    );
  const unknownEventsChanged =
    retainedUnknownEvents.length !== view.unknownEvents.length ||
    retainedUnknownEvents.some(
      (event, index) => event !== view.unknownEvents[index]
    );
  const legacySteps = compactLegacySteps(
    view.legacySteps,
    maxLegacySteps,
    maxLegacyBytes
  );

  if (
    seenEventIds === view.seenEventIds &&
    !unknownEventsChanged &&
    legacySteps === view.legacySteps
  ) {
    return view;
  }
  return {
    ...view,
    seenEventIds: seenEventIds as Record<string, true>,
    legacySteps,
    unknownEvents: unknownEventsChanged
      ? retainedUnknownEvents
      : view.unknownEvents,
  };
}

function compactChatProjection(
  state: ChatProjectionState,
  maxChatNodes: number,
  maxChatBytes: number,
  maxSeenEventIds: number,
  maxUnknownEvents: number
): ChatProjectionState {
  const eventIds = Object.keys(state.seenEventIds);
  const retainedEventIds = retainNewestEventIds(
    state.seenEventIds,
    maxSeenEventIds
  );
  const seenEventIds =
    retainedEventIds.length === eventIds.length
      ? state.seenEventIds
      : (Object.fromEntries(
          retainedEventIds.map((eventId) => [eventId, true])
        ) as Record<string, true>);

  const unknownCount = state.nodes.reduce(
    (count, node) => count + (node.kind === 'unknown' ? 1 : 0),
    0
  );
  const estimatedNodeBytes = state.nodes.reduce(
    (total, node) => total + estimateChatNodeBytes(node),
    0
  );
  const nodesNeedCompaction =
    state.nodes.length > maxChatNodes ||
    unknownCount > maxUnknownEvents ||
    estimatedNodeBytes > maxChatBytes;
  if (!nodesNeedCompaction && seenEventIds === state.seenEventIds) {
    return state;
  }

  let nodes = state.nodes;
  let nodeById = state.nodeById;
  let nodeIndexById = state.nodeIndexById;
  if (nodesNeedCompaction) {
    const retainedReversed = [] as ChatProjectionState['nodes'];
    let retainedUnknownCount = 0;
    let retainedBytes = 0;
    for (
      let index = state.nodes.length - 1;
      index >= 0 && retainedReversed.length < maxChatNodes;
      index -= 1
    ) {
      const node = state.nodes[index];
      if (node.kind === 'unknown') {
        if (retainedUnknownCount >= maxUnknownEvents) continue;
      }
      const nodeBytes = estimateChatNodeBytes(node);
      if (nodeBytes > maxChatBytes - retainedBytes) continue;

      if (node.kind === 'unknown') retainedUnknownCount += 1;
      retainedBytes += nodeBytes;
      retainedReversed.push(node);
    }
    nodes = retainedReversed.reverse();
    nodeById = Object.fromEntries(nodes.map((node) => [node.id, node]));
    nodeIndexById = Object.fromEntries(
      nodes.map((node, index) => [node.id, index])
    );
  }

  return { ...state, nodes, nodeById, nodeIndexById, seenEventIds };
}

/** Keep every actionable request, while bounding historical command receipts. */
function compactHumanControlProjection(
  state: HumanControlProjectionState,
  maxResolvedControls: number,
  maxSeenEventIds: number
): HumanControlProjectionState {
  const pendingIds: string[] = [];
  const terminalIds: string[] = [];
  for (const id of state.orderedInteractionIds) {
    const interaction = state.interactionById[id];
    if (!interaction) continue;
    if (interaction.status === 'requested') pendingIds.push(id);
    else terminalIds.push(id);
  }

  const retainedIds = new Set([
    ...pendingIds,
    ...terminalIds.slice(-maxResolvedControls),
  ]);
  const orderedInteractionIds = state.orderedInteractionIds.filter((id) =>
    retainedIds.has(id)
  );
  const interactionsChanged =
    orderedInteractionIds.length !== state.orderedInteractionIds.length;
  const interactionById = interactionsChanged
    ? Object.fromEntries(
        orderedInteractionIds.map((id) => [id, state.interactionById[id]])
      )
    : state.interactionById;

  const allSeenIds = Object.keys(state.seenEventIds);
  const recentSeenIds = allSeenIds.slice(-maxSeenEventIds);
  const requiredPendingEventIds = pendingIds.flatMap((id) => {
    const interaction = state.interactionById[id];
    return [interaction.requestEventId, interaction.lastEventId].filter(
      (eventId): eventId is string => Boolean(eventId)
    );
  });
  const retainedSeenIds = [
    ...new Set([...recentSeenIds, ...requiredPendingEventIds]),
  ];
  const seenEventIds =
    retainedSeenIds.length === allSeenIds.length &&
    retainedSeenIds.every((id, index) => id === allSeenIds[index])
      ? state.seenEventIds
      : (Object.fromEntries(
          retainedSeenIds.map((eventId) => [eventId, true])
        ) as Record<string, true>);

  if (!interactionsChanged && seenEventIds === state.seenEventIds) return state;
  return {
    ...state,
    interactionById,
    orderedInteractionIds,
    seenEventIds,
  };
}

function estimatePendingControlBytes(
  interaction: HumanControlProjectionState['interactionById'][string]
): number {
  const cached = pendingControlByteEstimates.get(interaction);
  if (cached !== undefined) return cached;

  let bytes = Number.POSITIVE_INFINITY;
  try {
    const serialized = JSON.stringify(interaction);
    if (typeof serialized === 'string') {
      // The serialized object includes its own IDs. Account separately for the
      // interactionById key and orderedInteractionIds array entry.
      bytes =
        serialized.length * 2 +
        interaction.interactionId.length * 4 +
        PENDING_CONTROL_INDEX_OVERHEAD_BYTES;
    }
  } catch {
    // A future non-serializable control must fail the byte guard closed.
  }
  pendingControlByteEstimates.set(interaction, bytes);
  return bytes;
}

function pendingControlCapacityReason(
  state: HumanControlProjectionState,
  maxPendingControls: number,
  maxPendingControlBytes: number
): string | null {
  let count = 0;
  let bytes = 0;
  for (const id of state.orderedInteractionIds) {
    const interaction = state.interactionById[id];
    if (!interaction || interaction.status !== 'requested') continue;
    count += 1;
    if (count > maxPendingControls) {
      return 'frontend_pending_control_count_overflow';
    }
    bytes += estimatePendingControlBytes(interaction);
    if (bytes > maxPendingControlBytes) {
      return 'frontend_pending_control_bytes_overflow';
    }
  }
  return null;
}

function isCanonicalProjectEvent(
  value: unknown
): value is CanonicalProjectEvent {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'eventId' in value &&
    'runSequence' in value
  );
}

function normalizeSnapshotEvents(
  recentEvents: readonly unknown[]
): CanonicalProjectEvent[] {
  return recentEvents.map((raw) =>
    isCanonicalProjectEvent(raw) ? raw : normalizeEvent(raw)
  );
}

function eventEnteredSemanticLane(
  event: CanonicalProjectEvent,
  view: ProjectViewState
): boolean {
  if (!view.seenEventIds[event.eventId]) return false;
  if (!event.legacyStep) return true;

  // The base projector suppresses an equivalent legacy/canonical dual-write
  // by linking its second event ID to the existing compatibility step. Only
  // the event that actually owns a projected step should create ChatBox nodes.
  return view.legacySteps.some((step) => step.eventId === event.eventId);
}

/**
 * One bounded ingest owner for a Project. The durable backend remains the raw
 * journal; this store keeps only a disposable frontend projection.
 */
export class ProjectEventStore {
  readonly projectId: string;

  private readonly listeners = new Set<() => void>();
  private readonly queue: QueuedEvent[] = [];
  private readonly queuedEventIds = new Set<string>();
  private readonly maxQueueEvents: number;
  private readonly maxQueueBytes: number;
  private readonly maxEventBytes: number;
  private readonly maxBatchEvents: number;
  private readonly maxSliceMs: number;
  private readonly maxSeenEventIds: number;
  private readonly maxUnknownEvents: number;
  private readonly maxLegacySteps: number;
  private readonly maxLegacyBytes: number;
  private readonly maxChatNodes: number;
  private readonly maxChatBytes: number;
  private readonly maxResolvedControls: number;
  private readonly maxControlSeenEventIds: number;
  private readonly maxPendingControls: number;
  private readonly maxPendingControlBytes: number;
  private readonly scheduleFlush: ScheduleFlush;
  private readonly now: () => number;
  private readonly onEffects?: ProjectEventStoreOptions['onEffects'];
  private readonly onOverflow?: ProjectEventStoreOptions['onOverflow'];

  private mode: ProjectorMode;
  private queueBytes = 0;
  private cancelScheduledFlush: CancelScheduledFlush | null = null;
  private disposed = false;
  private incarnation = 0;
  private snapshotReplacementGeneration = 0;
  private activeSnapshotReplacement: {
    generation: number;
    invalidated: boolean;
  } | null = null;
  private snapshot: ProjectEventStoreSnapshot;

  constructor(projectId: string, options: ProjectEventStoreOptions = {}) {
    if (!projectId) throw new Error('ProjectEventStore requires a project id');
    this.projectId = projectId;
    this.mode = options.mode || 'live';
    this.maxQueueEvents = positiveInteger(
      options.maxQueueEvents,
      DEFAULT_MAX_QUEUE_EVENTS
    );
    this.maxQueueBytes = positiveInteger(
      options.maxQueueBytes,
      DEFAULT_MAX_QUEUE_BYTES
    );
    this.maxEventBytes = positiveInteger(
      options.maxEventBytes,
      DEFAULT_MAX_EVENT_BYTES
    );
    this.maxBatchEvents = positiveInteger(
      options.maxBatchEvents,
      DEFAULT_MAX_BATCH_EVENTS
    );
    this.maxSliceMs = positiveNumber(options.maxSliceMs, DEFAULT_MAX_SLICE_MS);
    this.maxSeenEventIds = positiveInteger(
      options.maxSeenEventIds,
      DEFAULT_MAX_SEEN_EVENT_IDS
    );
    this.maxUnknownEvents = positiveInteger(
      options.maxUnknownEvents,
      DEFAULT_MAX_UNKNOWN_EVENTS
    );
    this.maxLegacySteps = positiveInteger(
      options.maxLegacySteps,
      DEFAULT_MAX_LEGACY_STEPS
    );
    this.maxLegacyBytes = positiveInteger(
      options.maxLegacyBytes,
      DEFAULT_MAX_LEGACY_BYTES
    );
    this.maxChatNodes = positiveInteger(
      options.maxChatNodes,
      DEFAULT_MAX_CHAT_NODES
    );
    this.maxChatBytes = positiveInteger(
      options.maxChatBytes,
      DEFAULT_MAX_CHAT_BYTES
    );
    this.maxResolvedControls = positiveInteger(
      options.maxResolvedControls,
      DEFAULT_MAX_RESOLVED_CONTROLS
    );
    this.maxControlSeenEventIds = positiveInteger(
      options.maxControlSeenEventIds,
      DEFAULT_MAX_CONTROL_SEEN_EVENT_IDS
    );
    this.maxPendingControls = positiveInteger(
      options.maxPendingControls,
      DEFAULT_MAX_PENDING_CONTROLS
    );
    this.maxPendingControlBytes = positiveInteger(
      options.maxPendingControlBytes,
      DEFAULT_MAX_PENDING_CONTROL_BYTES
    );
    this.scheduleFlush = options.scheduleFlush || defaultScheduleFlush;
    this.now = options.now || (() => performance.now());
    this.onEffects = options.onEffects;
    this.onOverflow = options.onOverflow;
    this.snapshot = {
      view: createProjectViewState(projectId, this.mode),
      chat: createChatProjectionState(projectId),
      control: createHumanControlProjectionState(projectId),
      revision: 0,
      hasHydratedSnapshot: false,
      overflowed: false,
      lastEffects: [],
    };
  }

  getSnapshot = (): ProjectEventStoreSnapshot => this.snapshot;

  getChatSnapshot = (): ChatProjectionState => this.snapshot.chat;

  getControlSnapshot = (): HumanControlProjectionState => this.snapshot.control;

  getIncarnation(): number {
    return this.incarnation;
  }

  getPendingEventCount(): number {
    return this.queue.length;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  enqueue(
    value: CanonicalProjectEvent | readonly CanonicalProjectEvent[]
  ): boolean {
    if (
      this.disposed ||
      this.activeSnapshotReplacement?.invalidated ||
      (this.snapshot.overflowed && !this.activeSnapshotReplacement)
    ) {
      return false;
    }
    const events = Array.isArray(value) ? value : [value];
    const newEventIds = new Set<string>();
    const candidates = events.filter((event) => {
      if (
        this.snapshot.view.seenEventIds[event.eventId] ||
        this.queuedEventIds.has(event.eventId) ||
        newEventIds.has(event.eventId) ||
        this.isCoveredByCurrentWatermark(event)
      ) {
        return false;
      }
      newEventIds.add(event.eventId);
      return true;
    });
    if (candidates.length === 0) return true;

    const queued = candidates.map((event) => ({
      event,
      bytes: estimateEventBytes(event),
    }));
    if (queued.some((item) => item.bytes > this.maxEventBytes)) {
      this.rejectQueuedBatch('frontend_event_oversize');
      return false;
    }
    const addedBytes = queued.reduce((total, item) => total + item.bytes, 0);
    if (
      this.queue.length + queued.length > this.maxQueueEvents ||
      this.queueBytes + addedBytes > this.maxQueueBytes
    ) {
      this.rejectQueuedBatch('frontend_queue_overflow');
      return false;
    }

    this.queue.push(...queued);
    for (const item of queued) this.queuedEventIds.add(item.event.eventId);
    this.queueBytes += addedBytes;
    this.ensureScheduled();
    return true;
  }

  flushNow(): void {
    if (
      this.disposed ||
      this.activeSnapshotReplacement ||
      this.snapshot.overflowed ||
      this.queue.length === 0
    ) {
      return;
    }
    this.cancelScheduledFlush?.();
    this.cancelScheduledFlush = null;

    const startedAt = this.now();
    const batch: CanonicalProjectEvent[] = [];
    while (this.queue.length > 0 && batch.length < this.maxBatchEvents) {
      const item = this.queue.shift();
      if (!item) break;
      this.queuedEventIds.delete(item.event.eventId);
      this.queueBytes = Math.max(0, this.queueBytes - item.bytes);
      batch.push(item.event);
      if (batch.length > 0 && this.now() - startedAt >= this.maxSliceMs) break;
    }

    const result = projectRawEvents(
      this.projectId,
      batch,
      this.mode,
      this.snapshot.view
    );
    const acceptedBatch = batch.filter(
      (event) =>
        !this.snapshot.view.seenEventIds[event.eventId] &&
        eventEnteredSemanticLane(event, result.state)
    );
    const introducedUnverifiedRun = acceptedBatch.some(
      (event) =>
        event.source !== 'canonical' &&
        this.snapshot.view.runs[event.runId] === undefined
    );
    const chat = compactChatProjection(
      projectChatEvents(this.projectId, acceptedBatch, this.snapshot.chat),
      this.maxChatNodes,
      this.maxChatBytes,
      this.maxSeenEventIds,
      this.maxUnknownEvents
    );
    // Human controls consume the same accepted durable batch. Pending requests
    // are never evicted; only older terminal receipts and dedupe IDs are bounded.
    const control = compactHumanControlProjection(
      projectHumanControlEvents(
        this.projectId,
        acceptedBatch,
        this.snapshot.control
      ),
      this.maxResolvedControls,
      this.maxControlSeenEventIds
    );
    const pendingControlOverflowReason = pendingControlCapacityReason(
      control,
      this.maxPendingControls,
      this.maxPendingControlBytes
    );
    if (pendingControlOverflowReason) {
      // Preserve the last safe control snapshot. Unresolved requests are never
      // partially evicted to make a projected batch fit.
      this.rejectQueuedBatch(pendingControlOverflowReason);
      return;
    }
    this.publish(
      compactView(
        result.state,
        this.maxSeenEventIds,
        this.maxUnknownEvents,
        this.maxLegacySteps,
        this.maxLegacyBytes
      ),
      chat,
      control,
      result.effects,
      false,
      introducedUnverifiedRun ? false : this.snapshot.hasHydratedSnapshot
    );
    if (this.queue.length > 0) this.ensureScheduled();
  }

  /** Test/rehydrate helper; production live delivery should stay sliced. */
  flushAll(): void {
    while (
      this.queue.length > 0 &&
      !this.snapshot.overflowed &&
      !this.activeSnapshotReplacement
    ) {
      this.flushNow();
    }
  }

  replaceSnapshot(snapshot: ProjectSnapshotInput): void {
    if (this.activeSnapshotReplacement) {
      throw new Error(
        'Project snapshot replacement is already owned by a rebuild generation'
      );
    }
    this.applySnapshot(snapshot);
  }

  /**
   * Pause projection publication and buffer live delivery while a snapshot is
   * fetched. The existing queue is retained, so an event received immediately
   * before the owner starts is protected by the same transaction.
   */
  beginSnapshotReplacement(): ProjectEventStoreSnapshotReplacement | null {
    if (this.disposed || this.activeSnapshotReplacement) return null;
    this.cancelScheduledFlush?.();
    this.cancelScheduledFlush = null;
    const generation = ++this.snapshotReplacementGeneration;
    this.activeSnapshotReplacement = { generation, invalidated: false };
    return Object.freeze({ projectId: this.projectId, generation });
  }

  /**
   * Atomically publish a rebuilt snapshot, then replay any newer buffered live
   * events. False means the bounded live buffer overflowed or the token is no
   * longer the active owner; callers must fetch a fresh snapshot generation.
   */
  commitSnapshotReplacement(
    replacement: ProjectEventStoreSnapshotReplacement,
    snapshot: ProjectSnapshotInput
  ): boolean {
    if (!this.ownsSnapshotReplacement(replacement)) return false;
    if (this.activeSnapshotReplacement?.invalidated) {
      this.activeSnapshotReplacement = null;
      return false;
    }

    try {
      if (!this.applySnapshot(snapshot)) {
        this.activeSnapshotReplacement = null;
        return false;
      }
    } catch (error) {
      this.activeSnapshotReplacement = null;
      if (!this.snapshot.overflowed && this.queue.length > 0) {
        this.ensureScheduled();
      }
      throw error;
    }
    this.activeSnapshotReplacement = null;
    if (this.queue.length > 0) this.ensureScheduled();
    return true;
  }

  /** Release a cancelled fetch generation without discarding buffered events. */
  cancelSnapshotReplacement(
    replacement: ProjectEventStoreSnapshotReplacement
  ): void {
    if (!this.ownsSnapshotReplacement(replacement)) return;
    this.activeSnapshotReplacement = null;
    if (!this.snapshot.overflowed && this.queue.length > 0) {
      this.ensureScheduled();
    }
  }

  private applySnapshot(snapshot: ProjectSnapshotInput): boolean {
    if (snapshot.project_id !== this.projectId) {
      throw new Error('Project snapshot does not match event store scope');
    }
    this.cancelScheduledFlush?.();
    this.cancelScheduledFlush = null;
    const projectedView = { ...projectSnapshot(snapshot), mode: this.mode };
    const view = compactView(
      projectedView,
      this.maxSeenEventIds,
      this.maxUnknownEvents,
      this.maxLegacySteps,
      this.maxLegacyBytes
    );
    const snapshotEvents = normalizeSnapshotEvents(
      snapshot.recent_events
    ).filter((event) => eventEnteredSemanticLane(event, projectedView));
    const chat = compactChatProjection(
      projectChatEvents(this.projectId, snapshotEvents),
      this.maxChatNodes,
      this.maxChatBytes,
      this.maxSeenEventIds,
      this.maxUnknownEvents
    );
    const control = compactHumanControlProjection(
      projectHumanControlEvents(this.projectId, snapshotEvents),
      this.maxResolvedControls,
      this.maxControlSeenEventIds
    );
    const pendingControlOverflowReason = pendingControlCapacityReason(
      control,
      this.maxPendingControls,
      this.maxPendingControlBytes
    );
    if (pendingControlOverflowReason) {
      // Snapshot rebuilds are atomic as well: retain the last safe state and
      // force a fresh bounded resync instead of publishing a partial request set.
      this.rejectQueuedBatch(pendingControlOverflowReason);
      return false;
    }
    this.publish(view, chat, control, [], false, true);
    this.discardQueuedEventsCoveredBySnapshot();
    if (this.queue.length > 0) this.ensureScheduled();
    return true;
  }

  setMode(mode: ProjectorMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.publish(
      { ...this.snapshot.view, mode },
      this.snapshot.chat,
      this.snapshot.control,
      [],
      this.snapshot.overflowed
    );
  }

  /** Clear one runtime projection while preserving same-id subscribers. */
  reset(): void {
    if (this.disposed) return;
    this.cancelScheduledFlush?.();
    this.cancelScheduledFlush = null;
    this.activeSnapshotReplacement = null;
    this.clearQueue();
    this.incarnation += 1;
    this.publish(
      createProjectViewState(this.projectId, this.mode),
      createChatProjectionState(this.projectId),
      createHumanControlProjectionState(this.projectId),
      [],
      false,
      false
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelScheduledFlush?.();
    this.cancelScheduledFlush = null;
    this.activeSnapshotReplacement = null;
    this.clearQueue();
    this.listeners.clear();
  }

  private ensureScheduled(): void {
    if (
      this.cancelScheduledFlush ||
      this.disposed ||
      this.activeSnapshotReplacement
    ) {
      return;
    }
    this.cancelScheduledFlush = this.scheduleFlush(() => {
      this.cancelScheduledFlush = null;
      this.flushNow();
    });
  }

  private ownsSnapshotReplacement(
    replacement: ProjectEventStoreSnapshotReplacement
  ): boolean {
    return Boolean(
      replacement.projectId === this.projectId &&
      this.activeSnapshotReplacement?.generation === replacement.generation
    );
  }

  private rejectQueuedBatch(reason: string): void {
    if (this.activeSnapshotReplacement) {
      this.activeSnapshotReplacement.invalidated = true;
    }
    this.enterOverflowState(reason);
  }

  private enterOverflowState(reason: string): void {
    this.cancelScheduledFlush?.();
    this.cancelScheduledFlush = null;
    this.clearQueue();
    const view: ProjectViewState = {
      ...this.snapshot.view,
      needsResync: true,
      resyncReason: reason,
      resyncTargetCursor: null,
    };
    this.publish(
      view,
      this.snapshot.chat,
      this.snapshot.control,
      [{ type: 'request_resync', reason }],
      true
    );
    this.onOverflow?.(this.projectId);
  }

  private clearQueue(): void {
    this.queue.length = 0;
    this.queuedEventIds.clear();
    this.queueBytes = 0;
  }

  private isCoveredByCurrentWatermark(event: CanonicalProjectEvent): boolean {
    if (
      event.source === 'canonical' &&
      event.cloudCursor !== null &&
      event.cloudCursor <= this.snapshot.view.currentCursor
    ) {
      return true;
    }
    const run = this.snapshot.view.runs[event.runId];
    return Boolean(
      event.source === 'canonical' &&
      run &&
      event.runSequence <= run.lastSequence
    );
  }

  private discardQueuedEventsCoveredBySnapshot(): void {
    const retained = this.queue.filter(({ event }) => {
      if (this.snapshot.view.seenEventIds[event.eventId]) return false;
      return !this.isCoveredByCurrentWatermark(event);
    });
    if (retained.length === this.queue.length) return;

    this.queue.length = 0;
    this.queue.push(...retained);
    this.queuedEventIds.clear();
    this.queueBytes = 0;
    for (const item of retained) {
      this.queuedEventIds.add(item.event.eventId);
      this.queueBytes += item.bytes;
    }
  }

  private publish(
    view: ProjectViewState,
    chat: ChatProjectionState,
    control: HumanControlProjectionState,
    effects: readonly ProjectorEffect[],
    overflowed: boolean,
    hasHydratedSnapshot = this.snapshot.hasHydratedSnapshot
  ): void {
    this.snapshot = {
      view,
      chat,
      control,
      revision: this.snapshot.revision + 1,
      hasHydratedSnapshot,
      overflowed,
      lastEffects: effects,
    };
    if (effects.length > 0) this.onEffects?.(effects);
    for (const listener of this.listeners) listener();
  }
}

const projectEventStores = new Map<string, ProjectEventStore>();

export function getProjectEventStore(
  projectId: string,
  options?: ProjectEventStoreOptions
): ProjectEventStore {
  const existing = projectEventStores.get(projectId);
  if (existing) return existing;
  const created = new ProjectEventStore(projectId, options);
  projectEventStores.set(projectId, created);
  return created;
}

/** Reset an overwritten same-id Project without stranding mounted consumers. */
export function resetProjectEventStore(projectId: string): void {
  projectEventStores.get(projectId)?.reset();
}

export function releaseProjectEventStore(projectId: string): void {
  const store = projectEventStores.get(projectId);
  if (!store) return;
  store.dispose();
  projectEventStores.delete(projectId);
}

export function resetProjectEventStoresForTests(): void {
  for (const store of projectEventStores.values()) store.dispose();
  projectEventStores.clear();
}
