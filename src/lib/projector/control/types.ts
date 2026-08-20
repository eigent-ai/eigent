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

import type { CanonicalProjectEvent, ProjectedLegacyStep } from '../types';

/**
 * Human controls consume the durable event stream directly. They deliberately
 * do not consume ChatTimeline nodes because that projection may be grouped,
 * summarized, or bounded for rendering.
 */
export type HumanControlProjectionInput =
  CanonicalProjectEvent | ProjectedLegacyStep;

export type HumanControlStatus =
  'requested' | 'resolved' | 'expired' | 'cancelled';

export type HumanControlTimestamp = string | number;

export interface HumanControlOption {
  id: string;
  label: string;
  /**
   * The backend-owned value is intentionally opaque. The UI may submit it but
   * must not infer a decision from its shape or replace it with the label.
   */
  value: unknown;
  description?: string;
}

export interface HumanControlField {
  id: string;
  label: string;
  type?: string;
  required: boolean;
  description?: string;
  placeholder?: string;
  options?: HumanControlOption[];
}

export interface HumanControlRuleMatcher {
  actionPattern?: string | null;
  resourcePattern?: string | null;
  matcherKind?: string | null;
}

/**
 * Non-evictable actionable state for one HumanInteraction.
 *
 * `sequence` is the durable sequence of the request. `lastSequence` tracks
 * later lifecycle events without changing the request's position in the
 * BottomBox queue.
 */
export interface HumanControlInteraction {
  interactionId: string;
  interactionType: string;
  status: HumanControlStatus;
  projectId: string;
  runId: string;
  sequence: number;
  lastSequence: number;
  cloudCursor: number | null;
  lastCloudCursor: number | null;
  requestEventId?: string;
  /** Typed event that established the request; legacy ASK mirrors are not command authority. */
  requestEventType?: string;
  /** Source lane of the request; only canonical sequences are replay cursors. */
  requestSource: CanonicalProjectEvent['source'];
  lastEventId: string;
  requestedAt?: string | null;
  updatedAt: string | null;
  version?: number;
  approvalId?: string;
  actionDigest?: string;
  allowedScopes: string[];
  title?: string;
  prompt?: string;
  agent?: string;
  operation?: string;
  targetResources: string[];
  displayArguments: Record<string, unknown>;
  ruleMatcher: HumanControlRuleMatcher | null;
  options: HumanControlOption[];
  fields: HumanControlField[];
  expiresAt?: HumanControlTimestamp | null;
  deadlineAt?: HumanControlTimestamp | null;
}

export interface HumanControlProjectionState {
  projectId: string;
  interactionById: Record<string, HumanControlInteraction>;
  /** Request order, independent from any bounded ChatTimeline collection. */
  orderedInteractionIds: string[];
  seenEventIds: Record<string, true>;
}

/** Normalized lifecycle patch produced by the transport-independent adapter. */
export interface HumanControlProjectionUpdate {
  eventId: string;
  eventType: string;
  source: CanonicalProjectEvent['source'];
  projectId: string;
  runId: string;
  sequence: number;
  cloudCursor: number | null;
  createdAt: string | null;
  status: HumanControlStatus;
  /** Legacy human_reply steps can only be correlated by Run and agent. */
  interactionId?: string;
  interactionType?: string;
  version?: number;
  approvalId?: string;
  actionDigest?: string;
  allowedScopes?: string[];
  title?: string;
  prompt?: string;
  agent?: string;
  operation?: string;
  targetResources?: string[];
  displayArguments?: Record<string, unknown>;
  ruleMatcher?: HumanControlRuleMatcher | null;
  options?: HumanControlOption[];
  fields?: HumanControlField[];
  expiresAt?: HumanControlTimestamp | null;
  deadlineAt?: HumanControlTimestamp | null;
}

export interface SelectHumanControlsOptions {
  runId?: string;
  statuses?: ReadonlySet<HumanControlStatus>;
  interactionTypes?: ReadonlySet<string>;
}
