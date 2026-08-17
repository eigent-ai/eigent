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

/** Never allow projection failures to affect the source chat transport. */
export function enqueueChatEventProjection(
  input: ChatEventProjectionInput,
  enabled = true
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
