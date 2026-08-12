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
 * Shadowing defaults on in development and remains opt-in in packaged builds
 * until semantic parity has been measured. The future renderer cutover gets a
 * separate flag; transport ingestion must stay centralized here.
 */
export function isChatEventProjectionEnabled(): boolean {
  return (
    import.meta.env.DEV ||
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

/** Never allow migration projection failures to affect the legacy UI path. */
export function enqueueChatEventProjection(
  input: ChatEventProjectionInput,
  enabled = isChatEventProjectionEnabled()
): boolean {
  if (!enabled || !input.projectId) return false;
  if (
    input.transport === 'legacy_chat' &&
    (!input.raw ||
      typeof input.raw !== 'object' ||
      typeof (input.raw as { step?: unknown }).step !== 'string')
  ) {
    return false;
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
    return getProjectEventStore(input.projectId).enqueue(event);
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[ChatEventProjection] Shadow event was rejected', error);
    }
    return false;
  }
}
