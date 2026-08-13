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
  normalizeLegacyChatStep,
  normalizeLocalRunEvent,
} from '@/lib/projector';
import { getProjectEventStore } from './projectEventStore';

export type ChatEventProjectionInput = {
  raw: unknown;
  projectId: string | null | undefined;
  runId: string;
  sequence: number;
  sourceId: string;
  transport: 'legacy_chat' | 'local_run';
};

/**
 * Shadowing is opt-in everywhere, including development.
 *
 * It was previously on for every dev build. Shadow ingestion builds a full
 * parallel per-Project event store (multi-megabyte queue, legacy and chat
 * budgets) that no visible UI reads while the timeline flag is off, so paying
 * that cost in every dev session is not worth the parity signal. Set
 * VITE_CHATBOX_EVENT_SHADOW=true to measure parity.
 */
export function isChatEventProjectionEnabled(): boolean {
  return (
    import.meta.env.VITE_CHATBOX_EVENT_SHADOW === 'true' ||
    // The visible read path still needs the legacy /chat source bridge while
    // the canonical companion owns typed Run events. Keep the flags
    // independently deployable, but make cutover imply bridge ingestion.
    isChatEventTimelineEnabled()
  );
}

/**
 * Visible event-native ChatBox rendering remains an explicit cutover. Shadow
 * ingestion can stay enabled while renderer parity and history hydration are
 * measured without changing the production UI.
 */
export function isChatEventTimelineEnabled(): boolean {
  return import.meta.env.VITE_CHATBOX_EVENT_BUS === 'true';
}

/**
 * Outcome of one ingest attempt.
 *
 * `overflowed` is deliberately distinct from `disabled`/`rejected`: it means
 * the store dropped its queue and entered needsResync, which also suspends the
 * canonical live streams until a fresh snapshot commits. Collapsing it into a
 * bare `false` hides a recoverable-but-degraded state behind the same value as
 * "the feature is switched off".
 */
export type ChatEventProjectionOutcome =
  | 'accepted'
  | 'disabled'
  | 'rejected'
  | 'overflowed';

/** Never allow migration projection failures to affect the legacy UI path. */
export function enqueueChatEventProjection(
  input: ChatEventProjectionInput,
  enabled = isChatEventProjectionEnabled()
): ChatEventProjectionOutcome {
  if (!enabled || !input.projectId) return 'disabled';
  if (
    input.transport === 'legacy_chat' &&
    (!input.raw ||
      typeof input.raw !== 'object' ||
      typeof (input.raw as { step?: unknown }).step !== 'string')
  ) {
    return 'rejected';
  }

  try {
    const event =
      input.transport === 'local_run'
        ? normalizeLocalRunEvent(input.raw, input.projectId)
        : normalizeLegacyChatStep(input.raw, {
            projectId: input.projectId,
            runId: input.runId,
            sequence: input.sequence,
            sourceId: input.sourceId,
          });
    const store = getProjectEventStore(input.projectId);
    if (store.enqueue(event)) return 'accepted';
    return store.getSnapshot().overflowed ? 'overflowed' : 'rejected';
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[ChatEventProjection] Shadow event was rejected', error);
    }
    return 'rejected';
  }
}
